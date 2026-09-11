import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_CONFIG,
  createGameEngine,
  jumpAirtimeMs,
  minimumGap,
  type GameEngine,
  type ObstacleState,
} from "../../src/game";
import { generateObstacle, pickObstacleKind } from "../../src/game/engine/obstacles";
import type { PlayerId } from "../../src/shared";
import { perfectJumps, runSteps } from "./helpers";

interface Recorded {
  readonly obstacle: ObstacleState;
  /** World speed when the obstacle was created. */
  readonly spawnSpeed: number;
  /** World speed when the dinosaur's front edge reached the obstacle, if it did. */
  reachSpeed: number | null;
}

function observe(engine: GameEngine, recorded: Map<number, Recorded>): void {
  const state = engine.getState();
  const config = engine.config;
  const front = state.distance + config.dinoX + config.dinoWidth;
  for (const obstacle of state.obstacles) {
    const entry = recorded.get(obstacle.id);
    if (!entry) {
      recorded.set(obstacle.id, { obstacle, spawnSpeed: state.speed, reachSpeed: null });
    } else if (entry.reachSpeed === null && front >= obstacle.x) {
      entry.reachSpeed = state.speed;
    }
  }
}

/** Run with the perfect player for `players`, recording every obstacle in order. */
function playRecorded(seed: number, steps: number, players: readonly PlayerId[]) {
  const engine = createGameEngine({ seed });
  engine.start();
  const recorded = new Map<number, Recorded>();
  let maxOnScreen = 0;
  runSteps(engine, steps, () => {
    perfectJumps(engine, players);
    observe(engine, recorded);
    maxOnScreen = Math.max(maxOnScreen, engine.getState().obstacles.length);
  });
  observe(engine, recorded);
  return { engine, recorded: [...recorded.values()], maxOnScreen };
}

const STEPS_PER_SECOND = 120;

describe("obstacle generation", () => {
  it("is a pure function of its inputs", () => {
    const params = { x: 1000, id: 3, speed: 600, rngState: 12345 };
    expect(generateObstacle(DEFAULT_GAME_CONFIG, params)).toEqual(
      generateObstacle(DEFAULT_GAME_CONFIG, params),
    );
    const { obstacle, nextX } = generateObstacle(DEFAULT_GAME_CONFIG, params);
    expect(obstacle.x).toBe(1000);
    expect(obstacle.id).toBe(3);
    expect(nextX).toBeGreaterThanOrEqual(
      1000 + obstacle.width + minimumGap(DEFAULT_GAME_CONFIG, 600),
    );
  });

  it("picks only kinds available at the current speed", () => {
    const kinds = DEFAULT_GAME_CONFIG.obstacleKinds;
    for (let r = 0; r < 1; r += 0.01) {
      expect(pickObstacleKind(kinds, 450, r).minSpeed).toBeLessThanOrEqual(450);
    }
    const fast = new Set<string>();
    for (let r = 0; r < 1; r += 0.01) fast.add(pickObstacleKind(kinds, 1000, r).id);
    expect(fast.size).toBe(kinds.length);
  });

  it("grows the minimum gap with speed, and it always covers airtime + reaction allowance", () => {
    const config = DEFAULT_GAME_CONFIG;
    const seconds = (jumpAirtimeMs(config) + config.reactionAllowanceMs) / 1000;
    let previous = 0;
    for (let speed = config.startSpeed; speed <= config.maxSpeed; speed += 25) {
      const gap = minimumGap(config, speed);
      expect(gap).toBeGreaterThan(previous);
      expect(gap).toBeGreaterThanOrEqual(speed * seconds);
      previous = gap;
    }
  });

  it("is deterministic for a seed and differs between seeds", () => {
    const a = playRecorded(5, 20 * STEPS_PER_SECOND, [1, 2]).recorded.map((r) => r.obstacle);
    const b = playRecorded(5, 20 * STEPS_PER_SECOND, [1, 2]).recorded.map((r) => r.obstacle);
    const c = playRecorded(6, 20 * STEPS_PER_SECOND, [1, 2]).recorded.map((r) => r.obstacle);
    expect(a.length).toBeGreaterThan(10);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("gives both lanes the same sequence, whoever plays", () => {
    // Only Player 1 plays in one run and only Player 2 in the other.
    const p1 = playRecorded(9, 30 * STEPS_PER_SECOND, [1]);
    const p2 = playRecorded(9, 30 * STEPS_PER_SECOND, [2]);
    expect(p1.recorded.map((r) => r.obstacle)).toEqual(p2.recorded.map((r) => r.obstacle));
    // The idle player crashed into an obstacle from that same shared list.
    const crash = p1.engine.getState().players[2].crash;
    expect(crash).not.toBeNull();
    const ids = new Set(p1.recorded.map((r) => r.obstacle.id));
    for (const obstacle of crash?.obstacles ?? []) expect(ids.has(obstacle.id)).toBe(true);
  });

  it("keeps the minimum gap, measured at the speed the dinosaur actually reaches it", () => {
    const config = DEFAULT_GAME_CONFIG;
    const seconds = (jumpAirtimeMs(config) + config.reactionAllowanceMs) / 1000;
    const { recorded, engine } = playRecorded(21, 100 * STEPS_PER_SECOND, [1, 2]);
    expect(engine.getState().speed).toBe(config.maxSpeed);
    for (let i = 1; i < recorded.length; i += 1) {
      const a = recorded[i - 1]!;
      const b = recorded[i]!;
      const gap = b.obstacle.x - (a.obstacle.x + a.obstacle.width);
      expect(gap).toBeGreaterThanOrEqual(minimumGap(config, a.spawnSpeed) - 1e-9);
      expect(gap).toBeGreaterThanOrEqual(a.spawnSpeed * seconds);
      if (b.reachSpeed !== null) expect(gap).toBeGreaterThanOrEqual(b.reachSpeed * seconds);
      expect(
        config.obstacleKinds.find((k) => k.id === b.obstacle.kind)!.minSpeed,
      ).toBeLessThanOrEqual(b.spawnSpeed);
    }
  });

  it("removes obstacles once they leave the screen", () => {
    const engine = createGameEngine({ seed: 4 });
    engine.start();
    let seen = 0;
    const ids = new Set<number>();
    runSteps(engine, 60 * STEPS_PER_SECOND, () => {
      perfectJumps(engine);
      const state = engine.getState();
      for (const obstacle of state.obstacles) {
        ids.add(obstacle.id);
        expect(obstacle.x + obstacle.width).toBeGreaterThanOrEqual(state.distance);
      }
      seen = Math.max(seen, state.obstacles.length);
    });
    expect(seen).toBeLessThanOrEqual(5);
    expect(ids.size).toBeGreaterThan(20);
    expect(engine.getState().obstacles.length).toBeLessThan(ids.size);
  });

  it("is clearable by a perfect player for many seeds, up to maximum speed", () => {
    let totalObstacles = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const { engine, recorded } = playRecorded(seed, 90 * STEPS_PER_SECOND, [1, 2]);
      const state = engine.getState();
      expect(state.players[1].crashed, `seed ${seed}`).toBe(false);
      expect(state.players[2].crashed, `seed ${seed}`).toBe(false);
      expect(state.status).toBe("running");
      expect(state.speed).toBe(engine.config.maxSpeed);
      totalObstacles += recorded.length;
    }
    expect(totalObstacles).toBeGreaterThan(40 * 50);
  });
});
