// MediaPipe adapter. Loaded only through a dynamic import (see ./loader.ts). This is the only
// module that references @mediapipe/tasks-vision; its types never leave src/vision.
//
// Verified against the installed @mediapipe/tasks-vision 1.0.1 type definitions (vision.d.ts):
// FilesetResolver.isSimdSupported(), an explicit WasmFileset { wasmLoaderPath, wasmBinaryPath },
// FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate },
// runningMode: "VIDEO", numFaces, ... }), detectForVideo(video, timestampMs) and close().
import type {
  Classifications,
  FaceLandmarker,
  FaceLandmarkerOptions,
  FaceLandmarkerResult,
  Matrix,
} from "@mediapipe/tasks-vision";
// The WebAssembly runtime is served from the site origin: Vite copies these files from the
// npm package (its `exports` map allows it) into the build with hashed names (decision O-01).
import wasmLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import noSimdLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url";
import noSimdBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url";
import type { DetectorConfig } from "../config";
import { headPoseFromMatrix } from "../geometry/pose";
import type { BlendshapeScores, DetectedFace, HeadPose, LandmarkDetector } from "../types";

export interface MediaPipeDetectorOptions {
  /** Absolute same-origin URL of face_landmarker.task. */
  readonly modelAssetPath: string;
  readonly detector: DetectorConfig;
  /** Output facial transformation matrices (used by the head-pose quality gate). */
  readonly outputHeadPose: boolean;
  /** Output blendshape scores (only for the `blendshapes` metric source). */
  readonly outputBlendshapes: boolean;
}

function absolute(url: string): string {
  return new URL(url, document.baseURI).href;
}

function toPose(matrix: Matrix | undefined): HeadPose | null {
  return matrix ? headPoseFromMatrix(matrix.data) : null;
}

function toBlendshapes(classifications: Classifications | undefined): BlendshapeScores | null {
  if (!classifications) return null;
  const scores: Record<string, number> = {};
  for (const category of classifications.categories) {
    scores[category.categoryName] = category.score;
  }
  return scores;
}

function toFaces(result: FaceLandmarkerResult): DetectedFace[] {
  return result.faceLandmarks.map((landmarks, index) => ({
    landmarks,
    pose: toPose(result.facialTransformationMatrixes[index]),
    blendshapes: toBlendshapes(result.faceBlendshapes[index]),
  }));
}

/**
 * Creates a Face Landmarker in VIDEO mode. Tries the configured delegate first; if the GPU
 * delegate cannot be created, retries on the CPU.
 */
export async function createMediaPipeFaceDetector(
  options: MediaPipeDetectorOptions,
): Promise<LandmarkDetector> {
  const vision = await import("@mediapipe/tasks-vision");
  const simd = await vision.FilesetResolver.isSimdSupported();
  const fileset = simd
    ? { wasmLoaderPath: absolute(wasmLoaderUrl), wasmBinaryPath: absolute(wasmBinaryUrl) }
    : { wasmLoaderPath: absolute(noSimdLoaderUrl), wasmBinaryPath: absolute(noSimdBinaryUrl) };

  const create = (delegate: "GPU" | "CPU"): Promise<FaceLandmarker> => {
    const faceLandmarkerOptions: FaceLandmarkerOptions = {
      baseOptions: { modelAssetPath: options.modelAssetPath, delegate },
      runningMode: "VIDEO",
      numFaces: options.detector.numFaces,
      minFaceDetectionConfidence: options.detector.minFaceDetectionConfidence,
      minFacePresenceConfidence: options.detector.minFacePresenceConfidence,
      minTrackingConfidence: options.detector.minTrackingConfidence,
      outputFacialTransformationMatrixes: options.outputHeadPose,
      outputFaceBlendshapes: options.outputBlendshapes,
    };
    return vision.FaceLandmarker.createFromOptions(fileset, faceLandmarkerOptions);
  };

  let landmarker: FaceLandmarker;
  try {
    landmarker = await create(options.detector.delegate);
  } catch (error) {
    if (options.detector.delegate !== "GPU") throw error;
    landmarker = await create("CPU");
  }

  return {
    detect(video, timestampMs) {
      return toFaces(landmarker.detectForVideo(video, timestampMs));
    },
    close() {
      landmarker.close();
    },
  };
}
