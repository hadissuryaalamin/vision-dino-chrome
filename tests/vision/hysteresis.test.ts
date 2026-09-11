import { describe, expect, it } from "vitest";
import type { GestureTuning } from "../../src/vision/config";
import {
  createGestureStateMachine,
  type GestureStateMachine,
} from "../../src/vision/gestures/hysteresis";

const TUNING: GestureTuning = {
  enterThreshold: 0.6,
  exitThreshold: 0.35,
  minActiveMs: 80,
  cooldownMs: 350,
};

/** Feeds `score(t)` at `fps` over [from, to]; returns the timestamps of fired events. */
function run(
  machine: GestureStateMachine,
  from: number,
  to: number,
  fps: number,
  score: (t: number) => number | null,
): number[] {
  const fired: number[] = [];
  const first = Math.ceil((from * fps) / 1000);
  const last = Math.floor((to * fps) / 1000 + 1e-9);
  for (let i = first; i <= last; i++) {
    const t = (i * 1000) / fps;
    if (machine.update(score(t), t)) fired.push(t);
  }
  return fired;
}

function armed(): GestureStateMachine {
  const machine = createGestureStateMachine(TUNING);
  machine.update(0, 0);
  return machine;
}

/** Deterministic pseudo-random numbers in [0, 1). */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("gesture state machine", () => {
  it("starts disarmed and arms only on the reset condition", () => {
    const machine = createGestureStateMachine(TUNING);
    expect(machine.state).toBe("disarmed");
    expect(machine.update(1, 0)).toBe(false);
    expect(machine.update(0.5, 10)).toBe(false);
    expect(machine.state).toBe("disarmed");
    machine.update(0.3, 20);
    expect(machine.state).toBe("idle");
  });

  it("emits exactly one event per activation, after minActiveMs", () => {
    const machine = armed();
    const fired = run(machine, 100, 1000, 30, () => 1);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toBeGreaterThanOrEqual(100 + TUNING.minActiveMs);
    expect(fired[0]).toBeLessThan(100 + TUNING.minActiveMs + 34);
    expect(machine.state).toBe("active");
  });

  it("emits nothing while held and requires the reset condition before the next event", () => {
    const machine = armed();
    expect(run(machine, 100, 2000, 30, () => 1)).toHaveLength(1);
    // Back into the hysteresis band only: still active, so raising again does nothing.
    expect(run(machine, 2001, 2500, 30, () => 0.45)).toHaveLength(0);
    expect(run(machine, 2501, 3000, 30, () => 1)).toHaveLength(0);
    expect(machine.state).toBe("active");
    // Fully released, then a new activation.
    run(machine, 3001, 3100, 30, () => 0.1);
    expect(machine.state).toBe("idle");
    expect(run(machine, 3101, 3500, 30, () => 1)).toHaveLength(1);
  });

  it("never fires from noise inside the hysteresis band", () => {
    const machine = armed();
    const random = lcg(7);
    const fired = run(machine, 1, 10_000, 60, () => 0.36 + random() * 0.23);
    expect(fired).toHaveLength(0);
  });

  it("does not burst when a signal oscillates around the enter threshold", () => {
    const machine = armed();
    const random = lcg(42);
    // One clean activation, then noise between 0.4 and 0.9: never back below exit.
    expect(run(machine, 1, 300, 60, () => 1)).toHaveLength(1);
    expect(run(machine, 301, 5000, 60, () => 0.4 + random() * 0.5)).toHaveLength(0);
  });

  it("rejects spikes shorter than minActiveMs", () => {
    const machine = armed();
    expect(run(machine, 1, 500, 60, (t) => (t >= 100 && t < 150 ? 1 : 0))).toHaveLength(0);
    expect(machine.state).toBe("idle");
    expect(run(machine, 501, 900, 60, (t) => (t >= 600 && t < 720 ? 1 : 0))).toHaveLength(1);
  });

  it("respects the cooldown: a re-activation waits, and is dropped if released early", () => {
    const machine = armed();
    const [first] = run(machine, 100, 300, 60, (t) => (t < 250 ? 1 : 0));
    expect(first).toBeDefined();
    const eventAt = first ?? 0;
    expect(machine.cooldownRemainingMs(eventAt + 100)).toBeCloseTo(250);

    // Released early, re-closed and held: fires only once the cooldown is over.
    const second = run(machine, 301, 1000, 60, (t) => (t >= 330 ? 1 : 0));
    expect(second).toHaveLength(1);
    expect(second[0]).toBeGreaterThanOrEqual(eventAt + TUNING.cooldownMs);

    // A short re-activation that ends inside the cooldown produces nothing.
    run(machine, 1001, 1100, 60, () => 0);
    const [third] = run(machine, 1101, 1300, 60, (t) => (t < 1250 ? 1 : 0));
    expect(third).toBeDefined();
    const thirdAt = third ?? 0;
    const quick = run(machine, 1301, thirdAt + 330, 60, (t) =>
      t >= thirdAt + 150 && t < thirdAt + 300 ? 1 : 0,
    );
    expect(quick).toHaveLength(0);
  });

  it("is disarmed after a reacquire and fires only after the reset condition", () => {
    const machine = armed();
    machine.disarm();
    expect(run(machine, 1, 1000, 30, () => 1)).toHaveLength(0);
    expect(machine.state).toBe("disarmed");
    run(machine, 1001, 1100, 30, () => 0);
    expect(run(machine, 1101, 1500, 30, () => 1)).toHaveLength(1);
  });

  it("cancels pending on a null score and never advances on null", () => {
    const machine = armed();
    machine.update(1, 100);
    machine.update(1, 150);
    expect(machine.state).toBe("pending");
    machine.update(null, 170);
    expect(machine.state).toBe("idle");
    expect(machine.update(1, 200)).toBe(false);
    expect(machine.update(1, 250)).toBe(false); // 50 ms since the restart
    expect(machine.update(1, 280)).toBe(true);
    expect(machine.update(null, 300)).toBe(false);
    expect(machine.state).toBe("active");
    expect(machine.update(1, 800)).toBe(false);
  });

  it("emits the same events at 15, 30 and 60 fps", () => {
    const closedIntervals: [number, number][] = [
      [500, 800],
      [1500, 1700],
      [2600, 2900],
      [3500, 3540], // a 40 ms spike: always rejected
      [4000, 5000], // a long hold: one event
    ];
    const score = (t: number): number =>
      closedIntervals.some(([start, end]) => t >= start && t < end) ? 1 : 0;
    for (const fps of [15, 30, 60]) {
      const machine = armed();
      const fired = run(machine, 1, 6000, fps, score);
      expect(fired, `${fps} fps`).toHaveLength(4);
    }
  });
});
