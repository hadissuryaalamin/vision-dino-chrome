// Coordinate spaces (docs/architecture.md §8):
// - camera space: normalised to the raw, unmirrored frame (what MediaPipe returns);
// - display space: the preview as players see it; with `mirrored: true`, x is flipped;
// - pixel space: normalised coordinates scaled by the frame size, for distances and ratios.
import type { NormalizedRect } from "../../shared";
import type { FrameSize, Point2 } from "../types";

/** Converts a camera-space x to display space. This is the only place mirroring is applied. */
export function toDisplayX(cameraX: number, mirrored: boolean): number {
  return mirrored ? 1 - cameraX : cameraX;
}

/** Converts a camera-space point to display space. */
export function toDisplayPoint(point: Point2, mirrored: boolean): Point2 {
  return { x: toDisplayX(point.x, mirrored), y: point.y };
}

/** Converts a camera-space rectangle to display space (a mirrored rectangle keeps its size). */
export function toDisplayRect(rect: NormalizedRect, mirrored: boolean): NormalizedRect {
  if (!mirrored) return rect;
  return { x: 1 - rect.x - rect.width, y: rect.y, width: rect.width, height: rect.height };
}

/** Scales a normalised point to pixels. */
export function toPixels(point: Point2, frame: FrameSize): Point2 {
  return { x: point.x * frame.width, y: point.y * frame.height };
}

/**
 * Distance in pixels between two normalised points. Normalised x and y are scaled by
 * different frame dimensions, so distances must be measured in pixels (on a 16:9 frame a
 * normalised distance would distort every ratio).
 */
export function pixelDistance(a: Point2, b: Point2, frame: FrameSize): number {
  return Math.hypot((a.x - b.x) * frame.width, (a.y - b.y) * frame.height);
}

/** Axis-aligned bounds of a set of points, in the same space as the points; null if empty. */
export function landmarkBounds(points: readonly Point2[]): NormalizedRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  if (minX > maxX || minY > maxY) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectCenter(rect: NormalizedRect): Point2 {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** True for a frame with a finite, positive width and height. */
export function isUsableFrame(frame: FrameSize): boolean {
  return (
    Number.isFinite(frame.width) &&
    Number.isFinite(frame.height) &&
    frame.width > 0 &&
    frame.height > 0
  );
}
