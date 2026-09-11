import { describe, expect, it } from "vitest";
import type { PlayerId, PlayerTrackingState } from "../../src/shared";
import {
  createCalibrationRun,
  type CalibrationRun,
  type CalibrationRunEvent,
} from "../../src/vision/calibration/calibration";
import { median, robustSpread } from "../../src/vision/calibration/stats";
import { DEFAULT_VISION_CONFIG } from "../../src/vision/config";

const TUNING = {
  1: DEFAULT_VISION_CONFIG.metrics.geometry.blink,
  2: DEFAULT_VISION_CONFIG.metrics.geometry["mouth-open"],
} as const;
const FPS = 30;
const STEP = 1000 / FPS;

function newRun(players: readonly PlayerId[] = [1, 2]): CalibrationRun {
  return createCalibrationRun({
    players,
    tuning: TUNING,
    config: DEFAULT_VISION_CONFIG.calibration,
    assignmentStableMs: DEFAULT_VISION_CONFIG.assignment.assignmentStableMs,
  });
}

interface Script {
  readonly metric: (t: number) => number | null;
  readonly tracking?: (t: number) => PlayerTrackingState;
}

interface Recorded {
  readonly t: number;
  readonly event: CalibrationRunEvent;
}

function drive(
  run: CalibrationRun,
  from: number,
  to: number,
  scripts: Partial<Record<PlayerId, Script>>,
  locked = true,
): Recorded[] {
  const events: Recorded[] = [];
  for (let t = from; t <= to + 1e-9; t += STEP) {
    const player = (playerId: PlayerId) => {
      const script = scripts[playerId];
      const metric = script ? script.metric(t) : null;
      return {
        tracking: script ? (script.tracking?.(t) ?? "tracked") : ("unassigned" as const),
        rawMetric: metric,
        smoothedMetric: metric,
      };
    };
    for (const event of run.update({
      timestampMs: t,
      locked,
      lockProgress: locked ? 1 : 0,
      players: { 1: player(1), 2: player(2) },
    })) {
      events.push({ t, event });
    }
  }
  return events;
}

/** Deterministic ±amplitude noise. */
function noise(amplitude: number): (t: number) => number {
  return (t) => amplitude * Math.sin(t * 0.37) * Math.cos(t * 0.11);
}

/** Three 250 ms gestures, starting 500 ms into the gesture step (which starts at 2033 ms). */
function gestureAt(t: number, count = 3): boolean {
  const rel = t - 2500;
  return rel >= 0 && rel < count * 1000 && rel % 1000 < 250;
}

const blink = (closed = 0.1, count = 3) => ({
  metric: (t: number) => (gestureAt(t, count) ? closed : 0.3 + noise(0.004)(t)),
});
const mouth = (open = 0.5, count = 3) => ({
  metric: (t: number) => (gestureAt(t, count) ? open : 0.05 + noise(0.004)(t)),
});

const complete = (events: Recorded[]) =>
  events.flatMap(({ event }) => (event.type === "calibration-complete" ? [event] : []));
const failed = (events: Recorded[]) =>
  events.flatMap(({ event }) => (event.type === "calibration-failed" ? [event] : []));

