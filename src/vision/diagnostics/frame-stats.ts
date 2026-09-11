import type { TimestampMs } from "../../shared";

/** Processing rate and inference time for VisionDiagnostics. */
export interface FrameStats {
  record(frameTimestampMs: TimestampMs, inferenceMs: number): void;
  /** Processed frames per second over the last `windowMs`, or null with fewer than 2 frames. */
  fps(): number | null;
  /** Exponential moving average of the inference time in ms, or null before the first frame. */
  inferenceMs(): number | null;
  reset(): void;
}

export function createFrameStats(windowMs = 1000, inferenceAlpha = 0.2): FrameStats {
  let timestamps: TimestampMs[] = [];
  let averageInferenceMs: number | null = null;
  return {
    record(frameTimestampMs, inferenceMs) {
      timestamps.push(frameTimestampMs);
      while (timestamps.length > 2 && frameTimestampMs - (timestamps[0] ?? 0) > windowMs) {
        timestamps.shift();
      }
      averageInferenceMs =
        averageInferenceMs === null
          ? inferenceMs
          : averageInferenceMs + inferenceAlpha * (inferenceMs - averageInferenceMs);
    },
    fps() {
      const first = timestamps[0];
      const last = timestamps[timestamps.length - 1];
      if (first === undefined || last === undefined || timestamps.length < 2) return null;
      const span = last - first;
      return span > 0 ? ((timestamps.length - 1) * 1000) / span : null;
    },
    inferenceMs() {
      return averageInferenceMs;
    },
    reset() {
      timestamps = [];
      averageInferenceMs = null;
    },
  };
}
