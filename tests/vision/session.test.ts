import { describe, expect, it } from "vitest";
import type { VisionErrorCode, VisionEvent } from "../../src/shared";
import {
  EYES_CLOSED,
  MOUTH_OPEN,
  createHarness,
  makeFace,
  twoFaces,
  type GetUserMediaBehavior,
  type Harness,
  type HarnessOptions,
} from "./fixtures";

const FPS = 30;
const STEP = 1000 / FPS;

function statuses(h: Harness): string[] {
  return h.ofType("status-changed").map((event) => event.status);
}

async function startRunning(options?: HarnessOptions): Promise<Harness> {
  const h = createHarness(options);
  expect(await h.session.start()).toEqual({ ok: true });
  return h;
}

/** Running, both faces locked, default calibration applied. Returns the next frame time. */
async function readyPair(): Promise<{ h: Harness; t: number }> {
  const h = await startRunning();
  const last = h.run(0, 1000, FPS, () => twoFaces());
  h.session.useDefaultCalibration();
  const armed = h.run(last + STEP, last + 300, FPS, () => twoFaces());
  return { h, t: armed + STEP };
}

/** Running and calibrated by measurement. Returns the next frame time. */
async function calibratedPair(): Promise<{ h: Harness; t: number }> {
  const h = await startRunning();
  const locked = h.run(0, 1000, FPS, () => twoFaces());
  h.session.startCalibration();
  const start = locked + STEP;
  const gestureOn = (t: number): boolean => {
    const rel = t - start;
    return rel >= 2500 && rel < 5500 && (rel - 2500) % 1000 < 300;
  };
  const last = h.run(start, start + 6500, FPS, (t) =>
    gestureOn(t) ? twoFaces({ 1: { ear: EYES_CLOSED }, 2: { mar: MOUTH_OPEN } }) : twoFaces(),
  );
  return { h, t: last + STEP };
}

function expectFailure(h: Harness, code: VisionErrorCode): void {
  const [error, status] = h.events.slice(-2);
  expect(error).toMatchObject({ type: "error", error: { code } });
  expect(status).toMatchObject({ type: "status-changed", status: "error" });
  expect(h.session.getStatus()).toBe("error");
}

describe("vision session: start", () => {
  it("does nothing observable until start() is called", () => {
    const h = createHarness();
    expect(h.session.getStatus()).toBe("idle");
    expect(h.devices.calls).toHaveLength(0);
    expect(h.loadCount()).toBe(0);
    expect(h.events).toHaveLength(0);
  });

  it("moves idle → requesting-camera → loading-model → running and attaches the stream", async () => {
    const h = createHarness();
    expect(await h.session.start()).toEqual({ ok: true });
    expect(statuses(h)).toEqual(["requesting-camera", "loading-model", "running"]);
    expect(h.ofType("status-changed")[0]?.previous).toBe("idle");
    expect(h.devices.calls).toHaveLength(1);
    expect(h.devices.calls[0]?.audio).toBe(false);
    expect(h.video.srcObject).toBe(h.devices.streams[0]);
    expect(h.video.muted).toBe(true);
    expect(h.video.playsInline).toBe(true);
    expect(h.video.playCalls).toBe(1);
    expect(h.frames.pendingCount).toBe(1);
    expect(h.loadCount()).toBe(1);
  });

  it("does not reopen the camera when start() is called while starting or running", async () => {
    const h = createHarness();
    const first = h.session.start();
    expect(h.session.start()).toBe(first);
    await first;
    expect(await h.session.start()).toEqual({ ok: true });
    expect(h.devices.calls).toHaveLength(1);
  });

  it.each<[string, GetUserMediaBehavior[], VisionErrorCode]>([
    ["permission denied", [{ reject: "NotAllowedError" }], "camera-permission-denied"],
    ["a security error", [{ reject: "SecurityError" }], "camera-permission-denied"],
    ["no camera", [{ reject: "NotFoundError" }], "camera-not-found"],
    [
      "unsatisfiable constraints",
      [{ reject: "OverconstrainedError" }, { reject: "OverconstrainedError" }],
      "camera-not-found",
    ],
    ["a busy camera", [{ reject: "NotReadableError" }], "camera-in-use"],
    ["an aborted request", [{ reject: "AbortError" }], "camera-in-use"],
  ])("resolves %s as { ok: false } with the matching events", async (_label, behaviors, code) => {
    const h = createHarness();
    h.devices.behaviors = [...behaviors];
    const result = await h.session.start();
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(statuses(h)).toEqual(["requesting-camera", "error"]);
    expectFailure(h, code);
    expect(h.video.srcObject).toBeNull();
  });

  it("reports an unsupported environment without requesting the camera", async () => {
    const h = createHarness({ supported: false });
    expect(await h.session.start()).toMatchObject({
      ok: false,
      error: { code: "camera-unsupported" },
    });
    expect(statuses(h)).toEqual(["error"]);
    expectFailure(h, "camera-unsupported");
    expect(h.devices.calls).toHaveLength(0);
  });

  it("reports a model load failure and releases the camera", async () => {
    const h = createHarness({ loadError: new Error("404 face_landmarker.task") });
    const result = await h.session.start();
    expect(result).toMatchObject({ ok: false, error: { code: "model-load-failed" } });
    expect(result.ok ? "" : result.error.message).toContain("404");
    expect(statuses(h)).toEqual(["requesting-camera", "loading-model", "error"]);
    expectFailure(h, "model-load-failed");
    expect(h.devices.streams[0]?.allStopped).toBe(true);
    expect(h.video.srcObject).toBeNull();
  });

  it("can start again after an error", async () => {
    const h = createHarness();
    h.devices.behaviors = [{ reject: "NotAllowedError" }];
    expect((await h.session.start()).ok).toBe(false);
    expect(await h.session.start()).toEqual({ ok: true });
    expect(statuses(h)).toEqual([
      "requesting-camera",
      "error",
      "requesting-camera",
      "loading-model",
      "running",
    ]);
  });
});

