import type { GameConfig } from "../config";
import type { ObstacleState } from "./state";

/** Axis-aligned box in world units; y grows upwards from the ground. */
export interface CollisionBox {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
}

type CollisionConfig = Pick<GameConfig, "dinoX" | "dinoWidth" | "dinoHeight" | "collisionInset">;

/** The dinosaur's forgiving collision box at world distance `distance` and height `y`. */
export function dinoCollisionBox(
  config: CollisionConfig,
  distance: number,
  y: number,
): CollisionBox {
  const inset = config.collisionInset;
  const left = distance + config.dinoX;
  return {
    left: left + inset,
    right: left + config.dinoWidth - inset,
    bottom: y + inset,
    top: y + config.dinoHeight - inset,
  };
}

/** An obstacle's forgiving collision box. */
export function obstacleCollisionBox(
  config: Pick<GameConfig, "collisionInset">,
  obstacle: ObstacleState,
): CollisionBox {
  const inset = config.collisionInset;
  return {
    left: obstacle.x + inset,
    right: obstacle.x + obstacle.width - inset,
    bottom: inset,
    top: obstacle.height - inset,
  };
}

/** Strict overlap: boxes that only touch along an edge do not collide. */
export function boxesOverlap(a: CollisionBox, b: CollisionBox): boolean {
  return a.left < b.right && a.right > b.left && a.bottom < b.top && a.top > b.bottom;
}

/** True when the dinosaur at (`distance`, `y`) hits `obstacle`. Allocation-free. */
export function dinoHitsObstacle(
  config: CollisionConfig,
  distance: number,
  y: number,
  obstacle: ObstacleState,
): boolean {
  const inset = config.collisionInset;
  const dinoLeft = distance + config.dinoX + inset;
  const dinoRight = distance + config.dinoX + config.dinoWidth - inset;
  const dinoBottom = y + inset;
  const dinoTop = y + config.dinoHeight - inset;
  return (
    dinoLeft < obstacle.x + obstacle.width - inset &&
    dinoRight > obstacle.x + inset &&
    dinoBottom < obstacle.height - inset &&
    dinoTop > inset
  );
}
