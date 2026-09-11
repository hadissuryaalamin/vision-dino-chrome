import type { Listener, TimestampMs, Unsubscribe } from "./common";
import type { PlayerId } from "./player";

/** Where an action came from. "simulated" covers test fakes and dev-only tools. */
export type PlayerActionSource = "keyboard" | "vision" | "simulated";

/** A request for one player's dinosaur to jump. */
export interface JumpAction {
  readonly type: "jump";
  readonly playerId: PlayerId;
  readonly source: PlayerActionSource;
  /** When the input happened: the key press time, or the video frame time for vision. */
  readonly timestamp: TimestampMs;
}

/**
 * Abstract, game-facing player action. Keyboard, vision and fake inputs all produce this
 * type, and the application layer routes it to GameController. New kinds of action are
 * added here as extra union members, as an orchestrator-owned contract change.
 */
export type PlayerAction = JumpAction;

/**
 * Anything that produces player actions: the keyboard adapter, the vision-to-action
 * adapter and test fakes.
 *
 * Starting a source must never request camera access by itself. The camera is started
 * only by VisionSession.start() in response to an explicit user action.
 */
export interface PlayerInputSource {
  /** Begin emitting actions. Idempotent. */
  start(): Promise<void> | void;
  /** Stop emitting actions and release everything acquired in start(). Idempotent. */
  stop(): Promise<void> | void;
  /** Listeners are called synchronously, in subscription order. */
  subscribe(listener: Listener<PlayerAction>): Unsubscribe;
}
