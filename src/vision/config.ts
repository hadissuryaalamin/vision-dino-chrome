import type { GestureKind } from "../shared";

/**
 * Where a gesture's measurement comes from.
 * - `geometry` (default): eye and mouth aspect ratios computed from the landmarks.
 * - `blendshapes`: MediaPipe's `eyeBlinkLeft/Right` and `jawOpen` scores. They cost extra
 *   inference time; available to evaluate in the Vision Lab.
 */
export type MetricSource = "geometry" | "blendshapes";

/** getUserMedia video constraints (always requested with `audio: false`). */
export interface CameraConfig {
  readonly facingMode: "user" | "environment";
  readonly idealWidth: number;
  readonly idealHeight: number;
  readonly idealFrameRate: number;
}

/** MediaPipe Face Landmarker options. */
export interface DetectorConfig {
  /** Maximum number of faces to detect (decision O-11: 2). */
  readonly numFaces: number;
  readonly minFaceDetectionConfidence: number;
  readonly minFacePresenceConfidence: number;
  readonly minTrackingConfidence: number;
  /** Preferred delegate. "GPU" falls back to "CPU" if the GPU delegate cannot be created. */
  readonly delegate: "GPU" | "CPU";
}

/** Time-based hysteresis parameters for one gesture (docs/architecture.md §10.3–§10.6). */
export interface GestureTuning {
  /** Activation score (0 = neutral, 1 = full gesture) at or above which the gesture starts. */
  readonly enterThreshold: number;
  /** Score at or below which the gesture is released: the reset condition. */
  readonly exitThreshold: number;
  /** How long the score must stay at or above `enterThreshold` before the event fires. */
  readonly minActiveMs: number;
  /** Minimum time between two events of this gesture. */
  readonly cooldownMs: number;
}

/** Metric values that map to activation score 0 (`neutral`) and 1 (`active`). */
export interface MetricLevels {
  readonly neutral: number;
  readonly active: number;
}

/** Per-metric defaults and calibration limits. */
export interface MetricTuning {
  /** Population defaults, applied by `useDefaultCalibration()`. */
  readonly defaultLevels: MetricLevels;
  /** Smallest |active − neutral| a calibration gesture must reach to be counted. */
  readonly minSeparation: number;
  /** Largest acceptable neutral noise (robust standard deviation) during calibration. */
  readonly maxNeutralNoise: number;
}

/** A face that fails this gate gets a score of `null`: it never advances a gesture. */
export interface QualityConfig {
  /** Minimum face width in pixels; eye landmarks are too noisy on smaller faces. */
  readonly minFaceWidthPx: number;
  /** Use the head pose from the facial transformation matrix (needs extra detector output). */
  readonly useHeadPose: boolean;
  readonly maxPitchDeg: number;
  readonly maxYawDeg: number;
}

/** Face-to-player assignment (docs/architecture.md §9). */
export interface AssignmentConfig {
  /** Two faces must be visible this long before they are locked to Player 1 and Player 2. */
  readonly assignmentStableMs: number;
  /** A tracked face missing this long emits `face-lost`. */
  readonly faceLostAfterMs: number;
  /** A lost player's face must be visible this long before `face-found`. */
  readonly faceFoundAfterMs: number;
  /** How long a lost face's last position is used to recognise it again. */
  readonly reacquireWindowMs: number;
  /**
   * Tracking decisions with a cost difference below this (in face widths) are ambiguous: the
   * tracks' positions are held instead of updated, so jitter or overlapping faces never swap
   * identities.
   */
  readonly swapMargin: number;
  /** A new face count must persist this long before `faces-changed`. */
  readonly facesChangedDebounceMs: number;
}

