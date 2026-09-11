import { isObstacleClearable } from "./engine/physics";

/**
 * When a round ends (decision O-03).
 * - `all-crashed` (default): the round ends once both players have crashed.
 * - `first-crash`: the round ends at the first crash.
 */
export type RoundEndRule = "all-crashed" | "first-crash";

/** A ground obstacle shape. Every kind must be clearable with one jump (validated). */
export interface ObstacleKind {
  /** Stable name, e.g. `"cactus-small"`. Used by the renderer to pick a drawing. */
  readonly id: string;
  /** World units. */
  readonly width: number;
  /** World units above the ground. */
  readonly height: number;
  /** The kind is only spawned once the world speed is at least this (units/s). */
  readonly minSpeed: number;
  /** Relative spawn weight among eligible kinds (> 0). */
  readonly weight: number;
}

/**
 * Game tuning. Distances are world units (one lane is `laneWidth` × `laneHeight` units),
 * speeds are units per second, accelerations units per second², durations milliseconds.
 * Heights are measured upwards from the ground.
 */
export interface GameConfig {
  // Geometry
  /** Visible width of one lane in world units. */
  readonly laneWidth: number;
  /** Height of one lane in world units (rendering only). */
  readonly laneHeight: number;
  /** Distance from the top of a lane to the ground line (rendering only). */
  readonly groundY: number;
  /** Fixed screen position of the dinosaur's left edge. */
  readonly dinoX: number;
  readonly dinoWidth: number;
  readonly dinoHeight: number;

  // Physics
  /** Downward acceleration, units/s². */
  readonly gravity: number;
  /** Upward take-off velocity of a jump, units/s. */
  readonly jumpVelocity: number;

  // World speed
  /** Scrolling speed at the start of a round, units/s. */
  readonly startSpeed: number;
  /** Speed cap, units/s. */
  readonly maxSpeed: number;
  /** Speed increase per second of simulated time, units/s². */
  readonly acceleration: number;

  // Obstacles
  readonly obstacleKinds: readonly ObstacleKind[];
  /** World x of the first obstacle's left edge. The dinosaur starts at `dinoX`. */
  readonly firstObstacleX: number;
  /** Obstacles are created this far beyond the right edge of the lane, off screen. */
  readonly spawnMargin: number;
  /**
   * Extra time between landing and the next required take-off, on top of the jump
   * airtime. The minimum gap between obstacles is `speed × (airtime + reactionAllowance)`.
   * Covers gesture-detection latency (~150–250 ms).
   */
  readonly reactionAllowanceMs: number;
  /** Random extra gap, up to `speed × gapRandomExtraMs`. */
  readonly gapRandomExtraMs: number;
  /** Both collision boxes shrink by this many units on every side (forgiving hits). */
  readonly collisionInset: number;

  // Scoring and rules
  /** Score points per world unit travelled; the score is `floor(distance × scorePerUnit)`. */
  readonly scorePerUnit: number;
  readonly roundEnd: RoundEndRule;

  // Timing
  /** Simulation step. Rounded to whole microseconds internally. */
  readonly fixedStepMs: number;
  /** Larger real-time frame deltas are clamped to this (e.g. after a tab switch). */
  readonly maxFrameDeltaMs: number;
  /** An airborne jump request made at most this long before landing fires on landing. */
  readonly jumpBufferMs: number;
}

const DEFAULT_OBSTACLE_KINDS: readonly ObstacleKind[] = Object.freeze([
  Object.freeze({ id: "cactus-small", width: 26, height: 52, minSpeed: 0, weight: 3 }),
  Object.freeze({ id: "cactus-small-pair", width: 52, height: 52, minSpeed: 0, weight: 2 }),
  Object.freeze({ id: "cactus-large", width: 36, height: 76, minSpeed: 0, weight: 2 }),
  Object.freeze({ id: "cactus-small-triple", width: 78, height: 52, minSpeed: 550, weight: 1 }),
  Object.freeze({ id: "cactus-large-pair", width: 72, height: 76, minSpeed: 650, weight: 1 }),
]);

/** Default tuning (see src/game/README.md for the reasoning behind the values). */
export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = Object.freeze({
  laneWidth: 900,
  laneHeight: 280,
  groundY: 240,
  dinoX: 80,
  dinoWidth: 60,
  dinoHeight: 64,

  gravity: 3500,
  jumpVelocity: 960,

  startSpeed: 450,
  maxSpeed: 1000,
  acceleration: 7,

  obstacleKinds: DEFAULT_OBSTACLE_KINDS,
  firstObstacleX: 1300,
  spawnMargin: 100,
  reactionAllowanceMs: 350,
  gapRandomExtraMs: 900,
  collisionInset: 6,

  scorePerUnit: 0.025,
  roundEnd: "all-crashed",

  fixedStepMs: 1000 / 120,
  maxFrameDeltaMs: 100,
  jumpBufferMs: 100,
});

