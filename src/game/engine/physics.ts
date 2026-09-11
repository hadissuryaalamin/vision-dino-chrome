import type { GameConfig, ObstacleKind } from "../config";

/**
 * Closed-form jump physics. The simulation integrates the same parabola exactly at every
 * fixed step (`y += vy·dt − g·dt²/2`), so these formulas describe the simulated arc at the
 * sample points.
 */

type JumpPhysics = Pick<GameConfig, "gravity" | "jumpVelocity">;

/** Time from take-off to landing, in ms. */
export function jumpAirtimeMs(config: JumpPhysics): number {
  return ((2 * config.jumpVelocity) / config.gravity) * 1000;
}

/** Height of the apex above the ground, in world units. */
export function jumpApexHeight(config: JumpPhysics): number {
  return (config.jumpVelocity * config.jumpVelocity) / (2 * config.gravity);
}

/** How long (ms) one jump keeps the dinosaur's feet at or above `height` world units. */
export function timeAboveHeightMs(config: JumpPhysics, height: number): number {
  if (height <= 0) return jumpAirtimeMs(config);
  const discriminant = config.jumpVelocity * config.jumpVelocity - 2 * config.gravity * height;
  if (discriminant <= 0) return 0;
  return ((2 * Math.sqrt(discriminant)) / config.gravity) * 1000;
}

type ClearanceConfig = Pick<
  GameConfig,
  "gravity" | "jumpVelocity" | "dinoWidth" | "collisionInset" | "fixedStepMs"
>;

/**
 * How long (ms) the dinosaur's collision box overlaps an obstacle's collision box
 * horizontally while running past it at `speed` units per second.
 */
export function obstacleOverlapMs(
  config: ClearanceConfig,
  kind: Pick<ObstacleKind, "width">,
  speed: number,
): number {
  const span =
    config.dinoWidth - 2 * config.collisionInset + kind.width - 2 * config.collisionInset;
  return (Math.max(0, span) / speed) * 1000;
}

/**
 * True when a single, perfectly timed jump clears the obstacle at `speed`, with a safety
 * margin of two fixed steps for step quantisation. Clearance gets easier as speed grows,
 * so checking the slowest speed at which a kind can appear is sufficient.
 */
export function isObstacleClearable(
  config: ClearanceConfig,
  kind: Pick<ObstacleKind, "width" | "height">,
  speed: number,
): boolean {
  const clearance = kind.height - 2 * config.collisionInset;
  const margin = 2 * config.fixedStepMs;
  return timeAboveHeightMs(config, clearance) >= obstacleOverlapMs(config, kind, speed) + margin;
}
