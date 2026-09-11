// Pure gesture metrics. Distances are measured in pixel space (§8). Mirroring does not change
// distances, so the metrics read camera-space landmarks directly.
import type { GestureKind } from "../../shared";
import type { MetricLevels, MetricSource } from "../config";
import { pixelDistance } from "../geometry/geometry";
import type { BlendshapeScores, DetectedFace, FrameSize, Point2 } from "../types";
import {
  LEFT_EYE,
  MOUTH_CORNERS,
  MOUTH_VERTICAL_PAIRS,
  RIGHT_EYE,
  type EyeIndices,
} from "./landmark-indices";

function pointAt(landmarks: readonly Point2[], index: number): Point2 | null {
  const point = landmarks[index];
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

/**
 * Eye aspect ratio `(|p2 − p6| + |p3 − p5|) / (2 · |p1 − p4|)` in pixel space. High when the
 * eye is open, low when it is closed. Null if a point is missing or the eye has no width.
 */
export function eyeAspectRatio(
  landmarks: readonly Point2[],
  eye: EyeIndices,
  frame: FrameSize,
): number | null {
  const points = eye.map((index) => pointAt(landmarks, index));
  const [p1, p2, p3, p4, p5, p6] = points;
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return null;
  const width = pixelDistance(p1, p4, frame);
  if (!(width > 0)) return null;
  return (pixelDistance(p2, p6, frame) + pixelDistance(p3, p5, frame)) / (2 * width);
}

/**
 * Blink metric: the EAR of the **more open** eye (max), so a wink or a one-eye squint does not
 * count as a blink. Falls back to the one measurable eye.
 */
export function eyeOpenness(landmarks: readonly Point2[], frame: FrameSize): number | null {
  const right = eyeAspectRatio(landmarks, RIGHT_EYE, frame);
  const left = eyeAspectRatio(landmarks, LEFT_EYE, frame);
  if (right === null) return left;
  if (left === null) return right;
  return Math.max(left, right);
}

/** Mouth aspect ratio: mean inner-lip vertical gap over the inner mouth width, in pixels. */
export function mouthAspectRatio(landmarks: readonly Point2[], frame: FrameSize): number | null {
  const left = pointAt(landmarks, MOUTH_CORNERS[0]);
  const right = pointAt(landmarks, MOUTH_CORNERS[1]);
  if (!left || !right) return null;
  const width = pixelDistance(left, right, frame);
  if (!(width > 0)) return null;
  let sum = 0;
  for (const [upperIndex, lowerIndex] of MOUTH_VERTICAL_PAIRS) {
    const upper = pointAt(landmarks, upperIndex);
    const lower = pointAt(landmarks, lowerIndex);
    if (!upper || !lower) return null;
    sum += pixelDistance(upper, lower, frame);
  }
  return sum / MOUTH_VERTICAL_PAIRS.length / width;
}

function score(blendshapes: BlendshapeScores | null | undefined, name: string): number | null {
  const value = blendshapes?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Blendshape blink metric: min(eyeBlinkLeft, eyeBlinkRight), high only when both eyes close. */
export function blendshapeBlink(blendshapes: BlendshapeScores | null | undefined): number | null {
  const left = score(blendshapes, "eyeBlinkLeft");
  const right = score(blendshapes, "eyeBlinkRight");
  if (left === null || right === null) return null;
  return Math.min(left, right);
}

/** Blendshape mouth metric: jawOpen. */
export function blendshapeMouthOpen(
  blendshapes: BlendshapeScores | null | undefined,
): number | null {
  return score(blendshapes, "jawOpen");
}

/** Computes one gesture's metric for one face. */
export type MetricFunction = (face: DetectedFace, frame: FrameSize) => number | null;

/** The metric for a gesture from the chosen source. */
export function metricFunction(gesture: GestureKind, source: MetricSource): MetricFunction {
  if (source === "blendshapes") {
    return gesture === "blink"
      ? (face) => blendshapeBlink(face.blendshapes)
      : (face) => blendshapeMouthOpen(face.blendshapes);
  }
  return gesture === "blink"
    ? (face, frame) => eyeOpenness(face.landmarks, frame)
    : (face, frame) => mouthAspectRatio(face.landmarks, frame);
}

/** Linear map so that `levels.neutral` → 0 and `levels.active` → 1 (either direction). Unclamped. */
export function normalizeMetric(value: number, levels: MetricLevels): number {
  const range = levels.active - levels.neutral;
  return range === 0 ? 0 : (value - levels.neutral) / range;
}

/**
 * Activation score in [0, 1]. Blink: `(EAR_neutral − EAR) / (EAR_neutral − EAR_blink)`;
 * mouth: `(MAR − MAR_neutral) / (MAR_open − MAR_neutral)`; both clamped.
 */
export function activationScore(value: number, levels: MetricLevels): number {
  const normalized = normalizeMetric(value, levels);
  return Math.min(1, Math.max(0, normalized));
}
