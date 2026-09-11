import { PLAYER_IDS, assertNever } from "../shared";
import type {
  CalibrationMode,
  CalibrationStep,
  GameEvent,
  GameResult,
  GameStatus,
  PerPlayer,
  PlayerId,
  PlayerTrackingState,
  VisionErrorCode,
  VisionEvent,
  VisionStartResult,
} from "../shared";
import type { Announcement, CalibrationFailureView, InputMode, ScreenId } from "../ui/view-model";

// The application state machine (docs/architecture.md §12). Pure: no DOM, no timers, no I/O.
// `transition` returns the next state plus the effects the composition root must perform.

export interface CalibrationPlayerState {
  readonly status: "waiting" | "in-progress" | "complete" | "failed";
  readonly step: CalibrationStep | null;
  readonly progress: number;
  readonly mode: CalibrationMode | null;
}

export interface CalibrationState {
  /** What the app last asked the session for: measuring, or population defaults. */
  readonly request: "measure" | "defaults" | null;
  readonly assigning: boolean;
  readonly players: PerPlayer<CalibrationPlayerState>;
  readonly failure: CalibrationFailureView | null;
}

export type AppNotice =
  | { readonly kind: "vision-error"; readonly code: VisionErrorCode }
  | { readonly kind: "camera-stopped-hidden" }
  | { readonly kind: "players-reassigned" };

export interface AppState {
  readonly screen: ScreenId;
  readonly mode: InputMode;
  readonly cameraSupported: boolean;
  /** Increases on every camera start, so a late result from an abandoned start is ignored. */
  readonly cameraAttempt: number;
  readonly cameraPhase: "requesting-camera" | "loading-model";
  readonly cameraError: VisionErrorCode | null;
  /** Players controlled by the camera; the others use the keyboard only. */
  readonly cameraPlayers: readonly PlayerId[];
  readonly facesDetected: number;
  readonly tracking: PerPlayer<PlayerTrackingState>;
  readonly calibration: CalibrationState;
  readonly gestureCounts: PerPlayer<number>;
  readonly game: { readonly status: GameStatus; readonly result: GameResult | null };
  readonly notice: AppNotice | null;
  readonly debugVisible: boolean;
}

export type AppEvent =
  /** "Play with camera" or "Try again". Only ever dispatched from a click handler. */
  | { readonly type: "choose-camera" }
  | { readonly type: "choose-keyboard" }
  | { readonly type: "camera-off" }
  | {
      readonly type: "vision-start-result";
      readonly attempt: number;
      readonly result: VisionStartResult;
    }
  | { readonly type: "vision-event"; readonly event: VisionEvent }
  | { readonly type: "continue-two-players" }
  | { readonly type: "continue-one-player"; readonly cameraPlayer: PlayerId }
  | { readonly type: "calibration-retry" }
  | { readonly type: "calibration-use-defaults" }
  | { readonly type: "swap-players" }
  | { readonly type: "reset-assignment" }
  | { readonly type: "game-event"; readonly event: GameEvent }
  /** Enter, or the Start / Play again buttons. */
  | { readonly type: "start-or-restart" }
  | { readonly type: "restart" }
  /** P or Escape. */
  | { readonly type: "toggle-pause" }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "toggle-debug" }
  | { readonly type: "dismiss-notice" }
  /** visibilitychange to hidden. */
  | { readonly type: "page-hidden" }
  /** pagehide: the page is being unloaded or put into the back-forward cache. */
  | { readonly type: "page-hide" };

export type AppEffect =
  | { readonly type: "start-vision"; readonly attempt: number }
  | { readonly type: "stop-vision" }
  | { readonly type: "start-calibration"; readonly players: readonly PlayerId[] }
  | { readonly type: "use-default-calibration"; readonly players: readonly PlayerId[] }
  | { readonly type: "swap-players" }
  | { readonly type: "reset-assignment" }
  | { readonly type: "game-start" }
  | { readonly type: "game-pause" }
  | { readonly type: "game-resume" }
  | { readonly type: "game-restart" }
  | { readonly type: "announce"; readonly announcement: Announcement };

