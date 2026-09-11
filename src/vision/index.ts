/**
 * Vision module public API: local camera, face landmarks and gesture detection.
 *
 * Implements the `VisionSession` contract from `src/shared/vision.ts`. Everything runs in
 * the browser: camera frames go from the `<video>` element straight to in-page WebAssembly
 * inference (MediaPipe Face Landmarker, loaded lazily from the site origin). Frames,
 * landmarks and calibration data are never uploaded, stored or persisted.
 *
 * The module emits semantic `VisionEvent`s and never touches game state. See
 * `src/vision/README.md` for events, configuration, the tuning guide and privacy guarantees.
 *
 * @example
 * ```ts
 * const vision = createVisionSession({ video, mirrored: true });
 * const unsubscribe = vision.subscribe((event) => {
 *   if (event.type === "gesture") console.log(event.playerId, event.gesture);
 * });
 * // Only inside an explicit user action, e.g. the "Play with camera" click handler:
 * const result = await vision.start();
 * if (!result.ok) showCameraError(result.error.code);
 * vision.startCalibration(); // or vision.useDefaultCalibration()
 * // ...
 * await vision.stop(); // stops every camera track
 * ```
 *
 * @packageDocumentation
 */
import type { VisionSessionFactory } from "../shared";
import { DEFAULT_VISION_CONFIG } from "./config";
import { createBrowserVisionDeps } from "./defaults";
import { createVisionSessionWith } from "./session";

/**
 * Production factory: real camera, lazily loaded MediaPipe, default configuration.
 *
 * Creating a session does nothing observable: no camera access, no network request. Behaviour
 * of the returned `VisionSession`:
 *
 * - `start()` must be called from an explicit user action. It requests the camera
 *   (`audio: false`), loads the model in parallel, and moves through the statuses
 *   `idle → requesting-camera → loading-model → running`. It never rejects: failures resolve
 *   as `{ ok: false, error }` (`camera-unsupported`, `camera-permission-denied`,
 *   `camera-not-found`, `camera-in-use`, `model-load-failed`, `unknown`) and are also emitted
 *   as an `error` event followed by `status-changed` to `error`. Calling it while running
 *   resolves `{ ok: true }`; calling it while starting returns the pending result.
 * - While running, a camera track ending emits `camera-disconnected`, and repeated inference
 *   exceptions emit `inference-failed` (both: `error`, then `status-changed` to `error`).
 * - `stop()` cancels the frame loop, stops every camera track, sets `video.srcObject` to
 *   `null`, ends any calibration (`calibration-failed`, `cancelled`), clears calibration data
 *   and emits `status-changed` to `idle` as its last event. It is idempotent, and `start()`
 *   works again afterwards.
 * - `dispose()` = `stop()`, then releases the model. The session cannot be restarted.
 * - Gesture events are edge-triggered: one `gesture` event per activation, none while held.
 *   **A player's gestures fire only after calibration**: `startCalibration()` (measured) or
 *   `useDefaultCalibration()` (population defaults).
 * - Players are assigned by position: when two faces have been visible for 750 ms, the left
 *   face of the preview (in display space, respecting `mirrored`) becomes Player 1, and
 *   identities then follow each person (decision O-06). `swapPlayers()` and
 *   `resetAssignment()` correct mistakes.
 * - `getDiagnostics()` is a cheap snapshot; poll it (e.g. per animation frame).
 */
export const createVisionSession: VisionSessionFactory = (options) =>
  createVisionSessionWith(
    createBrowserVisionDeps(DEFAULT_VISION_CONFIG),
    options,
    DEFAULT_VISION_CONFIG,
  );

/**
 * True when `navigator.mediaDevices.getUserMedia` exists and the page is a secure context
 * (HTTPS or localhost). Does not request permission or touch the camera.
 */
export { isCameraSupported } from "./camera/support";

/** Default configuration (starting values, not yet tuned on real faces). */
export { DEFAULT_VISION_CONFIG };

export type {
  AssignmentConfig,
  CalibrationConfig,
  CameraConfig,
  DetectorConfig,
  GestureTuning,
  MetricLevels,
  MetricSource,
  MetricTuning,
  QualityConfig,
  VisionConfig,
} from "./config";
