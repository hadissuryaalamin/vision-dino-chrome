import type { VisionError, VisionErrorCode } from "../../shared";
import type { CameraConfig } from "../config";
import { describeError, errorName } from "../errors";
import type { CameraAdapter } from "../types";

/** Rejection reason of CameraAdapter.open(): carries the mapped VisionError. */
export class CameraError extends Error {
  readonly visionError: VisionError;

  constructor(visionError: VisionError, options?: { readonly cause?: unknown }) {
    super(visionError.message, options);
    this.name = "CameraError";
    this.visionError = visionError;
  }
}

/**
 * getUserMedia rejection names, from the Media Capture and Streams specification plus the
 * legacy names (marked) that older browsers still throw.
 */
const ERROR_CODES: Readonly<Record<string, VisionErrorCode>> = {
  // Permission refused by the user, the browser or a Permissions-Policy.
  NotAllowedError: "camera-permission-denied",
  SecurityError: "camera-permission-denied",
  PermissionDeniedError: "camera-permission-denied", // legacy Chrome
  PermissionDismissedError: "camera-permission-denied", // legacy Chrome: prompt dismissed

  // No device of the requested kind, or none matching the constraints.
  NotFoundError: "camera-not-found",
  DevicesNotFoundError: "camera-not-found", // legacy Chrome
  OverconstrainedError: "camera-not-found",
  ConstraintNotSatisfiedError: "camera-not-found", // legacy name of OverconstrainedError

  // A camera exists but could not be opened: held by another application, or a hardware fault.
  NotReadableError: "camera-in-use",
  TrackStartError: "camera-in-use", // legacy Chrome
  SourceUnavailableError: "camera-in-use", // legacy Firefox
  // Access was granted and no hardware fault was reported, yet the device did not start. The
  // usual cause is another application holding it, so it gets the same user-facing advice.
  AbortError: "camera-in-use",

  // getUserMedia cannot work in this browser or context.
  // Headless Chromium without a permission prompt rejects with NotSupportedError (F-01).
  NotSupportedError: "camera-unsupported",
  // A TypeError means the call shape is unsupported. This module always requests video, so it
  // can never mean "no media kinds requested"; in practice the API is unavailable here.
  TypeError: "camera-unsupported",
};

const OVERCONSTRAINED_NAMES: readonly string[] = [
  "OverconstrainedError",
  "ConstraintNotSatisfiedError", // legacy name
];

/** True when the rejection means the constraints could not be satisfied (either name). */
export function isOverconstrainedError(error: unknown): boolean {
  const name = errorName(error);
  return name !== null && OVERCONSTRAINED_NAMES.includes(name);
}

/** Maps a getUserMedia rejection to a VisionError (unknown names → `unknown`). */
export function mapCameraError(error: unknown): VisionError {
  const name = errorName(error);
  const code = (name === null ? undefined : ERROR_CODES[name]) ?? "unknown";
  return { code, message: describeError(error) };
}

/** Constraints for the first attempt. Audio is never requested. */
export function buildCameraConstraints(camera: CameraConfig): MediaStreamConstraints {
  return {
    video: {
      facingMode: camera.facingMode,
      width: { ideal: camera.idealWidth },
      height: { ideal: camera.idealHeight },
      frameRate: { ideal: camera.idealFrameRate },
    },
    audio: false,
  };
}

/** Constraints for the single retry after an OverconstrainedError. */
export const RELAXED_CAMERA_CONSTRAINTS: Readonly<MediaStreamConstraints> = Object.freeze({
  video: true,
  audio: false,
});

/** Stops every track of a stream. */
export function stopAllTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export interface CameraAdapterOptions {
  /** Production: `() => navigator.mediaDevices` (undefined in insecure contexts). */
  readonly getMediaDevices: () => MediaDevices | undefined;
  readonly isSecureContext: () => boolean;
  readonly camera: CameraConfig;
}

/**
 * getUserMedia wrapper. Error mapping (see `ERROR_CODES`):
 * NotAllowedError/SecurityError → permission denied; NotFoundError, and OverconstrainedError
 * after one retry with relaxed constraints → not found; NotReadableError/AbortError → in use;
 * NotSupportedError/TypeError, a missing API or an insecure context → unsupported; anything
 * else → unknown. close() stops every track, including those of a stream that arrives after
 * close().
 */
export function createCameraAdapter(options: CameraAdapterOptions): CameraAdapter {
  let stream: MediaStream | null = null;
  let generation = 0;

  function close(): void {
    generation++;
    if (stream !== null) {
      stopAllTracks(stream);
      stream = null;
    }
  }

  async function open(): Promise<MediaStream> {
    close();
    const gen = generation;
    const mediaDevices = options.getMediaDevices();
    if (
      !options.isSecureContext() ||
      mediaDevices === undefined ||
      typeof mediaDevices.getUserMedia !== "function"
    ) {
      throw new CameraError({
        code: "camera-unsupported",
        message:
          "navigator.mediaDevices.getUserMedia is unavailable, or the page is not a secure context.",
      });
    }

    let opened: MediaStream;
    try {
      opened = await mediaDevices.getUserMedia(buildCameraConstraints(options.camera));
    } catch (error) {
      if (!isOverconstrainedError(error)) {
        throw new CameraError(mapCameraError(error), { cause: error });
      }
      try {
        opened = await mediaDevices.getUserMedia(RELAXED_CAMERA_CONSTRAINTS);
      } catch (retryError) {
        // A second constraints failure means no usable camera; other names map as usual.
        throw new CameraError(mapCameraError(retryError), { cause: retryError });
      }
    }

    if (gen !== generation) {
      // close() was called while the permission prompt was open: never keep this stream.
      stopAllTracks(opened);
      throw new CameraError({
        code: "unknown",
        message: "The camera was closed while it was being opened.",
      });
    }
    stream = opened;
    return opened;
  }

  return { open, close };
}
