import { describe, expect, it } from "vitest";
import type { GameEvent, VisionEvent } from "../../src/shared";
import { FakeGameController } from "./fake-game";
import { FakeInputSource } from "./fake-input";
import { FakeVisionSession, visionError } from "./fake-vision";
import { ManualFrameScheduler } from "./frame-scheduler";

// The fakes must stay faithful to the contract TSDoc in src/shared, or app tests would pass
// against behaviour the real modules do not have. These tests pin the behaviour we rely on.

describe("FakeGameController", () => {
  it("follows the GameController status machine and emits status-changed", () => {
    const game = new FakeGameController();
    const events: GameEvent[] = [];
    game.subscribe((event) => events.push(event));

    game.pause(); // ignored in ready
    game.start();
    game.start(); // ignored in running
    game.pause();
    game.resume();
    game.restart();

    expect(events.map((event) => event.type === "status-changed" && event.status)).toEqual([
      "running",
      "paused",
      "running",
      "running",
    ]);
    expect(game.count("start")).toBe(2);
    expect(game.getSnapshot().status).toBe("running");
  });

  it("records every jump but accepts only jumps a running game would apply", () => {
    const game = new FakeGameController();
    game.jumpPlayer(1);
    game.start();
    game.jumpPlayer(2);
    game.crash(2);
    game.jumpPlayer(2);

    expect(game.jumps).toEqual([1, 2, 2]);
    expect(game.acceptedJumps).toEqual([2]);
  });

  it("emits status-changed before game-over when a round finishes", () => {
    const game = new FakeGameController({ status: "running" });
    const types: string[] = [];
    game.subscribe((event) => types.push(event.type));
    game.finish({ winner: 1, scores: { 1: 10, 2: 5 } });

    expect(types).toEqual(["status-changed", "game-over"]);
    expect(game.getSnapshot().result?.winner).toBe(1);
  });

  it("has idempotent unsubscribe", () => {
    const game = new FakeGameController();
    const unsubscribe = game.subscribe(() => undefined);
    unsubscribe();
    unsubscribe();
    expect(game.listenerCount).toBe(0);
  });
});

describe("FakeInputSource", () => {
  it("emits only between start and stop", () => {
    const source = new FakeInputSource();
    const received: number[] = [];
    source.subscribe((action) => received.push(action.playerId));

    expect(source.jump(1)).toBe(false);
    source.start();
    expect(source.jump(2)).toBe(true);
    source.stop();
    expect(source.jump(1)).toBe(false);
    expect(received).toEqual([2]);
  });
});