describe("calibration run", () => {
  it("derives neutral and gesture levels for both players concurrently", () => {
    const run = newRun();
    const begin = run.begin(0);
    expect(begin).toEqual([
      { type: "calibration-progress", playerId: null, step: "assign-players", progress: 0 },
    ]);
    const events = drive(run, STEP, 8000, { 1: blink(), 2: mouth() });

    const results = complete(events);
    expect(results.map((event) => event.playerId)).toEqual([1, 2]);
    expect(results[0]?.levels.neutral).toBeCloseTo(0.3, 2);
    expect(results[0]?.levels.active).toBeCloseTo(0.1, 5);
    expect(results[1]?.levels.neutral).toBeCloseTo(0.05, 2);
    expect(results[1]?.levels.active).toBeCloseTo(0.5, 5);
    expect(failed(events)).toEqual([]);
    expect(run.isActive()).toBe(false);

    const steps = events.flatMap(({ event }) =>
      event.type === "calibration-progress" && event.playerId !== 2 ? [event.step] : [],
    );
    expect([...new Set(steps)]).toEqual(["assign-players", "neutral", "gesture"]);
    // Progress is throttled, not one event per frame.
    expect(events.length).toBeLessThan(60);
  });

  it("fails with gesture-not-detected when the gesture is too small", () => {
    const run = newRun();
    run.begin(0);
    const events = drive(run, STEP, 14_000, { 1: blink(0.27), 2: mouth() });
    expect(failed(events)).toEqual([
      { type: "calibration-failed", playerId: 1, reason: "gesture-not-detected" },
    ]);
    expect(complete(events).map((event) => event.playerId)).toEqual([2]);
  });

  it("times out when too few repetitions are seen", () => {
    const run = newRun([1]);
    run.begin(0);
    const events = drive(run, STEP, 14_000, { 1: blink(0.1, 1) });
    expect(failed(events)).toEqual([
      { type: "calibration-failed", playerId: 1, reason: "timeout" },
    ]);
  });

  it("fails with unstable-measurements when the neutral signal is noisy", () => {
    const run = newRun([1]);
    run.begin(0);
    let frame = 0;
    const events = drive(run, STEP, 3000, { 1: { metric: () => (frame++ % 2 === 0 ? 0.2 : 0.4) } });
    expect(failed(events)).toEqual([
      { type: "calibration-failed", playerId: 1, reason: "unstable-measurements" },
    ]);
  });

  it("fails with not-enough-faces when the players are never assigned", () => {
    const run = newRun();
    run.begin(0);
    const events = drive(run, STEP, 11_000, { 1: blink() }, false);
    expect(failed(events)).toEqual([
      { type: "calibration-failed", playerId: null, reason: "not-enough-faces" },
    ]);
  });

  it("fails a player whose face is lost, and lets the other continue", () => {
    const run = newRun();
    run.begin(0);
    const events = drive(run, STEP, 8000, {
      1: blink(),
      2: { ...mouth(), tracking: (t) => (t > 1000 && t < 1600 ? "lost" : "tracked") },
    });
    expect(failed(events)).toEqual([
      { type: "calibration-failed", playerId: 2, reason: "face-lost" },
    ]);
    expect(complete(events).map((event) => event.playerId)).toEqual([1]);
  });

  it("reports cancellation per player, or once while assigning", () => {
    const measuring = newRun();
    measuring.begin(0);
    drive(measuring, STEP, 500, { 1: blink(), 2: mouth() });
    expect(measuring.cancel("cancelled")).toEqual([
      { type: "calibration-failed", playerId: 1, reason: "cancelled" },
      { type: "calibration-failed", playerId: 2, reason: "cancelled" },
    ]);
    expect(measuring.isActive()).toBe(false);

    const assigning = newRun();
    assigning.begin(0);
    expect(assigning.cancel("cancelled")).toEqual([
      { type: "calibration-failed", playerId: null, reason: "cancelled" },
    ]);
  });

  it("calibrates a single player without a lock once the face is stable", () => {
    const run = newRun([1]);
    run.begin(0);
    // Measuring starts ~750 ms later than with a lock, so the gestures come later too.
    const events = drive(
      run,
      STEP,
      9000,
      { 1: { metric: (t) => (gestureAt(t - 800) ? 0.1 : 0.3) } },
      false,
    );
    const firstNeutral = events.find(
      ({ event }) => event.type === "calibration-progress" && event.step === "neutral",
    );
    expect(firstNeutral?.t).toBeGreaterThanOrEqual(
      DEFAULT_VISION_CONFIG.assignment.assignmentStableMs,
    );
    expect(complete(events).map((event) => event.playerId)).toEqual([1]);
  });

  it("restarts the neutral step after a swap", () => {
    const run = newRun();
    run.begin(0);
    drive(run, STEP, 1000, { 1: blink(), 2: mouth() });
    const restart = run.restartMeasurements(1010);
    expect(restart).toEqual([
      { type: "calibration-progress", playerId: 1, step: "neutral", progress: 0 },
      { type: "calibration-progress", playerId: 2, step: "neutral", progress: 0 },
    ]);
    const events = drive(run, 1010 + STEP, 3500, { 1: blink(), 2: mouth() });
    const firstGesture = events.find(
      ({ event }) => event.type === "calibration-progress" && event.step === "gesture",
    );
    expect(firstGesture?.t).toBeGreaterThanOrEqual(
      1010 + DEFAULT_VISION_CONFIG.calibration.neutralMs,
    );
  });

  it("goes back to assigning players after a reset", () => {
    const run = newRun();
    run.begin(0);
    drive(run, STEP, 500, { 1: blink(), 2: mouth() });
    expect(run.restartAssignment(600)).toEqual([
      { type: "calibration-progress", playerId: null, step: "assign-players", progress: 0 },
    ]);
    expect(run.status(1)?.step).toBe("assign-players");
  });
});

describe("calibration statistics", () => {
  it("computes medians", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("computes a robust spread that ignores an outlier such as a natural blink", () => {
    const samples = [0.3, 0.31, 0.29, 0.3, 0.3, 0.31, 0.29, 0.08];
    expect(robustSpread(samples)).toBeLessThan(0.02);
    expect(robustSpread([])).toBeNull();
  });
});
