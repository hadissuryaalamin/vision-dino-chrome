import type {
  GameController,
  GameEvent,
  GameResult,
  GameSnapshot,
  GameStatus,
  Listener,
  PerPlayer,
  PlayerId,
  PlayerSnapshot,
  Unsubscribe,
} from "../../src/shared";
import { ListenerList } from "./listeners";

export type FakeGameMethod = "jumpPlayer" | "start" | "pause" | "resume" | "restart" | "destroy";

export type FakeGameCall =
  | { readonly method: "jumpPlayer"; readonly playerId: PlayerId }
  | { readonly method: Exclude<FakeGameMethod, "jumpPlayer"> };

function playerSnapshot(playerId: PlayerId, score = 0, crashed = false): PlayerSnapshot {
  return { playerId, score, crashed, airborne: false };
}

export function createGameSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    status: "ready",
    elapsedMs: 0,
    players: { 1: playerSnapshot(1), 2: playerSnapshot(2) },
    result: null,
    ...overrides,
  };
}

/**
 * A GameController (plus the GameHandle-style `destroy()`) that records every call.
 *
 * It follows the status machine documented on GameController so the app sees realistic
 * `status-changed` events: `start` ready → running, `pause` running → paused, `resume`
 * paused → running, `restart` from any state → running. Commands that do not apply are
 * recorded and otherwise ignored. `jumpPlayer` is always recorded; `acceptedJumps` lists
 * only the jumps a real game would apply (status running, player not crashed).
 */
export class FakeGameController implements GameController {
  readonly calls: FakeGameCall[] = [];
  readonly acceptedJumps: PlayerId[] = [];
  destroyed = false;
  private snapshot: GameSnapshot;
  private readonly listeners = new ListenerList<GameEvent>();

  constructor(initial: Partial<GameSnapshot> = {}) {
    this.snapshot = createGameSnapshot(initial);
  }

  /** Player ids of every jumpPlayer call, in order. */
  get jumps(): PlayerId[] {
    return this.calls.flatMap((call) => (call.method === "jumpPlayer" ? [call.playerId] : []));
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  count(method: FakeGameMethod): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  jumpPlayer(playerId: PlayerId): void {
    this.calls.push({ method: "jumpPlayer", playerId });
    const player = this.snapshot.players[playerId];
    if (this.snapshot.status === "running" && !player.crashed) {
      this.acceptedJumps.push(playerId);
    }
  }

  start(): void {
    this.calls.push({ method: "start" });
    if (this.snapshot.status === "ready") this.setStatus("running");
  }

  pause(): void {
    this.calls.push({ method: "pause" });
    if (this.snapshot.status === "running") this.setStatus("paused");
  }

  resume(): void {
    this.calls.push({ method: "resume" });
    if (this.snapshot.status === "paused") this.setStatus("running");
  }

  restart(): void {
    this.calls.push({ method: "restart" });
    const previous = this.snapshot.status;
    this.snapshot = createGameSnapshot({ status: "running" });
    this.listeners.emit({ type: "status-changed", status: "running", previous, elapsedMs: 0 });
  }

  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  subscribe(listener: Listener<GameEvent>): Unsubscribe {
    return this.listeners.add(listener);
  }

  destroy(): void {
    this.calls.push({ method: "destroy" });
    this.destroyed = true;
  }

  // ---- Scripting helpers (not part of GameController) ----

  /** Replace snapshot fields without emitting events. */
  setSnapshot(overrides: Partial<GameSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...overrides };
  }

  setScores(scores: PerPlayer<number>): void {
    const players = this.snapshot.players;
    this.snapshot = {
      ...this.snapshot,
      players: {
        1: { ...players[1], score: scores[1] },
        2: { ...players[2], score: scores[2] },
      },
    };
  }

  /** Emit an arbitrary event without changing the snapshot. */
  emit(event: GameEvent): void {
    this.listeners.emit(event);
  }

  /** Mark a player as crashed and emit `player-crashed`. */
  crash(playerId: PlayerId): void {
    const player = this.snapshot.players[playerId];
    const players = { ...this.snapshot.players, [playerId]: { ...player, crashed: true } };
    this.snapshot = { ...this.snapshot, players };
    this.listeners.emit({
      type: "player-crashed",
      playerId,
      score: player.score,
      elapsedMs: this.snapshot.elapsedMs,
    });
  }

  /** End the round: status-changed to game-over, then game-over, as the real game does. */
  finish(result: GameResult): void {
    const previous = this.snapshot.status;
    this.snapshot = { ...this.snapshot, status: "game-over", result };
    const elapsedMs = this.snapshot.elapsedMs;
    this.listeners.emit({ type: "status-changed", status: "game-over", previous, elapsedMs });
    this.listeners.emit({ type: "game-over", result, elapsedMs });
  }

  private setStatus(status: GameStatus): void {
    const previous = this.snapshot.status;
    this.snapshot = {
      ...this.snapshot,
      status,
      result: status === "running" ? null : this.snapshot.result,
    };
    this.listeners.emit({
      type: "status-changed",
      status,
      previous,
      elapsedMs: this.snapshot.elapsedMs,
    });
  }
}
