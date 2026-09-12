// Public entry point of the UI layer. src/ui renders plain data passed in by src/app and
// reports user actions back as UiIntents. It imports only src/shared and other UI modules,
// and never touches the game, the vision module or the camera.

export { createAppView } from "./view";
export type { AppView, AppViewOptions } from "./view";
export type {
  Announcement,
  CalibrationFailureView,
  CalibrationPlayerView,
  CameraPanelView,
  HudPlayerView,
  HudView,
  InputMode,
  NoticeView,
  PlayerControl,
  ScreenId,
  ScreenView,
  UiIntent,
  ViewModel,
} from "./view-model";
export {
  CALIBRATION_FAILURE_COPY,
  LOCAL_PROCESSING_NOTICE,
  VISION_ERROR_COPY,
  announcementText,
} from "./copy";
export { containRect, drawFaceOverlay, toPixelBox } from "./face-overlay";
export { describeGameEvent, describeVisionEvent } from "./debug-overlay";