describe("FakeVisionSession", () => {
  const statuses = (events: VisionEvent[]): string[] =>
    events.flatMap((event) => (event.type === "status-changed" ? [event.status] : []));

  it("starts through requesting-camera and loading-model to running", async () => {
    const session = new FakeVisionSession();
    const events: VisionEvent[] = [];
    session.subscribe((event) => events.push(event));

    await expect(session.start()).resolves.toEqual({ ok: true });
    expect(statuses(events)).toEqual(["requesting-camera", "loading-model", "running"]);
    expect(session.getDiagnostics().status).toBe("running");
  });

  it("resolves failures without rejecting and emits an error event", async () => {
    const session = new FakeVisionSession();
    const events: VisionEvent[] = [];
    session.subscribe((event) => events.push(event));
    session.queueStartResult(visionError("camera-permission-denied"));

    const result = await session.start();
    expect(result.ok).toBe(false);
    expect(statuses(events)).toEqual(["requesting-camera", "error"]);
    // Real session order: `error`, then `status-changed` to `error`.
    expect(events.slice(-2).map((event) => event.type)).toEqual(["error", "status-changed"]);
    expect(events.at(-2)).toMatchObject({
      type: "error",
      error: { code: "camera-permission-denied" },
    });
  });

  it("passes through loading-model for model failures", async () => {
    const session = new FakeVisionSession();
    const events: VisionEvent[] = [];
    session.subscribe((event) => events.push(event));
    session.queueStartResult(visionError("model-load-failed"));
    await session.start();
    expect(statuses(events)).toEqual(["requesting-camera", "loading-model", "error"]);
  });

  it("can hold a start in the loading states", async () => {
    const session = new FakeVisionSession();
    const pending = session.holdNextStart();
    const promise = session.start();
    expect(session.getStatus()).toBe("requesting-camera");
    pending.loadModel();
    expect(session.getStatus()).toBe("loading-model");
    pending.resolve();
    await expect(promise).resolves.toEqual({ ok: true });
    expect(pending.settled).toBe(true);
  });

  it("drops events after stop and can be restarted", async () => {
    const session = new FakeVisionSession();
    const events: VisionEvent[] = [];
    await session.start();
    session.subscribe((event) => events.push(event));

    await session.stop();
    await session.stop();
    expect(session.gesture(1)).toBe(false);
    expect(statuses(events)).toEqual(["idle"]);

    await expect(session.start()).resolves.toEqual({ ok: true });
    expect(session.gesture(1)).toBe(true);
    expect(session.stopCalls).toBe(2);
  });

  it("resolves a held start with a failure when stopped, without an error event", async () => {
    const session = new FakeVisionSession();
    const events: VisionEvent[] = [];
    session.subscribe((event) => events.push(event));
    session.holdNextStart();
    const promise = session.start();
    await session.stop();

    await expect(promise).resolves.toMatchObject({ ok: false });
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(session.getStatus()).toBe("idle");
  });

  it("cannot be started after dispose", async () => {
    const session = new FakeVisionSession();
    await session.dispose();
    await expect(session.start()).resolves.toMatchObject({ ok: false });
  });

  it("emits default calibration results per player", async () => {
    const session = new FakeVisionSession();
    await session.start();
    const events: VisionEvent[] = [];
    session.subscribe((event) => events.push(event));
    session.useDefaultCalibration([2]);
    expect(events).toEqual([
      { type: "calibration-complete", playerId: 2, mode: "default", timestamp: 0 },
    ]);
    expect(session.getDiagnostics().players[2].gesture.calibration).toBe("default");
  });

  it("reports calibration requested while not running as a failure", () => {
    const session = new FakeVisionSession();
    const events: VisionEvent[] = [];
    session.subscribe((event) => events.push(event));
    session.startCalibration();
    expect(events).toMatchObject([{ type: "calibration-failed", reason: "not-running" }]);
  });

  it("ends a running calibration with cancelled, then reports idle, on stop", async () => {
    const session = new FakeVisionSession();
    await session.start();
    session.startCalibration();
    const events: VisionEvent[] = [];
    session.subscribe((event) => events.push(event));
    await session.stop();
    expect(events.map((event) => event.type)).toEqual(["calibration-failed", "status-changed"]);
    expect(events[0]).toMatchObject({ reason: "cancelled" });
  });

  it("reports a runtime failure as not-running calibration, error, then status error", async () => {
    const session = new FakeVisionSession();
    await session.start();
    session.startCalibration([1]);
    const events: VisionEvent[] = [];
    session.subscribe((event) => events.push(event));
    session.fail("camera-disconnected");
    expect(events.map((event) => event.type)).toEqual([
      "calibration-failed",
      "error",
      "status-changed",
    ]);
    expect(session.getStatus()).toBe("error");
  });

  it("applies default calibration in any status, once per player", () => {
    const session = new FakeVisionSession();
    const events: VisionEvent[] = [];
    session.subscribe((event) => events.push(event));
    session.useDefaultCalibration([1, 1]);
    expect(events).toEqual([
      { type: "calibration-complete", playerId: 1, mode: "default", timestamp: 0 },
    ]);
  });

  it("keeps calibration with the player id when swapping", async () => {
    const session = new FakeVisionSession();
    await session.start();
    const rect = { x: 0.6, y: 0.2, width: 0.2, height: 0.3 };
    session.completeCalibration(1);
    session.setPlayer(2, { tracking: "tracked", faceRect: rect });
    session.swapPlayers();
    const { players } = session.getDiagnostics();
    expect(players[1].gesture.calibration).toBe("calibrated");
    expect(players[1].faceRect).toEqual(rect);
    expect(players[2].gesture.calibration).toBe("none");
  });
});

describe("ManualFrameScheduler", () => {
  it("runs callbacks requested before the step and honours cancel", () => {
    const scheduler = new ManualFrameScheduler();
    const seen: number[] = [];
    scheduler.request((t) => seen.push(t));
    const cancelled = scheduler.request(() => seen.push(-1));
    scheduler.cancel(cancelled);
    scheduler.step(10);
    scheduler.step(10);
    expect(seen).toEqual([10]);
    expect(scheduler.pendingCount).toBe(0);
  });
});
