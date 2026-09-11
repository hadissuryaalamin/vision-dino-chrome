/**
 * Fixed-step accumulator. Real frame deltas are clamped, converted to whole microseconds and
 * accumulated as integers; the rounding remainder is carried to the next delta. Summing the
 * same real time in 30, 60 or 144 Hz frames therefore yields the same number of steps,
 * without floating-point drift.
 */
export interface FixedStepClock {
  /** Length of one step in whole microseconds. */
  readonly stepUs: number;
  /**
   * Add a real-time delta in ms and return how many whole steps are now due. Deltas above
   * `maxFrameDeltaMs` are clamped; zero, negative and NaN deltas add nothing.
   */
  add(dtMs: number): number;
  /** Drop accumulated time (used when a round starts or restarts). */
  reset(): void;
}

export function createFixedStepClock(options: {
  readonly fixedStepMs: number;
  readonly maxFrameDeltaMs: number;
}): FixedStepClock {
  const stepUs = Math.max(1, Math.round(options.fixedStepMs * 1000));
  let accumulatedUs = 0;
  let carryUs = 0;

  return {
    stepUs,
    add(dtMs) {
      if (!(dtMs > 0)) return 0;
      const clampedMs = Math.min(dtMs, options.maxFrameDeltaMs);
      const exactUs = clampedMs * 1000 + carryUs;
      const wholeUs = Math.round(exactUs);
      carryUs = exactUs - wholeUs;
      accumulatedUs += wholeUs;
      const steps = Math.floor(accumulatedUs / stepUs);
      accumulatedUs -= steps * stepUs;
      return steps;
    },
    reset() {
      accumulatedUs = 0;
      carryUs = 0;
    },
  };
}