describe("vision session: stop and dispose", () => {
  it("stops every track, clears srcObject, cancels the loop and then stays silent", async () => {
    const h = await startRunning();
    h.run(0, 500, FPS, () => twoFaces());
    const detections = h.detector.timestamps.length;
    expect(detections).toBeGreaterThan(10);

    await h.session.stop();
    expect(h.devices.streams[0]?.allStopped).toBe(true);
    expect(h.video.srcObject).toBeNull();
    expect(h.frames.pendingCount).toBe(0);
    expect(h.frames.cancelCount).toBeGreaterThanOrEqual(1);
    expect(h.events.at(-1)).toMatchObject({
      type: "status-changed",
      status: "idle",
      previous: "running",
    });

    const count = h.events.length;
    h.run(600, 1500, FPS, () => twoFaces());
    h.devices.streams[0]?.tracks[0]?.simulateEnded();
    await h.session.stop();
    expect(h.detector.timestamps).toHaveLength(detections);
    expect(h.events).toHaveLength(count);

    const diagnostics = h.session.getDiagnostics();
    expect(diagnostics).toMatchObject({
      status: "idle",
      facesDetected: 0,
      processingFps: null,
      frameTimestamp: null,
      unassignedFaces: [],
    });
    expect(diagnostics.players[1].tracking).toBe("unassigned");
    expect(diagnostics.players[1].gesture.calibration).toBe("none");
  });

  it("cancels a pending start and stops the stream that arrives late", async () => {
    const h = createHarness();
    h.devices.behaviors = ["defer"];
    const pending = h.session.start();
    expect(h.session.getStatus()).toBe("requesting-camera");
    await h.session.stop();
    const count = h.events.length;
    expect(h.events.at(-1)).toMatchObject({ type: "status-changed", status: "idle" });

    h.devices.releaseDeferred();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(h.devices.streams[0]?.allStopped).toBe(true);
    expect(h.video.srcObject).toBeNull();
    expect(h.session.getStatus()).toBe("idle");
    expect(h.events).toHaveLength(count);
  });

  it("starts again after stop and reuses the loaded model", async () => {
    const h = await startRunning();
    await h.session.stop();
    expect(await h.session.start()).toEqual({ ok: true });
    expect(h.loadCount()).toBe(1);
    expect(h.devices.calls).toHaveLength(2);
    expect(h.video.srcObject).toBe(h.devices.streams[1]);
    h.run(0, 200, FPS, () => twoFaces());
    expect(h.detector.timestamps.length).toBeGreaterThan(0);
  });

  it("disposes: stops, releases the model once, and refuses to restart", async () => {
    const h = await startRunning();
    const disposing = h.session.dispose();
    expect(h.session.dispose()).toBe(disposing);
    await disposing;
    expect(h.detector.closeCount).toBe(1);
    expect(h.devices.streams[0]?.allStopped).toBe(true);
    const count = h.events.length;
    expect(await h.session.start()).toMatchObject({ ok: false, error: { code: "unknown" } });
    h.session.useDefaultCalibration();
    expect(h.events).toHaveLength(count);
    expect(h.devices.calls).toHaveLength(1);
  });

  it("disposes a session that never started without loading anything", async () => {
    const h = createHarness();
    await h.session.dispose();
    expect(h.loadCount()).toBe(0);
    expect(h.events).toHaveLength(0);
  });

  it("supports idempotent unsubscribe", async () => {
    const h = createHarness();
    const received: VisionEvent[] = [];
    const unsubscribe = h.session.subscribe((event) => received.push(event));
    unsubscribe();
    unsubscribe();
    await h.session.start();
    expect(received).toHaveLength(0);
    expect(h.events.length).toBeGreaterThan(0);
  });
});

