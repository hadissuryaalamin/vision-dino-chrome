import type { Listener, Unsubscribe } from "./common";
import type { PerPlayer, PlayerId } from "./player";

/**
 * - `ready`: a round is prepared; the simulation is not advancing. Initial state.
 * - `running`: the simulation is advancing.
 * - `paused`: the simulation is frozen and can be resumed.
 * - `game-over`: every player has crashed; see GameSnapshot.result.
 */
export type GameStatus = "ready" | "running" | "paused" | "game-over";

export interface PlayerSnapshot {
  readonly playerId: PlayerId;
  /** Non-negative integer. Stops increasing once the player crashes. */
  readonly score: number;
  readonly crashed: boolean;
  /** True while the dinosaur is off the ground. */
  readonly airborne: boolean;
}

export interface GameResult {
  /**
   * The player with the higher final score. On equal scores, the player who crashed later (or
   * did not crash) wins. null only when both crashed in the same simulation step with equal
   * scores (ICR 1).
   */
  readonly winner: PlayerId | null;
  readonly scores: PerPlayer<number>;
}

/** Read-only view of the game for the UI. The engine's internal state may hold more. */
export interface GameSnapshot {
  readonly status: GameStatus;
  /** Simulated time of the current round in ms. Paused time is excluded. */
  readonly elapsedMs: number;
  readonly players: PerPlayer<PlayerSnapshot>;
  /** Non-null only when status is "game-over". */
  readonly result: GameResult | null;
}

export interface GameStatusChangedEvent {
  readonly type: "status-changed";
  readonly status: GameStatus;
  readonly previous: GameStatus;
  readonly elapsedMs: number;
}

export interface PlayerJumpedEvent {
  readonly type: "player-jumped";
  readonly playerId: PlayerId;
  readonly elapsedMs: number;
}

export interface PlayerCrashedEvent {
  readonly type: "player-crashed";
  readonly playerId: PlayerId;
  readonly score: number;
  readonly elapsedMs: number;
}

export interface GameOverEvent {
  readonly type: "game-over";
  readonly result: GameResult;
  readonly elapsedMs: number;
}

export type GameEvent =
  GameStatusChangedEvent | PlayerJumpedEvent | PlayerCrashedEvent | GameOverEvent;

/**
 * Game-facing command interface, implemented by the game module and by test fakes.
 * Every method is safe to call in any state: commands that do not apply are ignored,
 * never thrown.
 */
export interface GameController {
  /**
   * Request a jump. Applied on the next simulation step. Ignored unless the status is
   * "running" and the player has not crashed. Ignored while airborne (no double jump),
   * except that a request made shortly before landing may be buffered (game config
   * `jumpBufferMs`).
   */
  jumpPlayer(playerId: PlayerId): void;
  /** ready → running. Ignored in other states. */
  start(): void;
  /** running → paused. Ignored in other states. */
  pause(): void;
  /** paused → running. Ignored in other states. */
  resume(): void;
  /** From any state: discard the current round, prepare a new one and enter "running". */
  restart(): void;
  getSnapshot(): GameSnapshot;
  /** Listeners run synchronously, after the state change they describe. */
  subscribe(listener: Listener<GameEvent>): Unsubscribe;
}
