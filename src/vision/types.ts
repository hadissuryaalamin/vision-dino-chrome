// Internal seams of the vision module. Nothing here is part of the public API
// (src/vision/index.ts); these types exist so every stage can be replaced by a fake in tests.
import type { TimestampMs } from "../shared";

/** A point in normalised image coordinates: 0..1 across the frame, origin at the top-left. */
export interface Point2 {
  readonly x: number;
  readonly y: number;
}

/** A landmark as produced by the face mesh: normalised x and y, plus relative depth z. */
export interface Point3 extends Point2 {
  readonly z: number;
}

/** Size of the processed video frame in pixels. */
export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Head orientation in degrees; 0/0 means facing the camera. Only magnitudes are used (the
 * quality gate), so the sign convention does not matter.
 */
export interface HeadPose {
  readonly pitchDeg: number;
  readonly yawDeg: number;
}

/** Blendshape scores (0..1) by MediaPipe category name, e.g. `eyeBlinkLeft`, `jawOpen`. */
export type BlendshapeScores = Readonly<Record<string, number>>;

/** One face found in one video frame. */
export interface DetectedFace {
  /**
   * Face-mesh landmarks (468, or 478 with irises) in **camera space**: normalised to the raw,
   * unmirrored frame. The detector's face order is arbitrary and changes between frames.
   */
  readonly landmarks: readonly Point3[];
  /** Head pose from the facial transformation matrix, when the detector provides it. */
  readonly pose?: HeadPose | null;
  /** Blendshape scores, when the detector was asked to output them. */
  readonly blendshapes?: BlendshapeScores | null;
}

/**
 * Runs face-landmark inference on the current video frame. `timestampMs` is strictly
 * increasing across calls (MediaPipe rejects anything else).
 *
 * The production detector is synchronous (MediaPipe on the main thread, decision O-08). A
 * promise result is also accepted so a Web Worker implementation can be dropped in later;
 * the session keeps at most one inference in flight and skips frames while one is pending.
 */
export interface LandmarkDetector {
  detect(
    video: HTMLVideoElement,
    timestampMs: TimestampMs,
  ): readonly DetectedFace[] | Promise<readonly DetectedFace[]>;
  /** Releases the model and its WebAssembly/GPU resources. */
  close(): void;
}

/** Loads a detector. Production: a dynamic import of MediaPipe plus the self-hosted assets. */
export type LandmarkDetectorLoader = () => Promise<LandmarkDetector>;

/** Wraps getUserMedia on an injected MediaDevices. */
export interface CameraAdapter {
  /** Opens the camera. Rejects with a `CameraError` carrying a `VisionError`. */
  open(): Promise<MediaStream>;
  /** Stops every track of the open stream (and of a stream still being opened). Idempotent. */
  close(): void;
}

/** Delivers new video frames. Production: requestVideoFrameCallback, else requestAnimationFrame. */
export interface VideoFrameScheduler {
  /**
   * Calls `callback` once, for the next new frame of `video`, with that frame's timestamp on
   * the performance.now() clock. Returns a function that cancels the request.
   */
  request(video: HTMLVideoElement, callback: (timestampMs: TimestampMs) => void): () => void;
}

/** Monotonic clock on the performance.now() time origin. */
export type Clock = () => TimestampMs;