describe("vision session: runtime failures", () => {
  it("reports camera-disconnected when the track ends while running", async () => {
    const h = await startRunning();
    h.run(0, 300, FPS, () => twoFaces());
    h.devices.streams[0]?.tracks[0]?.simulateEnded();
    expectFailure(h, "camera-disconnected");
    expect(h.video.srcObject).toBeNull();
    expect(h.frames.pendingCount).toBe(0);
    const detections = h.detector.timestamps.length;
    h.run(400, 800, FPS, () => twoFaces());
    expect(h.detector.timestamps).toHaveLength(detections);
  });

  it("tolerates occasional inference errors and fails after repeated ones", async () => {
    const h = await startRunning();
    h.detector.throwCount = 2;
    h.run(0, 300, FPS, () => twoFaces());
    expect(h.session.getStatus()).toBe("running");
    h.detector.throwCount = 3;
    h.run(400, 600, FPS, () => twoFaces());
    expectFailure(h, "inference-failed");
  });
});

describe("vision session: frames", () => {
  it("gives the detector strictly increasing timestamps and skips frames without video data", async () => {
    const h = await startRunning();
    h.video.videoWidth = 0;
    h.frames.tick(0);
    expect(h.detector.timestamps).toEqual([]);
    expect(h.frames.pendingCount).toBe(1);
    h.video.videoWidth = 1280;
    h.frames.tick(10);
    h.frames.tick(10);
    h.frames.tick(5);
    expect(h.detector.timestamps).toEqual([10, 11, 12]);
  });
});

