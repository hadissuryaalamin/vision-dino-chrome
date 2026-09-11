import type { Listener, TimestampMs, Unsubscribe } from "./common";
import type { PerPlayer, PlayerId } from "./player";

/** Semantic facial gestures the vision subsystem recognises. */
export type GestureKind = "blink" | "mouth-open";

/** Player 1 jumps by blinking; Player 2 jumps by opening their mouth. */
export const DEFAULT_PLAYER_GESTURES: PerPlayer<GestureKind> = { 1: "blink", 2: "mouth-open" };

export type VisionStatus = "idle" | "requesting-camera" | "loading-model" | "running" | "error";

export type VisionErrorCode =
  /** No mediaDevices API, or the page is not a secure context (HTTPS or localhost). */
  | "camera-unsupported"
  | "camera-permission-denied"
  | "camera-not-found"
  /** A camera exists but could not be opened, e.g. another application holds it. */
  | "camera-in-use"
  /** The camera track ended while running, e.g. the device was unplugged. */
  | "camera-disconnected"
  | "model-load-failed"
  | "inference-failed"
  | "unknown";

export interface VisionError {
  readonly code: VisionErrorCode;
  /** Developer-facing detail. The UI chooses user-facing copy from `code`. */
  readonly message: string;
}

export type VisionStartResult =
  { readonly ok: true } | { readonly ok: false; readonly error: VisionError };

export type CalibrationStep = "assign-players" | "neutral" | "gesture";

/** "default" means population-default thresholds were applied instead of measuring the player. */
export type CalibrationMode = "calibrated" | "default";

export type CalibrationFailureReason =
  | "not-running"
  | "not-enough-faces"
  | "face-lost"
  | "gesture-not-detected"
  | "unstable-measurements"
  | "timeout"
  | "cancelled";

export type AssignmentReason = "calibration" | "reacquired" | "swapped" | "reset";

// Vision events. `timestamp` is the time of the video frame that caused the event, or
// the time of the call for events caused by API calls (status changes, swaps, ...).

export interface VisionStatusChangedEvent {
  readonly type: "status-changed";
  readonly status: VisionStatus;
  readonly previous: VisionStatus;
  readonly timestamp: TimestampMs;
}

export interface VisionErrorEvent {
  readonly type: "error";
  readonly error: VisionError;
  readonly timestamp: TimestampMs;
}

/** The number of detected faces changed (after debouncing). */
export interface FacesChangedEvent {
  readonly type: "faces-changed";
  readonly count: number;
  readonly timestamp: TimestampMs;
}

/** Which face belongs to which player was (re)decided. */
export interface PlayersAssignedEvent {
  readonly type: "players-assigned";
  readonly reason: AssignmentReason;
  readonly timestamp: TimestampMs;
}

/** An assigned player's face has not been seen for longer than the lost-face timeout. */
export interface FaceLostEvent {
  readonly type: "face-lost";
  readonly playerId: PlayerId;
  readonly timestamp: TimestampMs;
}

/** A previously lost player's face is tracked again. */
export interface FaceFoundEvent {
  readonly type: "face-found";
  readonly playerId: PlayerId;
  readonly timestamp: TimestampMs;
}

/**
 * Emitted exactly once per activation of a gesture: when the detector's state goes from
 * idle to active. Nothing more is emitted while the gesture is held; the detector must
 * observe the reset condition (eyes reopened, mouth closed) before it can emit again.
 */
export interface VisionGestureEvent {
  readonly type: "gesture";
  readonly playerId: PlayerId;
  readonly gesture: GestureKind;
  readonly timestamp: TimestampMs;
}

export interface CalibrationProgressEvent {
  readonly type: "calibration-progress";
  /** null while assigning players, before identities exist. */
  readonly playerId: PlayerId | null;
  readonly step: CalibrationStep;
  /** 0..1 progress within the current step. */
  readonly progress: number;
  readonly timestamp: TimestampMs;
}

export interface CalibrationCompleteEvent {
  readonly type: "calibration-complete";
  readonly playerId: PlayerId;
  readonly mode: CalibrationMode;
  readonly timestamp: TimestampMs;
}

export interface CalibrationFailedEvent {
  readonly type: "calibration-failed";
  readonly playerId: PlayerId | null;
  readonly reason: CalibrationFailureReason;
  readonly timestamp: TimestampMs;
}

