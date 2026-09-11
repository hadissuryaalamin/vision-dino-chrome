/**
 * Public entry point of the application layer (the composition root).
 *
 * `src/app` is the only module that connects gestures to game actions. It imports src/game
 * and src/vision only through their `index.ts`, and passes plain data to src/ui.
 *
 * Planned production wiring in src/main.ts (Phase 3):
 *
 * ```ts
 * import { createApp } from "./app";
 * import { createGame, createKeyboardInputSource, DEFAULT_KEY_BINDINGS } from "./game";
 * import { createVisionSession, isCameraSupported } from "./vision";
 *
 * createApp(document.querySelector<HTMLElement>("#app")!, {
 *   createGame,
 *   createKeyboardInputSource,
 *   createVisionSession,
 *   isCameraSupported,
 *   keyBindings: DEFAULT_KEY_BINDINGS,
 * });
 * ```
 *
 * Guarantees:
 * - Keyboard input is always active. In keyboard-only play the vision session factory is
 *   never called, so the camera is never requested.
 * - `VisionSession.start()` runs only synchronously inside the "Play with camera" or
 *   "Try again" click handler.
 * - `vision.stop()` runs on Keyboard only, "Turn camera off", `pagehide`, vision errors and
 *   `destroy()`; `destroy()` also disposes the session.
 * - `visibilitychange` to hidden pauses a running game. A face lost during play only warns
 *   (decision O-04).
 */

export { createApp } from "./create-app";
export type {
  AppDependencies,
  AppFrameScheduler,
  AppGame,
  AppHandle,
  KeyboardTarget,
} from "./create-app";

/** Subscribes to every source and forwards jump actions to `game.jumpPlayer`. */
export { connectInputs } from "./input-router";

/** Adapts semantic vision events into game-facing actions. `start()` only begins forwarding. */
export { createVisionInputSource } from "./vision-input";

export { canChooseCamera, createInitialAppState, isGameScreen, transition } from "./state";
export type {
  AppEffect,
  AppEvent,
  AppNotice,
  AppState,
  CalibrationPlayerState,
  CalibrationState,
  Transition,
} from "./state";
export { toViewModel } from "./view-model";
export { appKeyCommand } from "./keys";
export type { AppKeyCommand, AppKeyEvent } from "./keys";
export { parseAppUrlOptions } from "./url-options";
export type { AppUrlOptions } from "./url-options";
export { pickSingleCameraPlayer } from "./assignment";
