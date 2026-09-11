import type { GestureKind, PerPlayer, PlayerId } from "../shared";
import type {
  CalibrationPlayerView,
  HudPlayerView,
  NoticeView,
  PlayerControl,
  ScreenView,
  ViewModel,
} from "../ui/view-model";
import { canChooseCamera, isGameScreen } from "./state";
import type { AppState } from "./state";

/** Derive the plain data the UI renders from the app state. Pure. */
export function toViewModel(state: AppState, playerGestures: PerPlayer<GestureKind>): ViewModel {
  const controls = perPlayer((playerId) => controlOf(state, playerId));
  return {
    screen: screenView(state, controls),
    mode: state.mode,
    hud: {
      visible: isGameScreen(state.screen),
      canPause: state.screen === "playing",
      players: perPlayer((playerId) =>
        hudPlayer(state, playerId, controls[playerId], playerGestures),
      ),
    },
    camera:
      state.mode === "camera"
        ? {
            starting: state.screen === "camera-starting",
            facesDetected: state.facesDetected,
            controls,
            tracking: state.tracking,
            canAdjustAssignment: state.screen !== "camera-starting",
          }
        : null,
    notice: noticeView(state),
    debugVisible: state.debugVisible,
  };
}

function controlOf(state: AppState, playerId: PlayerId): PlayerControl {
  return state.mode === "camera" && state.cameraPlayers.includes(playerId) ? "camera" : "keyboard";
}

function screenView(state: AppState, controls: PerPlayer<PlayerControl>): ScreenView {
  switch (state.screen) {
    case "welcome":
      return { id: "welcome", cameraSupported: state.cameraSupported };
    case "camera-starting":
      return { id: "camera-starting", phase: state.cameraPhase };
    case "camera-error":
      return {
        id: "camera-error",
        code: state.cameraError ?? "unknown",
        cameraSupported: state.cameraSupported,
      };
    case "positioning":
      return { id: "positioning", facesDetected: state.facesDetected };
    case "calibrating":
      return {
        id: "calibrating",
        assigning: state.calibration.assigning,
        players: perPlayer((playerId): CalibrationPlayerView => ({
          playerId,
          control: controls[playerId],
          ...state.calibration.players[playerId],
        })),
        failure: state.calibration.failure,
      };
    case "ready":
      return { id: "ready", controls, canUseCamera: canChooseCamera(state) };
    case "playing":
      return { id: "playing" };
    case "paused":
      return { id: "paused" };
    case "game-over":
      return { id: "game-over", result: state.game.result, canUseCamera: canChooseCamera(state) };
  }
}

function hudPlayer(
  state: AppState,
  playerId: PlayerId,
  control: PlayerControl,
  playerGestures: PerPlayer<GestureKind>,
): HudPlayerView {
  return {
    playerId,
    control,
    gesture: playerGestures[playerId],
    tracking: control === "camera" ? state.tracking[playerId] : null,
    gestureCount: state.gestureCounts[playerId],
  };
}

function noticeView(state: AppState): NoticeView | null {
  const notice = state.notice;
  if (!notice) return null;
  switch (notice.kind) {
    case "vision-error":
      return {
        kind: "vision-error",
        code: notice.code,
        canRetry: notice.code !== "camera-unsupported" && canChooseCamera(state),
      };
    case "camera-stopped-hidden":
      return { kind: "camera-stopped-hidden", canRetry: canChooseCamera(state) };
    case "players-reassigned":
      return state.mode === "camera" ? { kind: "players-reassigned" } : null;
  }
}

function perPlayer<T>(make: (playerId: PlayerId) => T): PerPlayer<T> {
  return { 1: make(1), 2: make(2) };
}
