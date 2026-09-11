import { describe, expect, it } from "vitest";
import { createGameEngine, createManualFrameScheduler, type GameState } from "../../src/game";
import { createFixedStepClock } from "../../src/game/loop/fixed-step";
import { randomUint32 } from "../../src/game/random";
import type { PlayerId } from "../../src/shared";
import { cloneState, runUntilGameOver } from "./helpers";

const CLOCK = { fixedStepMs: 1000 / 120, maxFrameDeltaMs: 100 };

describe("fixed-step clock", () => {
  it("uses whole microseconds per step", () => {
    expect(createFixedStepClock(CLOCK).stepUs).toBe(8333);
  });

  it("returns whole steps and carries the remainder", () => {
    const clock = createFixedStepClock(CLOCK);
    expect(clock.add(8.333)).toBe(1);
    expect(clock.add(4)).toBe(0);
    expect(clock.add(4.333)).toBe(1);
    expect(clock.add(8.333 * 3)).toBe(3);
  });

  it("accumulates many tiny deltas without loss", () => {
    const clock = createFixedStepClock(CLOCK);
    let steps = 0;
    for (let i = 0; i < 100_000; i += 1) steps += clock.add(0.01);
    expect(steps).toBe(Math.floor(1_000_000 / 8333));
  });

  it("clamps large deltas to maxFrameDeltaMs", () => {
    expect(createFixedStepClock(CLOCK).add(5000)).toBe(Math.floor(100_000 / 8333));
    expect(createFixedStepClock(CLOCK).add(Number.POSITIVE_INFINITY)).toBe(12);
  });

  it("ignores zero, negative and NaN deltas", () => {
    const clock = createFixedStepClock(CLOCK);
    for (const dt of [0, -5, -Infinity, Number.NaN]) expect(clock.add(dt)).toBe(0);
    expect(clock.add(8.333)).toBe(1);
  });

  it("reset() drops accumulated time", () => {
    const clock = createFixedStepClock(CLOCK);
    clock.add(8);
    clock.reset();
    expect(clock.add(1)).toBe(0);
  });

  it.each([30, 60, 144])("counts the same steps per second at %i Hz", (hz) => {
    const clock = createFixedStepClock(CLOCK);
    let steps = 0;
    for (let second = 1; second <= 120; second += 1) {
      for (let frame = 0; frame < hz; frame += 1) steps += clock.add(1000 / hz);
      expect(steps).toBe(Math.floor((second * 1_000_000) / 8333));
    }
  });
});

/** P1 and P2 jump at these simulated times (common 30/60/120/144 Hz frame boundaries). */
const JUMPS = new Map<number, PlayerId[]>([
  [1000, [1]],
  [1500, [2]],
  [2000, [1, 2]],
  [3500, [1]],
  [4000, [2]],
  [5500, [1, 2]],
  [7000, [2]],
  [8500, [1]],
]);
const CHECKPOINT_MS = 500;
const CHECKPOINTS = 24; // 12 s

/** Advance with the given frame deltas per checkpoint; jump on checkpoint boundaries. */
function simulate(framesPerCheckpoint: (checkpoint: number) => readonly number[]): GameState[] {
  const engine = createGameEngine({ seed: 77 });
  engine.start();
  const states: GameState[] = [];
  for (let checkpoint = 1; checkpoint <= CHECKPOINTS; checkpoint += 1) {
    for (const dt of framesPerCheckpoint(checkpoint)) engine.advance(dt);
    states.push(cloneState(engine.getState()));
    for (const id of JUMPS.get(checkpoint * CHECKPOINT_MS) ?? []) engine.jumpPlayer(id);
  }
  return states;
}

const regular = (hz: number) => () =>
  Array.from({ length: (hz * CHECKPOINT_MS) / 1000 }, () => 1000 / hz);

/** Irregular frames (1–60 ms, whole microseconds) that add up to exactly 500 ms. */
function jittered(seed: number) {
  let state = seed;
  return () => {
    const frames: number[] = [];
    let remainingUs = CHECKPOINT_MS * 1000;
    while (remainingUs > 0) {
      const draw = randomUint32(state);
      state = draw.state;
      const us = Math.min(remainingUs, 1000 + (draw.value % 59_000));
      frames.push(us / 1000);
      remainingUs -= us;
    }
    return frames;
  };
}

describe("frame-rate independence", () => {
  const reference = simulate(regular(60));

  it("reaches a meaningful state (jumps happened, both players crashed)", () => {
    const last = reference[reference.length - 1]!;
    expect(last.players[1].jumps + last.players[2].jumps).toBeGreaterThan(2);
    expect(last.status).toBe("game-over");
  });

  it.each([30, 120, 144])("gives the same states at %i Hz as at 60 Hz", (hz) => {
    expect(simulate(regular(hz))).toEqual(reference);
  });

  it("gives the same states with irregular frame deltas", () => {
    expect(simulate(jittered(1))).toEqual(reference);
    expect(simulate(jittered(2))).toEqual(reference);
  });
});

describe("frame delta clamping", () => {
  it("advances at most maxFrameDeltaMs per call", () => {
    const engine = createGameEngine({ seed: 1 });
    engine.start();
    engine.advance(5000);
    expect(engine.getState().stepCount).toBe(12);
    expect(engine.getState().elapsedMs).toBeLessThanOrEqual(engine.config.maxFrameDeltaMs);
  });

  it("never teleports through obstacles after a long pause in frames", () => {
    const huge = createGameEngine({ seed: 6 });
    const clamped = createGameEngine({ seed: 6 });
    huge.start();
    clamped.start();
    let calls = 0;
    while (huge.getState().status === "running" && calls < 1000) {
      huge.advance(60_000);
      calls += 1;
    }
    for (let i = 0; i < calls; i += 1) clamped.advance(100);
    expect(huge.getState().status).toBe("game-over");
    expect(huge.getState()).toEqual(clamped.getState());
    // The crash happened at the first obstacle, not somewhere past it.
    const crash = huge.getState().players[1].crash!;
    const first = crash.obstacles[0]!;
    expect(crash.distance + huge.config.dinoX).toBeLessThan(first.x + first.width);
    expect(runUntilGameOver(huge)).toBe(0);
  });
});

describe("manual frame scheduler", () => {
  it("runs pending callbacks on tick with the given timestamp", () => {
    const scheduler = createManualFrameScheduler();
    const seen: number[] = [];
    scheduler.request((t) => seen.push(t));
    scheduler.request((t) => seen.push(t + 1));
    expect(scheduler.pendingCount).toBe(2);
    scheduler.tick(10);
    expect(seen).toEqual([10, 11]);
    expect(scheduler.pendingCount).toBe(0);
  });

  it("defers callbacks requested during a tick to the next tick", () => {
    const scheduler = createManualFrameScheduler();
    const seen: number[] = [];
    const loop = (t: number): void => {
      seen.push(t);
      scheduler.request(loop);
    };
    scheduler.request(loop);
    scheduler.tick(1);
    scheduler.tick(2);
    expect(seen).toEqual([1, 2]);
    expect(scheduler.pendingCount).toBe(1);
  });

  it("cancels a pending callback", () => {
    const scheduler = createManualFrameScheduler();
    let called = false;
    const handle = scheduler.request(() => {
      called = true;
    });
    scheduler.cancel(handle);
    scheduler.tick(1);
    expect(called).toBe(false);
    expect(scheduler.pendingCount).toBe(0);
  });
});