export interface Transition {
  readonly state: AppState;
  readonly effects: readonly AppEffect[];
}

const GAME_SCREENS: ReadonlySet<ScreenId> = new Set(["ready", "playing", "paused", "game-over"]);
const CAMERA_SETUP_SCREENS: ReadonlySet<ScreenId> = new Set([
  "camera-starting",
  "positioning",
  "calibrating",
]);

const UNASSIGNED: PerPlayer<PlayerTrackingState> = { 1: "unassigned", 2: "unassigned" };
const WAITING: CalibrationPlayerState = { status: "waiting", step: null, progress: 0, mode: null };
const IDLE_CALIBRATION: CalibrationState = {
  request: null,
  assigning: false,
  players: { 1: WAITING, 2: WAITING },
  failure: null,
};
const STOP: AppEffect = { type: "stop-vision" };

/** Screens that show the game canvas with its HUD (the game phase of the flow). */
export function isGameScreen(screen: ScreenId): boolean {
  return GAME_SCREENS.has(screen);
}

export function createInitialAppState(options: {
  readonly cameraSupported: boolean;
  readonly gameStatus: GameStatus;
  readonly gameResult?: GameResult | null;
  readonly debugVisible?: boolean;
}): AppState {
  return {
    screen: "welcome",
    mode: "keyboard",
    cameraSupported: options.cameraSupported,
    cameraAttempt: 0,
    cameraPhase: "requesting-camera",
    cameraError: null,
    cameraPlayers: [],
    facesDetected: 0,
    tracking: UNASSIGNED,
    calibration: IDLE_CALIBRATION,
    gestureCounts: { 1: 0, 2: 0 },
    game: { status: options.gameStatus, result: options.gameResult ?? null },
    notice: null,
    debugVisible: options.debugVisible ?? false,
  };
}

/** Whether "Play with camera" (or "Try again") is available in this state. */
export function canChooseCamera(state: AppState): boolean {
  if (!state.cameraSupported) return false;
  if (state.screen === "welcome" || state.screen === "camera-error") return true;
  return state.mode === "keyboard" && (state.screen === "ready" || state.screen === "game-over");
}

export function transition(state: AppState, event: AppEvent): Transition {
  switch (event.type) {
    case "choose-camera":
      return chooseCamera(state);
    case "choose-keyboard":
      return isGameScreen(state.screen) ? cameraOff(state, "user") : leaveSetup(state);
    case "camera-off":
      return cameraOff(state, "user");
    case "vision-start-result":
      return visionStartResult(state, event.attempt, event.result);
    case "vision-event":
      return state.mode === "camera" ? visionEvent(state, event.event) : none(state);
    case "continue-two-players":
      return state.screen === "positioning" && state.facesDetected >= 2
        ? beginCalibration(state, PLAYER_IDS)
        : none(state);
    case "continue-one-player":
      return state.screen === "positioning" && state.facesDetected >= 1
        ? beginCalibration(state, [event.cameraPlayer])
        : none(state);
    case "calibration-retry":
      return state.screen === "calibrating"
        ? beginCalibration(state, state.cameraPlayers)
        : none(state);
    case "calibration-use-defaults":
      return useDefaults(state);
    case "swap-players":
      return canAdjustAssignment(state)
        ? { state, effects: [{ type: "swap-players" }] }
        : none(state);
    case "reset-assignment":
      return canAdjustAssignment(state)
        ? {
            state: { ...state, tracking: UNASSIGNED },
            effects: [{ type: "reset-assignment" }],
          }
        : none(state);
    case "game-event":
      return gameEvent(state, event.event);
    case "start-or-restart":
      return startOrRestart(state);
    case "restart":
      return isGameScreen(state.screen)
        ? { state, effects: [{ type: "game-restart" }] }
        : none(state);
    case "toggle-pause":
      if (!isGameScreen(state.screen)) return none(state);
      if (state.game.status === "running") return { state, effects: [{ type: "game-pause" }] };
      if (state.game.status === "paused") return { state, effects: [{ type: "game-resume" }] };
      return none(state);
    case "pause":
      return state.game.status === "running" && isGameScreen(state.screen)
        ? { state, effects: [{ type: "game-pause" }] }
        : none(state);
    case "resume":
      return state.game.status === "paused" && isGameScreen(state.screen)
        ? { state, effects: [{ type: "game-resume" }] }
        : none(state);
    case "toggle-debug": {
      const debugVisible = !state.debugVisible;
      return {
        state: { ...state, debugVisible },
        effects: [announce({ kind: "debug-overlay", visible: debugVisible })],
      };
    }
    case "dismiss-notice":
      return none({ ...state, notice: null });
    case "page-hidden":
      return state.game.status === "running"
        ? { state, effects: [{ type: "game-pause" }] }
        : none(state);
    case "page-hide": {
      const pause: AppEffect[] = state.game.status === "running" ? [{ type: "game-pause" }] : [];
      const off = cameraOff(state, "page-hidden");
      return { state: off.state, effects: [...pause, ...off.effects] };
    }
    default:
      return assertNever(event, "Unknown app event");
  }
}