describe("vision session: gestures and events", () => {
  it("orders assignment events and emits one gesture per blink and per mouth opening", async () => {
    const { h, t } = await readyPair();
    const types = h.events.map((event) => event.type);
    expect(types.indexOf("faces-changed")).toBeLessThan(types.indexOf("players-assigned"));
    expect(h.ofType("faces-changed")).toMatchObject([{ count: 2 }]);
    expect(h.ofType("players-assigned")).toMatchObject([{ reason: "calibration" }]);
    expect(h.ofType("calibration-complete").map((event) => [event.playerId, event.mode])).toEqual([
      [1, "default"],
      [2, "default"],
    ]);

    // Player 1 closes their eyes and holds them closed for a second.
    let now = h.run(t, t + 1000, FPS, () => twoFaces({ 1: { ear: EYES_CLOSED } }));
    now = h.run(now + STEP, now + 500, FPS, () => twoFaces());
    const blinks = h.ofType("gesture");
    expect(blinks).toHaveLength(1);
    expect(blinks[0]).toMatchObject({ type: "gesture", playerId: 1, gesture: "blink" });
    expect(blinks[0]?.timestamp).toBeGreaterThanOrEqual(t + 80);
    expect(h.detector.timestamps).toContain(blinks[0]?.timestamp);

    // Player 2 opens their mouth and holds it open.
    now = h.run(now + STEP, now + 1000, FPS, () => twoFaces({ 2: { mar: MOUTH_OPEN } }));
    h.run(now + STEP, now + 500, FPS, () => twoFaces());
    expect(h.ofType("gesture").map((event) => [event.playerId, event.gesture])).toEqual([
      [1, "blink"],
      [2, "mouth-open"],
    ]);
  });

  it("ignores winks and the other player's gesture", async () => {
    const { h, t } = await readyPair();
    let now = h.run(t, t + 600, FPS, () => twoFaces({ 1: { rightEar: EYES_CLOSED } }));
    now = h.run(now + STEP, now + 600, FPS, () => twoFaces({ 1: { mar: MOUTH_OPEN } }));
    h.run(now + STEP, now + 600, FPS, () => twoFaces({ 2: { ear: EYES_CLOSED } }));
    expect(h.ofType("gesture")).toEqual([]);
  });

  it("never fires for a reacquired face until the reset condition is seen", async () => {
    const { h, t } = await readyPair();
    const onlyPlayer2 = (): readonly ReturnType<typeof makeFace>[] => [makeFace({ cx: 0.3 })];
    let now = h.run(t, t + 1000, FPS, onlyPlayer2);
    expect(h.ofType("face-lost")).toMatchObject([{ playerId: 1 }]);

    // Player 1 comes back with their eyes already closed and keeps them closed.
    now = h.run(now + STEP, now + 1000, FPS, () => twoFaces({ 1: { ear: EYES_CLOSED } }));
    expect(h.ofType("face-found")).toMatchObject([{ playerId: 1 }]);
    expect(h.ofType("gesture")).toEqual([]);
    expect(h.session.getDiagnostics().players[1].gesture.state).toBe("disarmed");

    // Eyes open (reset condition), then a real blink.
    now = h.run(now + STEP, now + 300, FPS, () => twoFaces());
    h.run(now + STEP, now + 300, FPS, () => twoFaces({ 1: { ear: EYES_CLOSED } }));
    expect(h.ofType("gesture")).toMatchObject([{ playerId: 1, gesture: "blink" }]);
    expect(h.ofType("face-lost")).toHaveLength(1);
    expect(h.ofType("face-found")).toHaveLength(1);
  });
});