/** Per-player calibration (docs/architecture.md §10.2). */
export interface CalibrationConfig {
  /** Fails with `not-enough-faces` if the players are not assigned within this time. */
  readonly assignTimeoutMs: number;
  /** Duration of the neutral measurement (eyes open, mouth closed). */
  readonly neutralMs: number;
  /** Time allowed for the deliberate gesture repetitions. */
  readonly gestureTimeoutMs: number;
  /** Number of deliberate gestures to measure. */
  readonly repetitions: number;
  /** Minimum number of valid neutral samples. */
  readonly minNeutralSamples: number;
  /** A calibration gesture must exceed `noiseFactor` × the neutral noise (and `minSeparation`). */
  readonly noiseFactor: number;
}

/** Complete configuration of a vision session. All values are starting points to tune in the Lab. */
export interface VisionConfig {
  readonly camera: CameraConfig;
  readonly detector: DetectorConfig;
  readonly metricSource: MetricSource;
  /** Time constant τ of the exponential moving average applied to each metric. */
  readonly smoothingTauMs: number;
  readonly gestures: { readonly [K in GestureKind]: GestureTuning };
  readonly metrics: {
    readonly [S in MetricSource]: { readonly [K in GestureKind]: MetricTuning };
  };
  readonly quality: QualityConfig;
  readonly assignment: AssignmentConfig;
  readonly calibration: CalibrationConfig;
  /** Consecutive inference exceptions tolerated before the session fails with `inference-failed`. */
  readonly maxConsecutiveInferenceErrors: number;
}

/** Recursive partial of a configuration object, for overrides. */
export type DeepPartial<T> = T extends object ? { readonly [K in keyof T]?: DeepPartial<T[K]> } : T;

export type VisionConfigOverrides = DeepPartial<VisionConfig>;

const GESTURE_KINDS: readonly GestureKind[] = ["blink", "mouth-open"];
const METRIC_SOURCES: readonly MetricSource[] = ["geometry", "blendshapes"];

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

/**
 * Default configuration. Values follow docs/architecture.md §10.10 and are **not yet tuned on
 * real faces**; tune them in the Vision Lab (src/vision/README.md, "Tuning guide").
 */
export const DEFAULT_VISION_CONFIG: Readonly<VisionConfig> = deepFreeze<VisionConfig>({
  camera: { facingMode: "user", idealWidth: 1280, idealHeight: 720, idealFrameRate: 30 },
  detector: {
    numFaces: 2,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    delegate: "GPU",
  },
  metricSource: "geometry",
  smoothingTauMs: 40,
  gestures: {
    blink: { enterThreshold: 0.6, exitThreshold: 0.35, minActiveMs: 80, cooldownMs: 350 },
    // Mouth values raised after the first two-player play-test (follow-up F-02): opening the
    // mouth fired too easily while talking. A deliberate wide opening still passes comfortably,
    // and the longer minActiveMs rejects the brief openings of speech at the cost of ~70 ms of
    // extra latency.
    "mouth-open": { enterThreshold: 0.72, exitThreshold: 0.4, minActiveMs: 150, cooldownMs: 350 },
  },
  metrics: {
    geometry: {
      // Eye aspect ratio of the more open eye: ≈0.28 open, ≈0.12 firmly closed.
      blink: {
        defaultLevels: { neutral: 0.28, active: 0.12 },
        minSeparation: 0.06,
        maxNeutralNoise: 0.03,
      },
      // Inner-lip mouth aspect ratio: ≈0.05 closed, ≈0.60 wide open. Talking peaks around
      // 0.25–0.35, so with the enter threshold this fires at ≈0.45 MAR (F-02).
      "mouth-open": {
        defaultLevels: { neutral: 0.05, active: 0.6 },
        // A calibration opening must be clearly wider than a talking mouth to count.
        minSeparation: 0.18,
        maxNeutralNoise: 0.04,
      },
    },
    blendshapes: {
      // min(eyeBlinkLeft, eyeBlinkRight): high only when both eyes close.
      blink: {
        defaultLevels: { neutral: 0.05, active: 0.8 },
        minSeparation: 0.3,
        maxNeutralNoise: 0.1,
      },
      "mouth-open": {
        defaultLevels: { neutral: 0.02, active: 0.6 },
        minSeparation: 0.2,
        maxNeutralNoise: 0.08,
      },
    },
  },
  quality: { minFaceWidthPx: 80, useHeadPose: true, maxPitchDeg: 25, maxYawDeg: 30 },
  assignment: {
    assignmentStableMs: 750,
    faceLostAfterMs: 400,
    faceFoundAfterMs: 200,
    reacquireWindowMs: 3000,
    swapMargin: 0.5,
    facesChangedDebounceMs: 250,
  },
  calibration: {
    assignTimeoutMs: 10_000,
    neutralMs: 2000,
    gestureTimeoutMs: 10_000,
    repetitions: 3,
    minNeutralSamples: 10,
    noiseFactor: 4,
  },
  maxConsecutiveInferenceErrors: 3,
});

