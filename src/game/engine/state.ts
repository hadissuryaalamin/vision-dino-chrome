import type { GameResult, GameStatus, PerPlayer, PlayerId } from "../../shared";

/** An obstacle in world coordinates. Both lanes share the same obstacle list. */
export interface ObstacleState {
  /** Increasing per round, starting at 0. */
  readonly id: number;
  /** ObstacleKind.id */
  readonly kind: string;
  /** World x of the left edge. */
  readonly x: number;
  readonly width: number;
  readonly height: number;
}

/** What a crashed player's lane looked like at the moment of the crash (the lane freezes). */
export interface CrashState {
  /** World distance at the crash. */
  readonly distance: number;
  /** Dinosaur height above the ground at the crash. */
  readonly y: number;
  readonly elapsedMs: number;
  /** Copy of the obstacles that existed at the crash. */
  readonly obstacles: readonly ObstacleState[];
}

export interface PlayerState {
  readonly playerId: PlayerId;
  /** Height of the dinosaur's feet above the ground, world units (never negative). */
  readonly y: number;
  /** Vertical velocity, units/s, positive upwards. */
  readonly vy: number;
  readonly grounded: boolean;
  readonly crashed: boolean;
  /** Non-negative integer; frozen once crashed. */
  readonly score: number;
  /** A jump requested while grounded; applied on the next step. */
  readonly jumpQueued: boolean;
  /** Time (elapsedMs) of the latest jump request made while airborne, or null. */
  readonly bufferedJumpAtMs: number | null;
  /** Time (elapsedMs) of the latest take-off, or null. Drives the renderer's jump cue. */
  readonly lastJumpAtMs: number | null;
  /** Number of jumps this round. */
  readonly jumps: number;
  readonly crash: CrashState | null;
}

/** Complete engine state. Plain data: two engines with equal inputs have deeply equal states. */
export interface GameState {
  readonly status: GameStatus;
  /** 1 for the first round, +1 on every restart(). */
  readonly round: number;
  /** Seed of the current round. */
  readonly seed: number;
  /** Obstacle PRNG state. */
  readonly rngState: number;
  /** Seed-stream PRNG state; restart() draws the next round's seed from it. */
  readonly seedRngState: number;
  /** Fixed steps simulated this round. */
  readonly stepCount: number;
  /** Simulated time of this round, ms (stepCount × step length). */
  readonly elapsedMs: number;
  /** World distance scrolled this round, units. */
  readonly distance: number;
  /** Current scrolling speed, units/s. */
  readonly speed: number;
  /** Obstacles sorted by x; removed once they have left the screen. */
  readonly obstacles: readonly ObstacleState[];
  /** World x of the next obstacle to create. */
  readonly nextObstacleX: number;
  readonly nextObstacleId: number;
  readonly players: PerPlayer<PlayerState>;
  /** Non-null only when status is "game-over". */
  readonly result: GameResult | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** @internal Engine-side mutable view of PlayerState. */
export type MutablePlayerState = Mutable<PlayerState>;

/** @internal Engine-side mutable view of GameState. */
export interface MutableGameState extends Mutable<Omit<GameState, "players" | "obstacles">> {
  players: { 1: MutablePlayerState; 2: MutablePlayerState };
  obstacles: ObstacleState[];
}

function createPlayerState(playerId: PlayerId): MutablePlayerState {
  return {
    playerId,
    y: 0,
    vy: 0,
    grounded: true,
    crashed: false,
    score: 0,
    jumpQueued: false,
    bufferedJumpAtMs: null,
    lastJumpAtMs: null,
    jumps: 0,
    crash: null,
  };
}

/** @internal A fresh round. */
export function createRoundState(params: {
  seed: number;
  seedRngState: number;
  round: number;
  status: GameStatus;
  startSpeed: number;
  firstObstacleX: number;
}): MutableGameState {
  return {
    status: params.status,
    round: params.round,
    seed: params.seed,
    rngState: params.seed,
    seedRngState: params.seedRngState,
    stepCount: 0,
    elapsedMs: 0,
    distance: 0,
    speed: params.startSpeed,
    obstacles: [],
    nextObstacleX: params.firstObstacleX,
    nextObstacleId: 0,
    players: { 1: createPlayerState(1), 2: createPlayerState(2) },
    result: null,
  };
}