// ---- Camera lifecycle ----

function chooseCamera(state: AppState): Transition {
  if (!canChooseCamera(state)) return none(state);
  const attempt = state.cameraAttempt + 1;
  return {
    state: {
      ...state,
      screen: "camera-starting",
      mode: "camera",
      cameraAttempt: attempt,
      cameraPhase: "requesting-camera",
      cameraError: null,
      cameraPlayers: PLAYER_IDS,
      facesDetected: 0,
      tracking: UNASSIGNED,
      calibration: IDLE_CALIBRATION,
      notice: null,
    },
    effects: [{ type: "start-vision", attempt }],
  };
}

/** Keyboard only from a setup screen: always ends on the ready screen. */
function leaveSetup(state: AppState): Transition {
  return {
    state: { ...withoutCamera(state), screen: "ready", cameraError: null, notice: null },
    effects: state.mode === "camera" ? [STOP] : [],
  };
}

function cameraOff(state: AppState, reason: "user" | "page-hidden"): Transition {
  if (state.mode !== "camera") return none(state);
  const screen = CAMERA_SETUP_SCREENS.has(state.screen) ? "ready" : state.screen;
  const notice: AppNotice | null =
    reason === "page-hidden" ? { kind: "camera-stopped-hidden" } : state.notice;
  return {
    state: { ...withoutCamera(state), screen, notice },
    effects: [STOP, announce({ kind: "camera-off", reason })],
  };
}

function visionStartResult(
  state: AppState,
  attempt: number,
  result: VisionStartResult,
): Transition {
  if (attempt !== state.cameraAttempt || state.screen !== "camera-starting") {
    // An abandoned start finished late. If it opened the camera, close it again.
    return { state, effects: result.ok && state.mode === "keyboard" ? [STOP] : [] };
  }
  if (result.ok) return none({ ...state, screen: "positioning" });
  return visionFailure(state, result.error.code);
}

/** A start failure or a runtime error: stop the session and fall back to the keyboard. */
function visionFailure(state: AppState, code: VisionErrorCode): Transition {
  const effects: AppEffect[] = [STOP, announce({ kind: "vision-error", code })];
  if (isGameScreen(state.screen)) {
    return { state: { ...withoutCamera(state), notice: { kind: "vision-error", code } }, effects };
  }
  return {
    state: { ...withoutCamera(state), screen: "camera-error", cameraError: code },
    effects,
  };
}

function withoutCamera(state: AppState): AppState {
  return {
    ...state,
    mode: "keyboard",
    cameraPlayers: [],
    facesDetected: 0,
    tracking: UNASSIGNED,
    calibration: IDLE_CALIBRATION,
  };
}

