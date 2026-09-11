import { createCameraAdapter } from "./camera/camera";
import { createVideoFrameScheduler } from "./camera/frame-scheduler";
import { isCameraSupported } from "./camera/support";
import type { VisionConfig } from "./config";
import { createMediaPipeLoader } from "./landmarks/loader";
import type { VisionSessionDeps } from "./session";

/** Production dependencies: the real camera, lazily loaded MediaPipe, and the browser clock. */
export function createBrowserVisionDeps(config: VisionConfig): VisionSessionDeps {
  return {
    camera: createCameraAdapter({
      // Undefined in insecure contexts even though the DOM types say otherwise.
      getMediaDevices: (): MediaDevices | undefined =>
        typeof navigator === "undefined" ? undefined : navigator.mediaDevices,
      isSecureContext: () => globalThis.isSecureContext === true,
      camera: config.camera,
    }),
    loadDetector: createMediaPipeLoader(config),
    frames: createVideoFrameScheduler(),
    now: () => performance.now(),
    isSupported: isCameraSupported,
  };
}
