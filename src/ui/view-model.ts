import type {
  AssignmentReason,
  CalibrationFailureReason,
  CalibrationMode,
  CalibrationStep,
  GameResult,
  GestureKind,
  PerPlayer,
  PlayerId,
  PlayerTrackingState,
  VisionErrorCode,
} from "../shared";

// Plain data the application layer (src/app) passes to the UI. The UI renders it and reports
// user actions back as UiIntents; it never talks to the game or the vision module itself.

/** Screens of the application flow (docs/architecture.md §12). */
export type ScreenId =
  | "welcome"
  | "camera-starting"
  | "camera-error"
  | "positioning"
  | "calibrating"
  | "ready"
  | "playing"
  | "paused"
  | "game-over";

/** Whether the camera is part of the current setup. The keyboard always works. */
export type InputMode = "keyboard" | "camera";

/** How one player controls their dinosaur: gestures on camera (plus keys), or keys only. */
export type PlayerControl = "camera" | "keyboard";

export interface CalibrationFailureView {
  /** null when the failure is not specific to one player (e.g. not enough faces). */
  readonly playerId: PlayerId | null;
  readonly reason: CalibrationFailureReason;
}

export interface CalibrationPlayerView {
  readonly playerId: PlayerId;
  /** Keyboard players are not calibrated. */
  readonly control: PlayerControl;
  readonly status: "waiting" | "in-progress" | "complete" | "failed";
  readonly step: CalibrationStep | null;
  /** 0..1 within the current step. */
  readonly progress: number;
  readonly mode: CalibrationMode | null;
}

export type ScreenView =
  | { readonly id: "welcome"; readonly cameraSupported: boolean }
  | { readonly id: "camera-starting"; readonly phase: "requesting-camera" | "loading-model" }
  | {
      readonly id: "camera-error";
      readonly code: VisionErrorCode;
      readonly cameraSupported: boolean;
    }
  | { readonly id: "positioning"; readonly facesDetected: number }
  | {
      readonly id: "calibrating";
      /** True while the session is still deciding which face belongs to which player. */
      readonly assigning: boolean;
      readonly players: PerPlayer<CalibrationPlayerView>;
      readonly failure: CalibrationFailureView | null;
    }
  | {
      readonly id: "ready";
      readonly controls: PerPlayer<PlayerControl>;
      /** Offer "Play with camera" from here (keyboard mode, camera supported). */
      readonly canUseCamera: boolean;
    }
  | { readonly id: "playing" }
  | { readonly id: "paused" }
  | {
      readonly id: "game-over";
      readonly result: GameResult | null;
      readonly canUseCamera: boolean;
    };

export interface HudPlayerView {
  readonly playerId: PlayerId;
  readonly control: PlayerControl;
  readonly gesture: GestureKind;
  /** Tracking of this player's face; null when the player uses the keyboard only. */
  readonly tracking: PlayerTrackingState | null;
  /** Increases by one per detected gesture; the HUD shows a short pulse when it changes. */
  readonly gestureCount: number;
}

export interface HudView {
  readonly visible: boolean;
  readonly canPause: boolean;
  readonly players: PerPlayer<HudPlayerView>;
}

export interface CameraPanelView {
  /** The camera is being requested or the model is loading. */
  readonly starting: boolean;
  readonly facesDetected: number;
  readonly controls: PerPlayer<PlayerControl>;
  readonly tracking: PerPlayer<PlayerTrackingState>;
  /** Swap and Reset are meaningful. */
  readonly canAdjustAssignment: boolean;
}

/** A non-blocking message shown above the game. */
export type NoticeView =
  | { readonly kind: "vision-error"; readonly code: VisionErrorCode; readonly canRetry: boolean }
  | { readonly kind: "camera-stopped-hidden"; readonly canRetry: boolean }
  | { readonly kind: "players-reassigned" };

export interface ViewModel {
  readonly screen: ScreenView;
  readonly mode: InputMode;
  readonly hud: HudView;
  /** null hides the camera panel. */
  readonly camera: CameraPanelView | null;
  readonly notice: NoticeView | null;
  readonly debugVisible: boolean;
}

/** A user action reported by the UI. */
export type UiIntent =
  | { readonly type: "play-with-camera" }
  | { readonly type: "keyboard-only" }
  | { readonly type: "continue-two-players" }
  | { readonly type: "continue-one-player" }
  | { readonly type: "calibration-retry" }
  | { readonly type: "calibration-use-defaults" }
  | { readonly type: "swap-players" }
  | { readonly type: "reset-assignment" }
  | { readonly type: "camera-off" }
  | { readonly type: "start" }
  | { readonly type: "restart" }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "toggle-debug" }
  | { readonly type: "dismiss-notice" };

/** Something screen-reader users should hear; the UI chooses the words and politeness. */
export type Announcement =
  | { readonly kind: "faces-detected"; readonly count: number }
  | { readonly kind: "players-assigned"; readonly reason: AssignmentReason }
  | { readonly kind: "face-lost"; readonly playerId: PlayerId }
  | { readonly kind: "face-found"; readonly playerId: PlayerId }
  | {
      readonly kind: "calibration-complete";
      readonly playerId: PlayerId;
      readonly mode: CalibrationMode;
    }
  | {
      readonly kind: "calibration-failed";
      readonly playerId: PlayerId | null;
      readonly reason: CalibrationFailureReason;
    }
  | { readonly kind: "vision-error"; readonly code: VisionErrorCode }
  | { readonly kind: "camera-off"; readonly reason: "user" | "page-hidden" }
  | { readonly kind: "game-started" }
  | { readonly kind: "game-paused" }
  | { readonly kind: "game-resumed" }
  | { readonly kind: "player-crashed"; readonly playerId: PlayerId; readonly score: number }
  | { readonly kind: "game-over"; readonly result: GameResult }
  | { readonly kind: "debug-overlay"; readonly visible: boolean };