describe("vision session: calibration", () => {
  it("fails with not-running before start", () => {
    const h = createHarness();
    h.session.startCalibration();
    expect(h.events).toMatchObject([
      { type: "calibration-failed", playerId: null, reason: "not-running" },
    ]);
  });

  it("calibrates both players concurrently, then detects their gestures", async () => {
    const { h, t } = await calibratedPair();
    expect(h.ofType("calibration-complete").map((event) => [event.playerId, event.mode])).toEqual([
      [1, "calibrated"],
      [2, "calibrated"],
    ]);
    expect(h.ofType("calibration-failed")).toEqual([]);
    expect(h.ofType("gesture")).toEqual([]); // nothing fires while calibrating
    const progress = h.ofType("calibration-progress");
    expect(progress[0]).toMatchObject({ playerId: null, step: "assign-players", progress: 0 });

    const debug = h.session.getDebugSnapshot();
    expect(debug.players[1].levels.neutral).toBeCloseTo(0.3, 2);
    expect(debug.players[1].levels.active).toBeLessThan(0.15);
    expect(debug.players[2].levels.neutral).toBeCloseTo(0.05, 2);
    expect(debug.players[2].levels.active).toBeGreaterThan(0.4);
    expect(h.session.getDiagnostics().players[1].gesture.calibration).toBe("calibrated");

    const now = h.run(t, t + 300, FPS, () => twoFaces());
    h.run(now + STEP, now + 400, FPS, () => twoFaces({ 1: { ear: EYES_CLOSED } }));
    expect(h.ofType("gesture")).toMatchObject([{ playerId: 1, gesture: "blink" }]);
  });

  it("keeps calibration with the player id when the players are swapped", async () => {
    const { h, t } = await calibratedPair();
    h.session.swapPlayers();
    expect(h.ofType("players-assigned").at(-1)).toMatchObject({ reason: "swapped" });
    const diagnostics = h.session.getDiagnostics();
    expect(diagnostics.players[1].gesture.calibration).toBe("calibrated");
    expect(diagnostics.players[1].gesture.state).toBe("disarmed");

    const now = h.run(t, t + 300, FPS, () => twoFaces());
    const player1Rect = h.session.getDiagnostics().players[1].faceRect;
    expect(player1Rect && player1Rect.x).toBeGreaterThan(0.5);
    // The face on the right (formerly Player 2) now blinks for Player 1.
    h.run(now + STEP, now + 400, FPS, () => twoFaces({ 2: { ear: EYES_CLOSED } }));
    expect(h.ofType("gesture")).toMatchObject([{ playerId: 1, gesture: "blink" }]);
  });

  it("reports calibration as cancelled when the session stops", async () => {
    const h = await startRunning();
    const last = h.run(0, 1000, FPS, () => twoFaces());
    h.session.startCalibration();
    h.run(last + STEP, last + 500, FPS, () => twoFaces());
    await h.session.stop();
    expect(h.events.slice(-3)).toMatchObject([
      { type: "calibration-failed", playerId: 1, reason: "cancelled" },
      { type: "calibration-failed", playerId: 2, reason: "cancelled" },
      { type: "status-changed", status: "idle" },
    ]);
  });

  it("cancels, or replaces a player's calibration with defaults", async () => {
    const h = await startRunning();
    const last = h.run(0, 1000, FPS, () => twoFaces());
    h.session.startCalibration();
    h.run(last + STEP, last + 500, FPS, () => twoFaces());
    h.session.useDefaultCalibration([2]);
    expect(h.ofType("calibration-complete")).toMatchObject([{ playerId: 2, mode: "default" }]);
    h.session.cancelCalibration();
    expect(h.ofType("calibration-failed")).toMatchObject([{ playerId: 1, reason: "cancelled" }]);
    h.session.cancelCalibration();
    expect(h.ofType("calibration-failed")).toHaveLength(1);
  });
});

describe("vision session: diagnostics", () => {
  it("reports faces, players, thresholds and timing", async () => {
    const { h, t } = await readyPair();
    const last = h.run(t, t + 1000, FPS, () => [...twoFaces(), makeFace({ cx: 0.5, widthPx: 90 })]);
    const diagnostics = h.session.getDiagnostics();
    expect(diagnostics).toMatchObject({ status: "running", mirrored: true, facesDetected: 3 });
    expect(diagnostics.frameTimestamp).toBe(last);
    expect(diagnostics.processingFps).toBeCloseTo(30, 0);
    expect(diagnostics.inferenceMs).toBe(0);
    expect(diagnostics.unassignedFaces).toHaveLength(1);

    const [p1, p2] = [diagnostics.players[1], diagnostics.players[2]];
    expect(p1).toMatchObject({ playerId: 1, tracking: "tracked", lastSeenAt: last });
    expect(p1.faceRect?.x ?? 1).toBeLessThan(p2.faceRect?.x ?? 0);
    expect(p1.gesture).toMatchObject({
      gesture: "blink",
      enterThreshold: 0.6,
      exitThreshold: 0.35,
      state: "idle",
      calibration: "default",
      cooldownRemainingMs: 0,
      lastGestureAt: null,
    });
    expect(p1.gesture.rawMetric).toBeCloseTo(0.3);
    expect(p1.gesture.score).toBe(0);
    expect(p2.gesture).toMatchObject({
      gesture: "mouth-open",
      enterThreshold: 0.55,
      exitThreshold: 0.3,
    });
  });

  it("assigns Player 1 to the left of an unmirrored preview", async () => {
    const h = await startRunning({ mirrored: false });
    h.run(0, 1000, FPS, () => [makeFace({ cx: 0.7 }), makeFace({ cx: 0.3 })]);
    const rect = h.session.getDiagnostics().players[1].faceRect;
    expect(rect && rect.x + rect.width / 2).toBeCloseTo(0.3);
  });
});
