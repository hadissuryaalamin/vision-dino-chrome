import type { TimestampMs } from "../../shared";

/** Exponential smoothing factor for a time step: `α = 1 − exp(−Δt / τ)`. */
export function emaAlpha(deltaMs: number, tauMs: number): number {
  if (tauMs <= 0) return 1;
  if (deltaMs <= 0) return 0;
  return 1 - Math.exp(-deltaMs / tauMs);
}

export interface Smoother {
  /** Latest smoothed value, or null after reset(). */
  readonly value: number | null;
  /** Adds a sample taken at `timestampMs` and returns the smoothed value. */
  next(sample: number, timestampMs: TimestampMs): number;
  /** Forgets history; the next sample is taken as is. */
  reset(): void;
}

/**
 * Time-constant exponential moving average (docs/architecture.md §10.5). Because α depends on
 * the real time step, the response is the same at 15, 30 or 60 fps. Samples with a
 * non-increasing timestamp are ignored.
 */
export function createEmaSmoother(tauMs: number): Smoother {
  let value: number | null = null;
  let lastTimestamp = 0;
  return {
    get value(): number | null {
      return value;
    },
    next(sample, timestampMs) {
      if (value === null) {
        value = sample;
        lastTimestamp = timestampMs;
        return value;
      }
      const alpha = emaAlpha(timestampMs - lastTimestamp, tauMs);
      if (timestampMs > lastTimestamp) lastTimestamp = timestampMs;
      value += alpha * (sample - value);
      return value;
    },
    reset() {
      value = null;
    },
  };
}
