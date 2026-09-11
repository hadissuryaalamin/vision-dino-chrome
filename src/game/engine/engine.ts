import {
  isPlayerId,
  type GameController,
  type GameEvent,
  type GameSnapshot,
  type GameStatus,
} from "../../shared";
import { resolveGameConfig, type GameConfig } from "../config";
import { createEmitter, rethrowAsync, type ListenerErrorHandler } from "../events";
import { createFixedStepClock } from "../loop/fixed-step";
import { createRandomSeed, normalizeSeed, randomUint32, seedStreamState } from "../random";
import { createSnapshot } from "./snapshot";
import { createRoundState, type GameState, type MutableGameState } from "./state";
import { simulateStep } from "./step";

export interface GameEngineOptions {
  /** Fixed seed makes rounds reproducible. Default: a random seed from crypto.getRandomValues. */
  seed?: number;
  /** Overrides merged into DEFAULT_GAME_CONFIG and validated (throws RangeError if invalid). */
  config?: Partial<GameConfig>;
  /**
   * Called with any error a GameEvent listener throws, so a faulty listener cannot leave a
   * step half-done. Default: rethrow asynchronously (reported, but not in the caller's stack).
   */
  onListenerError?: ListenerErrorHandler;
}

/** Headless engine: no DOM, no timers. The unit-testing entry point. */
export interface GameEngine extends GameController {
  /**
   * Advance by a real-time delta in ms; clamped to maxFrameDeltaMs and split into fixed
   * steps. Ignored unless the status is "running". Zero, negative and NaN deltas are ignored.
   */
  advance(dtMs: number): void;
  /** Full internal state for the renderer and tests. Read-only by convention; live object. */
  getState(): Readonly<GameState>;
  /** The resolved, frozen configuration. */
  readonly config: Readonly<GameConfig>;
}

export function createGameEngine(options: GameEngineOptions = {}): GameEngine {
  const config = resolveGameConfig(options.config);
  const firstSeed = normalizeSeed(options.seed ?? createRandomSeed());
  const emitter = createEmitter<GameEvent>(options.onListenerError ?? rethrowAsync);
  const clock = createFixedStepClock(config);

  const newRound = (
    seed: number,
    seedRngState: number,
    round: number,
    status: GameStatus,
  ): MutableGameState =>
    createRoundState({
      seed,
      seedRngState,
      round,
      status,
      startSpeed: config.startSpeed,
      firstObstacleX: config.firstObstacleX,
    });

  let state = newRound(firstSeed, seedStreamState(firstSeed), 1, "ready");
  let snapshot: GameSnapshot | null = null;
  let advancing = false;

  const changeStatus = (next: GameStatus): void => {
    const previous = state.status;
    state.status = next;
    snapshot = null;
    emitter.emit({ type: "status-changed", status: next, previous, elapsedMs: state.elapsedMs });
  };

  return {
    config,

    jumpPlayer(playerId) {
      if (!isPlayerId(playerId) || state.status !== "running") return;
      const player = state.players[playerId];
      if (player.crashed) return;
      if (player.grounded) {
        // Several requests before the next step still make one jump.
        player.jumpQueued = true;
      } else {
        // Remember only the latest airborne request; it fires on landing if recent enough.
        player.bufferedJumpAtMs = state.elapsedMs;
      }
    },

    start() {
      if (state.status !== "ready") return;
      clock.reset();
      changeStatus("running");
    },

    pause() {
      if (state.status === "running") changeStatus("paused");
    },

    resume() {
      if (state.status === "paused") changeStatus("running");
    },

    restart() {
      const previous = state.status;
      const next = randomUint32(state.seedRngState);
      state = newRound(next.value, next.state, state.round + 1, "running");
      clock.reset();
      snapshot = null;
      emitter.emit({ type: "status-changed", status: "running", previous, elapsedMs: 0 });
    },

    advance(dtMs) {
      if (advancing || state.status !== "running") return;
      const steps = clock.add(dtMs);
      if (steps === 0) return;
      advancing = true;
      try {
        const events: GameEvent[] = [];
        for (let i = 0; i < steps; i += 1) {
          const current = state;
          simulateStep(current, config, clock.stepUs, events);
          snapshot = null;
          for (const event of events.splice(0)) emitter.emit(event);
          // A listener may have paused or restarted the round; the game may be over.
          if (state !== current || state.status !== "running") break;
        }
      } finally {
        advancing = false;
      }
    },

    getState() {
      return state;
    },

    getSnapshot() {
      snapshot ??= createSnapshot(state);
      return snapshot;
    },

    subscribe(listener) {
      return emitter.subscribe(listener);
    },
  };
}
