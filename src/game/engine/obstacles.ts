import type { GameConfig, ObstacleKind } from "../config";
import { randomFloat } from "../random";
import { jumpAirtimeMs } from "./physics";
import type { ObstacleState } from "./state";

type GapConfig = Pick<
  GameConfig,
  | "gravity"
  | "jumpVelocity"
  | "reactionAllowanceMs"
  | "acceleration"
  | "maxSpeed"
  | "laneWidth"
  | "spawnMargin"
  | "dinoX"
  | "obstacleKinds"
>;

/**
 * Upper bound on the speed the world can reach before the dinosaur has run through the
 * minimum gap that follows an obstacle created now. Obstacles are created up to
 * `laneWidth + spawnMargin` ahead, and speed only grows, so the time to cover a distance
 * `D` is at most `D / speed`. Solving `vp = v + a·(H + vp·k) / v` for vp, with
 * `k = airtime + reactionAllowance`, gives the closed form below.
 */
export function projectedSpeed(config: GapConfig, speed: number): number {
  const k = (jumpAirtimeMs(config) + config.reactionAllowanceMs) / 1000;
  const maxWidth = Math.max(...config.obstacleKinds.map((kind) => kind.width));
  const horizon = config.laneWidth + config.spawnMargin + maxWidth - config.dinoX;
  const denominator = 1 - (config.acceleration * k) / speed;
  if (denominator <= 0) return config.maxSpeed;
  const projected = (speed + (config.acceleration * horizon) / speed) / denominator;
  return Math.min(config.maxSpeed, Math.max(speed, projected));
}

/**
 * Minimum edge-to-edge gap (world units) after an obstacle created at `speed`:
 * `projectedSpeed × (airtime + reactionAllowance)`. A perfect player therefore always has
 * at least `reactionAllowanceMs` on the ground between two jumps.
 */
export function minimumGap(config: GapConfig, speed: number): number {
  const seconds = (jumpAirtimeMs(config) + config.reactionAllowanceMs) / 1000;
  return projectedSpeed(config, speed) * seconds;
}

/** Kinds that may appear at `speed`. Falls back to the kind with the lowest minSpeed. */
export function eligibleObstacleKinds(
  kinds: readonly ObstacleKind[],
  speed: number,
): readonly ObstacleKind[] {
  const eligible = kinds.filter((kind) => kind.minSpeed <= speed);
  if (eligible.length > 0) return eligible;
  const slowest = kinds.reduce((a, b) => (b.minSpeed < a.minSpeed ? b : a));
  return [slowest];
}

/** Weighted choice with `r` in [0, 1). */
export function pickObstacleKind(
  kinds: readonly ObstacleKind[],
  speed: number,
  r: number,
): ObstacleKind {
  const eligible = eligibleObstacleKinds(kinds, speed);
  const total = eligible.reduce((sum, kind) => sum + kind.weight, 0);
  let threshold = r * total;
  for (const kind of eligible) {
    threshold -= kind.weight;
    if (threshold < 0) return kind;
  }
  // Floating-point edge case: r * total rounded up to total.
  return eligible[eligible.length - 1] ?? kinds[0]!;
}

export interface GeneratedObstacle {
  readonly obstacle: ObstacleState;
  /** World x for the next obstacle's left edge. */
  readonly nextX: number;
  readonly rngState: number;
}

/**
 * Create the obstacle whose left edge is at `x`, and decide where the next one goes.
 * Pure: the result depends only on the arguments. Consumes exactly two random draws.
 */
export function generateObstacle(
  config: GapConfig & Pick<GameConfig, "gapRandomExtraMs">,
  params: { x: number; id: number; speed: number; rngState: number },
): GeneratedObstacle {
  const kindDraw = randomFloat(params.rngState);
  const gapDraw = randomFloat(kindDraw.state);
  const kind = pickObstacleKind(config.obstacleKinds, params.speed, kindDraw.value);
  const obstacle: ObstacleState = Object.freeze({
    id: params.id,
    kind: kind.id,
    x: params.x,
    width: kind.width,
    height: kind.height,
  });
  const extra = gapDraw.value * params.speed * (config.gapRandomExtraMs / 1000);
  const gap = minimumGap(config, params.speed) + extra;
  return { obstacle, nextX: params.x + kind.width + gap, rngState: gapDraw.state };
}