function canAdjustAssignment(state: AppState): boolean {
  return state.mode === "camera" && state.screen !== "camera-starting";
}

// ---- Vision events (camera mode only) ----

function visionEvent(state: AppState, event: VisionEvent): Transition {
  switch (event.type) {
    case "status-changed":
      if (
        state.screen === "camera-starting" &&
        (event.status === "requesting-camera" || event.status === "loading-model")
      ) {
        return none({ ...state, cameraPhase: event.status });
      }
      return none(state);
    case "error":
      // During start-up, the start() result reports the failure.
      return state.screen === "camera-starting"
        ? none(state)
        : visionFailure(state, event.error.code);
    case "faces-changed": {
      const next = { ...state, facesDetected: event.count };
      return state.screen === "positioning"
        ? { state: next, effects: [announce({ kind: "faces-detected", count: event.count })] }
        : none(next);
    }
    case "players-assigned": {
      let tracking = state.tracking;
      for (const playerId of state.cameraPlayers)
        tracking = withPlayer(tracking, playerId, "tracked");
      const notice: AppNotice | null =
        event.reason === "reacquired" && isGameScreen(state.screen)
          ? { kind: "players-reassigned" }
          : state.notice;
      return {
        state: { ...state, tracking, notice },
        effects: [announce({ kind: "players-assigned", reason: event.reason })],
      };
    }
    case "face-lost":
    case "face-found": {
      if (!state.cameraPlayers.includes(event.playerId)) return none(state);
      const lost = event.type === "face-lost";
      return {
        state: {
          ...state,
          tracking: withPlayer(state.tracking, event.playerId, lost ? "lost" : "tracked"),
        },
        effects: [announce({ kind: event.type, playerId: event.playerId })],
      };
    }
    case "gesture":
      if (!state.cameraPlayers.includes(event.playerId)) return none(state);
      return none({
        ...state,
        gestureCounts: withPlayer(
          state.gestureCounts,
          event.playerId,
          state.gestureCounts[event.playerId] + 1,
        ),
      });
    case "calibration-progress":
      return calibrationProgress(state, event.playerId, event.step, event.progress);
    case "calibration-complete":
      return calibrationComplete(state, event.playerId, event.mode);
    case "calibration-failed": {
      if (state.screen !== "calibrating") return none(state);
      // Applying defaults may cancel a measurement in progress; that is not a failure.
      if (event.reason === "cancelled" && state.calibration.request === "defaults") {
        return none(state);
      }
      const { playerId, reason } = event;
      const calibration = state.calibration;
      const players =
        playerId !== null && state.cameraPlayers.includes(playerId)
          ? withPlayer(calibration.players, playerId, {
              ...calibration.players[playerId],
              status: "failed" as const,
            })
          : calibration.players;
      return {
        state: {
          ...state,
          calibration: {
            ...calibration,
            request: null,
            assigning: false,
            players,
            failure: { playerId, reason },
          },
        },
        effects: [announce({ kind: "calibration-failed", playerId, reason })],
      };
    }
    default:
      return assertNever(event, "Unknown vision event");
  }
}

// ---- Calibration ----

function beginCalibration(state: AppState, players: readonly PlayerId[]): Transition {
  return {
    state: {
      ...state,
      screen: "calibrating",
      cameraPlayers: players,
      calibration: { ...IDLE_CALIBRATION, request: "measure", assigning: true },
    },
    effects: [{ type: "start-calibration", players }],
  };
}

function useDefaults(state: AppState): Transition {
  if (state.screen !== "calibrating") return none(state);
  return {
    state: {
      ...state,
      calibration: { ...state.calibration, request: "defaults", assigning: false, failure: null },
    },
    effects: [{ type: "use-default-calibration", players: state.cameraPlayers }],
  };
}