/** Throws a RangeError listing every invalid value. */
export function validateVisionConfig(config: VisionConfig): void {
  const problems: string[] = [];
  const nonNegative = (value: number, name: string): void => {
    if (!(value >= 0) || !Number.isFinite(value))
      problems.push(`${name} must be a finite number ≥ 0`);
  };

  for (const gesture of GESTURE_KINDS) {
    const tuning = config.gestures[gesture];
    if (
      !(tuning.exitThreshold >= 0 && tuning.exitThreshold < tuning.enterThreshold) ||
      !(tuning.enterThreshold <= 1)
    ) {
      problems.push(`gestures.${gesture}: require 0 ≤ exitThreshold < enterThreshold ≤ 1`);
    }
    nonNegative(tuning.minActiveMs, `gestures.${gesture}.minActiveMs`);
    nonNegative(tuning.cooldownMs, `gestures.${gesture}.cooldownMs`);
  }
  for (const source of METRIC_SOURCES) {
    for (const gesture of GESTURE_KINDS) {
      const metric = config.metrics[source][gesture];
      const { neutral, active } = metric.defaultLevels;
      if (!Number.isFinite(neutral) || !Number.isFinite(active) || neutral === active) {
        problems.push(`metrics.${source}.${gesture}.defaultLevels must differ`);
      }
      if (!(metric.minSeparation > 0)) {
        problems.push(`metrics.${source}.${gesture}.minSeparation must be > 0`);
      }
      nonNegative(metric.maxNeutralNoise, `metrics.${source}.${gesture}.maxNeutralNoise`);
    }
  }
  if (!Number.isInteger(config.detector.numFaces) || config.detector.numFaces < 1) {
    problems.push("detector.numFaces must be an integer ≥ 1");
  }
  nonNegative(config.smoothingTauMs, "smoothingTauMs");
  nonNegative(config.quality.minFaceWidthPx, "quality.minFaceWidthPx");
  const numericEntries = (section: object): [string, number][] =>
    Object.entries(section as Record<string, number>);
  for (const [key, value] of numericEntries(config.assignment)) {
    nonNegative(value, `assignment.${key}`);
  }
  for (const [key, value] of numericEntries(config.calibration)) {
    nonNegative(value, `calibration.${key}`);
  }
  if (!Number.isInteger(config.calibration.repetitions) || config.calibration.repetitions < 1) {
    problems.push("calibration.repetitions must be an integer ≥ 1");
  }
  if (config.maxConsecutiveInferenceErrors < 1) {
    problems.push("maxConsecutiveInferenceErrors must be ≥ 1");
  }
  if (problems.length > 0) {
    throw new RangeError(`Invalid VisionConfig: ${problems.join("; ")}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeDeep(base: unknown, overrides: unknown): unknown {
  if (overrides === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(overrides)) return overrides;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    merged[key] = mergeDeep(base[key], value);
  }
  return merged;
}

/** Returns a validated, frozen copy of `base` with `overrides` applied. */
export function mergeVisionConfig(
  base: VisionConfig,
  overrides: VisionConfigOverrides = {},
): VisionConfig {
  const merged = mergeDeep(base, overrides) as VisionConfig;
  validateVisionConfig(merged);
  return deepFreeze(merged);
}
