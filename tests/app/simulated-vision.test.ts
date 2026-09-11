import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSimulatedVisionSession } from "../../src/app/dev/simulated-vision";
import type { VisionEvent, VisionSession } from "../../src/shared";

const STEP = 100;

function key(value: string, init: { repeat?: boolean } = {}): Event {
  return Object.assign(new Event("keydown"), { key: value, repeat: init.repeat ?? false });
}

describe("simulated vision session (dev only)", () => {
  let target: EventTarget;
  let session: VisionSession;
  let events: VisionEvent[];

  beforeEach(() => {
    vi.useFakeTimers();
    target = new EventTarget();
    session = createSimulatedVisionSession(
      { video: {} as HTMLVideoElement, mirrored: true },
      {
        keyTarget: target,
        now: () => Date.now(),
        schedule: (callback, ms) => {
          const handle = setTimeout(callback, ms);
          return () => clearTimeout(handle);
        },
        stepMs: STEP,
      },
    );
    events = [];
    session.subscribe((event) => events.push(event));
  });

  afterEach(async () => {
    await session.dispose();
    vi.useRealTimers();
  });

  const types = () => events.map((event) => event.type);
  const gestures = () =>
    events.flatMap((event) =>
      event.type === "gesture" ? [`${event.playerId}:${event.gesture}`] : [],
    );

  async function startRunning(): Promise<void> {
    const started = session.start();
    await vi.advanceTimersByTimeAsync(STEP * 3);
    await expect(started).resolves.toEqual({ ok: true });
  }

  it("starts through the loading states like the real session", async () => {
    const started = session.start();
    expect(session.getStatus()).toBe("requesting-camera");
    await vi.advanceTimersByTimeAsync(STEP);
    expect(session.getStatus()).toBe("loading-model");
    await vi.advanceTimersByTimeAsync(STEP * 2);
    await expect(started).resolves.toEqual({ ok: true });
    expect(session.getStatus()).toBe("running");
    expect(events).toContainEqual(expect.objectContaining({ type: "faces-changed", count: 2 }));
    expect(session.getDiagnostics().unassignedFaces).toHaveLength(2);
  });

  it("fires gestures only for calibrated players", async () => {
    await startRunning();
    target.dispatchEvent(key("1"));
    expect(gestures()).toEqual([]);

    session.startCalibration();
    await vi.advanceTimersByTimeAsync(STEP * 10);
    expect(types()).toContain("players-assigned");
    expect(events.filter((event) => event.type === "calibration-complete")).toHaveLength(2);

    target.dispatchEvent(key("1"));
    target.dispatchEvent(key("2"));
    target.dispatchEvent(key("2", { repeat: true }));
    expect(gestures()).toEqual(["1:blink", "2:mouth-open"]);
  });

  it("applies default calibration per player", async () => {
    await startRunning();
    session.useDefaultCalibration([2]);
    expect(events.at(-1)).toMatchObject({
      type: "calibration-complete",
      playerId: 2,
      mode: "default",
    });
    expect(session.getDiagnostics().players[2].gesture.calibration).toBe("default");
  });

  it("fails calibration with too few faces", async () => {
    await startRunning();
    target.dispatchEvent(key("5"));
    session.startCalibration([1, 2]);
    await vi.advanceTimersByTimeAsync(STEP * 2);
    expect(events.at(-1)).toMatchObject({ type: "calibration-failed", reason: "not-enough-faces" });
  });

  it("toggles lost faces and simulates a disconnect", async () => {
    await startRunning();
    session.useDefaultCalibration();
    session.startCalibration([1]);
    await vi.advanceTimersByTimeAsync(STEP);
    target.dispatchEvent(key("3"));
    target.dispatchEvent(key("3"));
    expect(types()).toEqual(expect.arrayContaining(["face-lost", "face-found"]));

    target.dispatchEvent(key("6"));
    expect(types().slice(-3)).toEqual(["calibration-failed", "error", "status-changed"]);
    expect(session.getStatus()).toBe("error");
  });

  it("stops cleanly: idle, keys detached, pending start resolved", async () => {
    const started = session.start();
    await session.stop();
    await expect(started).resolves.toMatchObject({ ok: false });
    expect(session.getStatus()).toBe("idle");

    await startRunning();
    await session.stop();
    const count = events.length;
    target.dispatchEvent(key("5"));
    await vi.advanceTimersByTimeAsync(STEP * 10);
    expect(events).toHaveLength(count);
  });
});