function calibrationProgress(
  state: AppState,
  playerId: PlayerId | null,
  step: CalibrationStep,
  progress: number,
): Transition {
  const calibration = state.calibration;
  if (state.screen !== "calibrating" || calibration.request !== "measure") return none(state);
  if (playerId === null)
    return none({ ...state, calibration: { ...calibration, assigning: true } });
  if (!state.cameraPlayers.includes(playerId)) return none(state);
  if (calibration.players[playerId].status === "complete") return none(state);
  const players = withPlayer(calibration.players, playerId, {
    status: "in-progress",
    step,
    progress: clamp01(progress),
    mode: null,
  });
  return none({ ...state, calibration: { ...calibration, assigning: false, players } });
}

function calibrationComplete(
  state: AppState,
  playerId: PlayerId,
  mode: CalibrationMode,
): Transition {
  if (!state.cameraPlayers.includes(playerId)) return none(state);
  const calibration = state.calibration;
  const players = withPlayer(calibration.players, playerId, {
    status: "complete",
    step: null,
    progress: 1,
    mode,
  });
  const tracking =
    state.tracking[playerId] === "unassigned"
      ? withPlayer(state.tracking, playerId, "tracked")
      : state.tracking;
  const next: AppState = {
    ...state,
    tracking,
    calibration: { ...calibration, assigning: false, players },
  };
  if (state.screen !== "calibrating") return none(next);

  const effects = [announce({ kind: "calibration-complete", playerId, mode })];
  const done = state.cameraPlayers.every((id) => players[id].status === "complete");
  if (!done) return { state: next, effects };
  return {
    state: {
      ...next,
      screen: "ready",
      calibration: { ...next.calibration, request: null, failure: null },
    },
    effects,
  };
}

// ---- Game ----

function gameEvent(state: AppState, event: GameEvent): Transition {
  switch (event.type) {
    case "status-changed": {
      const game = {
        status: event.status,
        result: event.status === "running" ? null : state.game.result,
      };
      const screen = isGameScreen(state.screen) ? screenForGameStatus(event.status) : state.screen;
      const announcement = statusAnnouncement(event.previous, event.status);
      return {
        state: { ...state, game, screen },
        effects: announcement ? [announce(announcement)] : [],
      };
    }
    case "game-over":
      return {
        state: { ...state, game: { status: "game-over", result: event.result } },
        effects: [announce({ kind: "game-over", result: event.result })],
      };
    case "player-crashed":
      return {
        state,
        effects: [
          announce({ kind: "player-crashed", playerId: event.playerId, score: event.score }),
        ],
      };
    case "player-jumped":
      return none(state);
    default:
      return assertNever(event, "Unknown game event");
  }
}

function startOrRestart(state: AppState): Transition {
  if (!isGameScreen(state.screen)) return none(state);
  switch (state.game.status) {
    case "ready":
      return { state, effects: [{ type: "game-start" }] };
    case "game-over":
      return { state, effects: [{ type: "game-restart" }] };
    case "paused":
      return { state, effects: [{ type: "game-resume" }] };
    case "running":
      return none(state);
    default:
      return assertNever(state.game.status, "Unknown game status");
  }
}

function screenForGameStatus(status: GameStatus): ScreenId {
  switch (status) {
    case "ready":
      return "ready";
    case "running":
      return "playing";
    case "paused":
      return "paused";
    case "game-over":
      return "game-over";
    default:
      return assertNever(status, "Unknown game status");
  }
}

function statusAnnouncement(previous: GameStatus, status: GameStatus): Announcement | null {
  if (status === "paused") return { kind: "game-paused" };
  if (status === "running")
    return previous === "paused" ? { kind: "game-resumed" } : { kind: "game-started" };
  return null;
}

// ---- Helpers ----

function none(state: AppState): Transition {
  return { state, effects: [] };
}

function announce(announcement: Announcement): AppEffect {
  return { type: "announce", announcement };
}

function withPlayer<T>(values: PerPlayer<T>, playerId: PlayerId, value: T): PerPlayer<T> {
  return playerId === 1 ? { 1: value, 2: values[2] } : { 1: values[1], 2: value };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
