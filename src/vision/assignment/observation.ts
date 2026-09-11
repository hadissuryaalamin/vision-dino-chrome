import type { NormalizedRect } from "../../shared";
import { landmarkBounds, rectCenter, toDisplayRect } from "../geometry/geometry";
import type { DetectedFace, FrameSize, Point2 } from "../types";

/** What the face assigner sees of one detected face: display-space position and size. */
export interface FaceObservation {
  /** Face bounds in normalised display coordinates (mirroring applied). */
  readonly rect: NormalizedRect;
  /** Centre of `rect` in display-space pixels. */
  readonly centerPx: Point2;
  /** Face width in pixels. */
  readonly widthPx: number;
}

/** Converts a detected face (camera space) to an observation (display space). Null if it has no landmarks. */
export function observeFace(
  face: DetectedFace,
  frame: FrameSize,
  mirrored: boolean,
): FaceObservation | null {
  const bounds = landmarkBounds(face.landmarks);
  if (bounds === null) return null;
  const rect = toDisplayRect(bounds, mirrored);
  const center = rectCenter(rect);
  return {
    rect,
    centerPx: { x: center.x * frame.width, y: center.y * frame.height },
    widthPx: rect.width * frame.width,
  };
}
