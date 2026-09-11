import type { CalibrationMode, GestureDiagnostics, GestureKind, TimestampMs } from "../../shared";
import type { GestureTuning, MetricLevels, MetricTuning, QualityConfig } from "../config";
import type { DetectedFace, FrameSize } from "../types";
import { createGestureStateMachine, type GestureStateMachine } from "./hysteresis";
import { activationScore, type MetricFunction } from "./metrics";
import { createEmaSmoother } from "./smoothing";

/** Why a frame produced no score. */
export type QualityGateResult = "ok" | "no-face" | "face-too-small" | "head-pose" | "no-metric";

/** One player's gesture measurements for one frame. */
export interface GestureFrame {
  /** Metric measured on the face even if the quality gate failed (for display). */
  readonly measuredMetric: number | null;
  /** Metric that passed the quality gate, else null. Used by calibration's neutral step. */
  readonly rawMetric: number | null;
  /** Smoothed gated metric. Used by calibration's gesture step. */
  readonly smoothedMetric: number | null;
  /** Activation score 0..1 from the smoothed metric, or null. */
  readonly score: number | null;
  readonly gate: QualityGateResult;
  /** True exactly when this frame's gesture event fires. */
  readonly fired: boolean;
}

export interface PlayerCalibration {
  readonly levels: MetricLevels;
  readonly mode: CalibrationMode;
}

const EMPTY_FRAME: GestureFrame = {
  measuredMetric: null,
  rawMetric: null,
  smoothedMetric: null,
  score: null,
  gate: "no-face",
  fired: false,
};

export interface GesturePipelineOptions {
  readonly gesture: GestureKind;
  readonly metric: MetricFunction;
  readonly tuning: GestureTuning;
  readonly metricTuning: MetricTuning;
  readonly quality: QualityConfig;
  readonly smoothingTauMs: number;
}

/**
 * One player's chain: metric → quality gate → smoothing → normalisation → hysteresis.
 * Events fire only when the player has a calibration (measured or default) and is not being
 * calibrated.
 */
export interface GesturePipeline {
  readonly gesture: GestureKind;
  readonly last: GestureFrame;
  process(
    face: DetectedFace | null,
    faceWidthPx: number,
    frame: FrameSize,
    timestampMs: TimestampMs,
  ): GestureFrame;
  getCalibration(): PlayerCalibration | null;
  setCalibration(calibration: PlayerCalibration | null): void;
  /** Levels used for the score: the calibration's, or the population defaults for display. */
  effectiveLevels(): MetricLevels;
  /** While suspended (being calibrated) the detector stays disarmed and emits nothing. */
  setSuspended(suspended: boolean): void;
  isSuspended(): boolean;
  disarm(): void;
  /** Forgets the signal history and detector state (keeps the calibration). */
  resetSignal(): void;
  diagnostics(timestampMs: TimestampMs | null): GestureDiagnostics;
}

/** Quality gate (docs/architecture.md §10.7): minimum face size and head pose. */
export function checkQuality(
  face: DetectedFace | null,
  faceWidthPx: number,
  quality: QualityConfig,
): QualityGateResult {
  if (face === null) return "no-face";
  if (!(faceWidthPx >= quality.minFaceWidthPx)) return "face-too-small";
  const pose = face.pose;
  if (
    quality.useHeadPose &&
    pose &&
    (Math.abs(pose.pitchDeg) > quality.maxPitchDeg || Math.abs(pose.yawDeg) > quality.maxYawDeg)
  ) {
    return "head-pose";
  }
  return "ok";
}

export function createGesturePipeline(options: GesturePipelineOptions): GesturePipeline {
  const smoother = createEmaSmoother(options.smoothingTauMs);
  let machine: GestureStateMachine = createGestureStateMachine(options.tuning);
  let calibration: PlayerCalibration | null = null;
  let suspended = false;
  let last: GestureFrame = EMPTY_FRAME;

  const effectiveLevels = (): MetricLevels =>
    calibration?.levels ?? options.metricTuning.defaultLevels;

  return {
    gesture: options.gesture,
    get last(): GestureFrame {
      return last;
    },
    process(face, faceWidthPx, frame, timestampMs) {
      const measured = face === null ? null : options.metric(face, frame);
      let gate = checkQuality(face, faceWidthPx, options.quality);
      if (gate === "ok" && measured === null) gate = "no-metric";

      let rawMetric: number | null = null;
      let smoothedMetric: number | null = null;
      let score: number | null = null;
      if (gate === "ok" && measured !== null) {
        rawMetric = measured;
        smoothedMetric = smoother.next(measured, timestampMs);
        score = activationScore(smoothedMetric, effectiveLevels());
      } else {
        smoother.reset();
      }

      let fired = false;
      if (suspended || calibration === null) {
        machine.disarm();
      } else {
        fired = machine.update(score, timestampMs);
      }
      last = { measuredMetric: measured, rawMetric, smoothedMetric, score, gate, fired };
      return last;
    },
    getCalibration: () => calibration,
    setCalibration(next) {
      calibration = next;
      machine.disarm();
    },
    effectiveLevels,
    setSuspended(value) {
      suspended = value;
      if (value) machine.disarm();
    },
    isSuspended: () => suspended,
    disarm() {
      machine.disarm();
    },
    resetSignal() {
      smoother.reset();
      machine = createGestureStateMachine(options.tuning);
      last = EMPTY_FRAME;
    },
    diagnostics(timestampMs) {
      return {
        gesture: options.gesture,
        rawMetric: last.measuredMetric,
        score: last.score,
        enterThreshold: options.tuning.enterThreshold,
        exitThreshold: options.tuning.exitThreshold,
        state: machine.state,
        cooldownRemainingMs: timestampMs === null ? 0 : machine.cooldownRemainingMs(timestampMs),
        lastGestureAt: machine.lastEventAt,
        calibration: calibration?.mode ?? "none",
      };
    },
  };
}
