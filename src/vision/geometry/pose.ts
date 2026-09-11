import type { HeadPose } from "../types";

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Head pitch and yaw from a 4×4 facial transformation matrix (MediaPipe
 * `facialTransformationMatrixes[i].data`, 16 values).
 *
 * Robust to details that cannot be verified without a camera:
 * - **Layout:** row- or column-major is detected from where the translation sits (the
 *   translation of a face in front of the camera is far from zero; the projective row is 0).
 * - **Scale:** the rotation's forward axis is normalised.
 * - **Forward sign:** yaw and pitch are computed against |forward.z|, so a canonical face
 *   looking along +z or −z gives the same result.
 *
 * Returns null for malformed input. Signs are not meaningful; the quality gate uses magnitudes.
 */
export function headPoseFromMatrix(data: readonly number[]): HeadPose | null {
  if (data.length < 16 || data.some((value) => !Number.isFinite(value))) return null;
  const value = (index: number): number => data[index] ?? 0;
  const columnMajorTranslation = Math.abs(value(12)) + Math.abs(value(13)) + Math.abs(value(14));
  const rowMajorTranslation = Math.abs(value(3)) + Math.abs(value(7)) + Math.abs(value(11));
  const columnMajor = columnMajorTranslation >= rowMajorTranslation;
  const at = (row: number, column: number): number =>
    columnMajor ? value(column * 4 + row) : value(row * 4 + column);

  // Third column of the rotation block: where the face's forward (z) axis points.
  const fx = at(0, 2);
  const fy = at(1, 2);
  const fz = at(2, 2);
  const length = Math.hypot(fx, fy, fz);
  if (!(length > 0)) return null;
  const x = fx / length;
  const y = fy / length;
  const z = Math.abs(fz / length);
  return {
    yawDeg: Math.atan2(x, z) * RAD_TO_DEG,
    pitchDeg: Math.atan2(y, Math.hypot(x, z)) * RAD_TO_DEG,
  };
}