function requireNumber(
  config: GameConfig,
  key: keyof GameConfig,
  min: number,
  inclusive: boolean,
): void {
  const value = config[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`GameConfig.${key} must be a finite number, got ${JSON.stringify(value)}`);
  }
  if (inclusive ? value < min : value <= min) {
    throw new RangeError(
      `GameConfig.${key} must be ${inclusive ? ">=" : ">"} ${min}, got ${String(value)}`,
    );
  }
}

/**
 * Merge overrides into DEFAULT_GAME_CONFIG and validate the result. Throws a RangeError
 * for a config that cannot produce a fair, clearable game (for example an obstacle kind
 * that one jump cannot clear, or steps so long that the dinosaur could pass through an
 * obstacle between two steps).
 */
export function resolveGameConfig(overrides: Partial<GameConfig> = {}): Readonly<GameConfig> {
  const config: GameConfig = { ...DEFAULT_GAME_CONFIG, ...overrides };

  const positive: (keyof GameConfig)[] = [
    "laneWidth",
    "laneHeight",
    "groundY",
    "dinoWidth",
    "dinoHeight",
    "gravity",
    "jumpVelocity",
    "startSpeed",
    "maxSpeed",
    "fixedStepMs",
    "maxFrameDeltaMs",
    "scorePerUnit",
  ];
  const nonNegative: (keyof GameConfig)[] = [
    "dinoX",
    "acceleration",
    "firstObstacleX",
    "spawnMargin",
    "reactionAllowanceMs",
    "gapRandomExtraMs",
    "collisionInset",
    "jumpBufferMs",
  ];
  for (const key of positive) requireNumber(config, key, 0, false);
  for (const key of nonNegative) requireNumber(config, key, 0, true);

  if (config.roundEnd !== "all-crashed" && config.roundEnd !== "first-crash") {
    throw new RangeError(`GameConfig.roundEnd is invalid: ${String(config.roundEnd)}`);
  }
  if (config.maxSpeed < config.startSpeed) {
    throw new RangeError("GameConfig.maxSpeed must be >= startSpeed");
  }
  if (Math.round(config.fixedStepMs * 1000) < 1) {
    throw new RangeError("GameConfig.fixedStepMs must be at least 0.001 ms");
  }
  if (config.maxFrameDeltaMs < config.fixedStepMs) {
    throw new RangeError("GameConfig.maxFrameDeltaMs must be >= fixedStepMs");
  }
  if (2 * config.collisionInset >= config.dinoWidth) {
    throw new RangeError("GameConfig.collisionInset leaves no dinosaur collision box");
  }
  if (config.obstacleKinds.length === 0) {
    throw new RangeError("GameConfig.obstacleKinds must not be empty");
  }
  if (!config.obstacleKinds.some((kind) => kind.minSpeed <= config.startSpeed)) {
    throw new RangeError("At least one obstacle kind must be available at startSpeed");
  }

  const stepDistance = (config.maxSpeed * Math.round(config.fixedStepMs * 1000)) / 1_000_000;
  for (const kind of config.obstacleKinds) {
    if (!(kind.width > 2 * config.collisionInset) || !(kind.height > 2 * config.collisionInset)) {
      throw new RangeError(`Obstacle kind "${kind.id}" is smaller than the collision inset`);
    }
    if (!(kind.weight > 0) || !Number.isFinite(kind.weight)) {
      throw new RangeError(`Obstacle kind "${kind.id}" needs a positive weight`);
    }
    const slowest = Math.max(config.startSpeed, kind.minSpeed);
    if (!isObstacleClearable(config, kind, slowest)) {
      throw new RangeError(
        `Obstacle kind "${kind.id}" cannot be cleared by one jump at ${slowest} units/s`,
      );
    }
    const overlapSpan = config.dinoWidth + kind.width - 4 * config.collisionInset;
    if (stepDistance >= overlapSpan) {
      throw new RangeError(
        `One fixed step at maxSpeed moves ${stepDistance} units, enough to pass through "${kind.id}"`,
      );
    }
  }

  return Object.freeze(config);
}