export type VisionEvent =
  | VisionStatusChangedEvent
  | VisionErrorEvent
  | FacesChangedEvent
  | PlayersAssignedEvent
  | FaceLostEvent
  | FaceFoundEvent
  | VisionGestureEvent
  | CalibrationProgressEvent
  | CalibrationCompleteEvent
  | CalibrationFailedEvent;

/**
 * Axis-aligned rectangle in normalised preview ("display") coordinates: 0..1, origin at the
 * top-left of the preview as the players see it, with mirroring already applied.
 */
export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * - `disarmed`: waiting to observe the reset condition (after start, calibration or reacquiring a face).
 * - `idle`: armed; the gesture is not active.
 * - `pending`: above the enter threshold but not yet for the minimum duration.
 * - `active`: the gesture fired; waiting for the score to drop below the exit threshold.
 */
export type GestureDetectorState = "disarmed" | "idle" | "pending" | "active";

export interface GestureDiagnostics {
  readonly gesture: GestureKind;
  /** Latest geometric measurement (eye or mouth aspect ratio), or null when unavailable. */
  readonly rawMetric: number | null;
  /** Smoothed activation score, normalised so 0 = neutral and 1 = full gesture. */
  readonly score: number | null;
  readonly enterThreshold: number;
  readonly exitThreshold: number;
  readonly state: GestureDetectorState;
  readonly cooldownRemainingMs: number;
  readonly lastGestureAt: TimestampMs | null;
  readonly calibration: CalibrationMode | "none";
}

export type PlayerTrackingState = "unassigned" | "tracked" | "lost";

export interface PlayerVisionDiagnostics {
  readonly playerId: PlayerId;
  readonly tracking: PlayerTrackingState;
  /** Face bounds in display coordinates; null unless tracked. */
  readonly faceRect: NormalizedRect | null;
  readonly lastSeenAt: TimestampMs | null;
  readonly gesture: GestureDiagnostics;
}

export interface VisionDiagnostics {
  readonly status: VisionStatus;
  readonly mirrored: boolean;
  readonly facesDetected: number;
  readonly players: PerPlayer<PlayerVisionDiagnostics>;
  /** Faces that are detected but not assigned to a player, in display coordinates. */
  readonly unassignedFaces: readonly NormalizedRect[];
  readonly processingFps: number | null;
  readonly inferenceMs: number | null;
  readonly frameTimestamp: TimestampMs | null;
}

/**
 * Camera + face-landmark + gesture pipeline, implemented by the vision module and by test
 * fakes. It emits semantic VisionEvents and never touches game state.
 */
export interface VisionSession {
  /**
   * Request the camera, load the model and start processing frames locally.
   * Must only be called in response to an explicit user action, such as a click.
   * Never rejects: failures resolve as `{ ok: false }` and are also emitted as "error" events.
   */
  start(): Promise<VisionStartResult>;
  /**
   * Stop processing, stop every camera track and detach the stream from the video element.
   * Idempotent. The session can be started again.
   */
  stop(): Promise<void>;
  /** stop(), then release the model. The session cannot be restarted. */
  dispose(): Promise<void>;
  getStatus(): VisionStatus;
  subscribe(listener: Listener<VisionEvent>): Unsubscribe;
  /** Begin, or restart, calibration for the given players (default: both). Reported through events. */
  startCalibration(players?: readonly PlayerId[]): void;
  cancelCalibration(): void;
  /**
   * Skip measuring and apply population-default thresholds for the given players (default: both).
   * Emits one "calibration-complete" event with mode "default" per player (ICR 2).
   */
  useDefaultCalibration(players?: readonly PlayerId[]): void;
  /** Exchange the Player 1 / Player 2 face assignment. Calibration data follows the new assignment. */
  swapPlayers(): void;
  /** Forget the assignment; the next stable pair of faces is assigned by left/right position. */
  resetAssignment(): void;
  /** Cheap in-memory snapshot for face labels and the debug overlay. Poll it; it is not pushed per frame. */
  getDiagnostics(): VisionDiagnostics;
}

export interface VisionSessionOptions {
  /** Element that displays the camera stream. The UI creates it and owns its layout. */
  readonly video: HTMLVideoElement;
  /** Whether the UI shows the preview mirrored (selfie view). Assignment and diagnostics depend on it. */
  readonly mirrored: boolean;
  /** Defaults to DEFAULT_PLAYER_GESTURES. */
  readonly playerGestures?: PerPlayer<GestureKind>;
}

export type VisionSessionFactory = (options: VisionSessionOptions) => VisionSession;
