import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_CONFIG,
  createGameEngine,
  jumpAirtimeMs,
  type ObstacleState,
} from "../../src/game";
import {
  boxesOverlap,
  dinoCollisionBox,
  dinoHitsObstacle,
  obstacleCollisionBox,
} from "../../src/game/engine/collision";
import { collectEvents, runUntilGameOver } from "./helpers";

const config = DEFAULT_GAME_CONFIG; // dinoX 80, dinoWidth 60, dinoHeight 64, inset 6
const obstacle: ObstacleState = { id: 0, kind: "test", x: 500, width: 40, height: 60 };

describe("collision boxes", () => {
  it("does not count contact exactly at the inset edge (leading edge)", () => {
    // Dino collision right edge = distance + 80 + 60 - 6; obstacle collision left = 506.
    expect(dinoHitsObstacle(config, 372, 0, obstacle)).toBe(false);
    expect(dinoHitsObstacle(config, 372.001, 0, obstacle)).toBe(true);
  });

  it("does not count contact exactly at the inset edge (trailing edge)", () => {
    // Dino collision left edge = distance + 86; obstacle collision right = 534.
    expect(dinoHitsObstacle(config, 448, 0, obstacle)).toBe(false);
    expect(dinoHitsObstacle(config, 447.999, 0, obstacle)).toBe(true);
  });

  it("forgives visual overlaps smaller than both insets", () => {
    // Drawn boxes overlap by 5 units, collision boxes do not.
    expect(dinoHitsObstacle(config, 365, 0, obstacle)).toBe(false);
  });

  it("clears an obstacle when the feet are exactly at the inset-adjusted top", () => {
    // Obstacle collision top = 54; dino collision bottom = y + 6.
    expect(dinoHitsObstacle(config, 420, 48, obstacle)).toBe(false);
    expect(dinoHitsObstacle(config, 420, 47.999, obstacle)).toBe(true);
  });

  it("treats a near miss above the obstacle as a miss", () => {
    for (let distance = 360; distance <= 460; distance += 2) {
      expect(dinoHitsObstacle(config, distance, 49, obstacle)).toBe(false);
    }
  });

  it("agrees with the explicit box helpers", () => {
    for (let distance = 360; distance <= 460; distance += 3.7) {
      for (let y = 0; y <= 70; y += 2.3) {
        const expected = boxesOverlap(
          dinoCollisionBox(config, distance, y),
          obstacleCollisionBox(config, obstacle),
        );
        expect(dinoHitsObstacle(config, distance, y, obstacle)).toBe(expected);
      }
    }
  });

  it("does not count touching boxes as overlapping", () => {
    const a = { left: 0, right: 10, bottom: 0, top: 10 };
    expect(boxesOverlap(a, { left: 10, right: 20, bottom: 0, top: 10 })).toBe(false);
    expect(boxesOverlap(a, { left: 0, right: 10, bottom: 10, top: 20 })).toBe(false);
    expect(boxesOverlap(a, { left: 9.99, right: 20, bottom: 0, top: 10 })).toBe(true);
  });
});

describe("collisions in the engine", () => {
  it("crashes an idle player into the first obstacle while grounded", () => {
    const engine = createGameEngine({ seed: 2 });
    const events = collectEvents(engine);
    engine.start();
    runUntilGameOver(engine);
    const crash = engine.getState().players[1].crash;
    expect(crash).not.toBeNull();
    expect(crash?.y).toBe(0);
    expect(events.filter((e) => e.type === "player-crashed")).toHaveLength(2);
  });

  it("crashes a player during a jump that starts too early", () => {
    const engine = createGameEngine({ seed: 2 });
    engine.start();
    const airtime = jumpAirtimeMs(engine.config) / 1000;
    runUntilGameOver(engine, 20_000, () => {
      const state = engine.getState();
      const player = state.players[1];
      const next = state.obstacles[0];
      if (!next || !player.grounded || player.jumps > 0) return;
      const front = state.distance + config.dinoX + config.dinoWidth;
      // Take off 0.2 s earlier than a perfect player would.
      if ((next.x - front) / state.speed <= airtime / 2 + 0.2) engine.jumpPlayer(1);
    });
    const player = engine.getState().players[1];
    expect(player.jumps).toBe(1);
    expect(player.crashed).toBe(true);
    expect(player.grounded).toBe(false);
    expect(player.crash?.y).toBeGreaterThan(0);
  });
});
