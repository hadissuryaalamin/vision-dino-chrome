import type { VisionConfig } from "../config";
import type { LandmarkDetectorLoader } from "../types";

/** Path of the self-hosted model, relative to the site base (public/vision/). */
export const MODEL_ASSET_PATH = "vision/face_landmarker.task";

/**
 * Absolute URL of the self-hosted model, built from `import.meta.env.BASE_URL` (never a
 * hard-coded "/..."), so it works from a GitHub Pages sub-path.
 */
export function modelAssetUrl(baseUrl: string, documentBaseUri: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(`${base}${MODEL_ASSET_PATH}`, documentBaseUri).href;
}

/**
 * Production loader. Nothing MediaPipe-related is imported until it is called: the adapter
 * module and `@mediapipe/tasks-vision` are dynamic imports, so Vite emits them as lazy chunks
 * and keyboard-only play never downloads them.
 */
export function createMediaPipeLoader(config: VisionConfig): LandmarkDetectorLoader {
  return async () => {
    const { createMediaPipeFaceDetector } = await import("./mediapipe-detector");
    return createMediaPipeFaceDetector({
      modelAssetPath: modelAssetUrl(import.meta.env.BASE_URL, document.baseURI),
      detector: config.detector,
      outputHeadPose: config.quality.useHeadPose,
      outputBlendshapes: config.metricSource === "blendshapes",
    });
  };
}
