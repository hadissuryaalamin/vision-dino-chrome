/**
 * Public API of the game module (Agent 1: Game Systems).
 *
 * A deterministic two-player endless runner: two dinosaurs in two stacked lanes (Player 1
 * on top) face one shared, seeded obstacle sequence. The game accepts abstract commands
 * only (`GameController` from src/shared) and knows nothing about cameras or gestures.
 *
 * - {@link createGame}: engine + fixed-step loop + Canvas 2D renderer on a canvas.
 * - {@link createGameEngine}: the headless engine (`advance(dtMs)`, `getState()`), for tests.
 * - {@link createKeyboardInputSource}: a `PlayerInputSource` for `W` (P1) and `↑` (P2).
 * - {@link DEFAULT_GAME_CONFIG}, {@link DEFAULT_KEY_BINDINGS}: tuned defaults.
 *
 * Semantics (binding, see src/shared/game.ts):
 * - Commands never throw for state reasons; commands that do not apply are ignored.
 * - `jumpPlayer` takes effect on the next fixed step, only while "running" and not
 *   crashed; no double jump; an airborne request within `jumpBufferMs` of landing fires
 *   on landing.
 * - `restart()` works from any state, enters "running" and emits one `status-changed`
 *   (whose `previous` may also be "running"). The new round's seed is drawn from a seed
 *   stream derived from the engine's initial seed, so restarts are reproducible.
 * - Events are emitted synchronously after the change they describe. Within one step the
 *   order is `player-jumped`, `player-crashed`, `status-changed` (→ "game-over"),
 *   `game-over`.
 * - With `roundEnd: "all-crashed"` (default, decision O-03) the round ends when both
 *   players have crashed; with `"first-crash"` at the first crash. The higher score wins;
 *   equal scores give `winner: null`.
 * - `getSnapshot()` returns a frozen object that is only replaced after a state change.
 *
 * @packageDocumentation
 */

export { createGame, type CreateGameOptions, type GameHandle } from "./create-game";
export { createGameEngine, type GameEngine, type GameEngineOptions } from "./engine/engine";
export {
  DEFAULT_GAME_CONFIG,
  resolveGameConfig,
  type GameConfig,
  type ObstacleKind,
  type RoundEndRule,
} from "./config";
export type { CrashState, GameState, ObstacleState, PlayerState } from "./engine/state";
export {
  DEFAULT_KEY_BINDINGS,
  createKeyboardInputSource,
  isEditableTarget,
  type KeyBindings,
  type KeyboardInputOptions,
} from "./input/keyboard";
export {
  createAnimationFrameScheduler,
  createManualFrameScheduler,
  type FrameScheduler,
  type ManualFrameScheduler,
} from "./loop/scheduler";
export {
  DEFAULT_LANE_LABELS,
  JUMP_CUE_MS,
  renderGame,
  type GameRenderContext,
  type RenderOptions,
  type RenderViewport,
} from "./render/renderer";
export {
  isObstacleClearable,
  jumpAirtimeMs,
  jumpApexHeight,
  timeAboveHeightMs,
} from "./engine/physics";
export { minimumGap } from "./engine/obstacles";
export type { ListenerErrorHandler } from "./events";
