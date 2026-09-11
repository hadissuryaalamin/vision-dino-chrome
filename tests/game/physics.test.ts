import { describe, expect, it } from "vitest";
import { jumpAirtimeMs, jumpApexHeight, type GameEngine } from "../../src/game";
import { NO_OBSTACLES, collectEvents, runSteps, startedEngine, stepMsOf } from "./helpers";

/** Steps from the jump request until the dinosaur is grounded again. */
function stepsUntilLanded(engine: GameEngine): number {
  let steps = 0;
  do {
    runSteps(engine, 1);
    steps += 1;
  } while (!engine.getState().players[1].grounded && steps < 10_000);
  return steps;
}

describe("jump physics", () => {
  it("applies a jump on the next step, not immediately", () => {
    const engine = startedEngine({ config: NO_OBSTACLES });
    engine.jumpPlayer(1);
    expect(engine.getState().players[1].grounded).toBe(true);
    expect(engine.getSnapshot().players[1].airborne).toBe(false);
    runSteps(engine, 1);
    expect(engine.getState().players[1].grounded).toBe(false);
    expect(engine.getState().players[1].y).toBeGreaterThan(0);
    expect(engine.getSnapshot().players[1].airborne).toBe(true);
    expect(engine.getState().players[2].grounded).toBe(true);
  });

  it("follows the jump arc: rises, reaches the apex, lands after the airtime", () => {
    const engine = startedEngine({ config: NO_OBSTACLES });
    const stepMs = stepMsOf(engine);
    engine.jumpPlayer(1);
    let maxY = 0;
    let previousY = 0;
    let rising = true;
    let apexStep = 0;
    let steps = 0;
    do {
      runSteps(engine, 1);
      steps += 1;
      const y = engine.getState().players[1].y;
      if (rising && y < previousY) {
        rising = false;
        apexStep = steps - 1;
      }
      if (!rising && engine.getState().players[1].grounded) break;
      if (!rising) expect(y).toBeLessThanOrEqual(previousY);
      maxY = Math.max(maxY, y);
      previousY = y;
    } while (steps < 1000);

    const apex = jumpApexHeight(engine.config);
    expect(maxY).toBeLessThanOrEqual(apex);
    expect(maxY).toBeGreaterThan(apex - 1);
    const airtime = jumpAirtimeMs(engine.config);
    expect(apexStep * stepMs).toBeGreaterThan(airtime / 2 - 2 * stepMs);
    expect(apexStep * stepMs).toBeLessThan(airtime / 2 + 2 * stepMs);
    expect(steps * stepMs).toBeGreaterThanOrEqual(airtime);
    expect(steps * stepMs).toBeLessThan(airtime + stepMs + 1e-9);
  });

  it("clamps to the ground: never below it, and at rest after landing", () => {
    const engine = startedEngine({ config: NO_OBSTACLES });
    engine.jumpPlayer(2);
    for (let i = 0; i < 200; i += 1) {
      runSteps(engine, 1);
      expect(engine.getState().players[2].y).toBeGreaterThanOrEqual(0);
    }
    const player = engine.getState().players[2];
    expect(player.grounded).toBe(true);
    expect(player.y).toBe(0);
    expect(player.vy).toBe(0);
  });

  it("does not double jump", () => {
    const engine = startedEngine({ config: NO_OBSTACLES });
    const events = collectEvents(engine);
    engine.jumpPlayer(1);
    engine.jumpPlayer(1);
    runSteps(engine, 5);
    const vyBefore = engine.getState().players[1].vy;
    engine.jumpPlayer(1); // airborne, far from landing
    runSteps(engine, 1);
    expect(engine.getState().players[1].vy).toBeLessThan(vyBefore);
    runSteps(engine, 200);
    expect(engine.getState().players[1].jumps).toBe(1);
    expect(events.filter((e) => e.type === "player-jumped")).toHaveLength(1);
  });

  describe("jump buffer (default 100 ms)", () => {
    // Reference: how many steps a jump takes from request to landing.
    const reference = startedEngine({ config: NO_OBSTACLES });
    reference.jumpPlayer(1);
    const landingSteps = stepsUntilLanded(reference);

    function requestStepsBeforeLanding(stepsBefore: number): {
      engine: GameEngine;
      jumps: number[];
    } {
      const engine = startedEngine({ config: NO_OBSTACLES });
      const jumps: number[] = [];
      engine.subscribe((event) => {
        if (event.type === "player-jumped") jumps.push(event.elapsedMs);
      });
      engine.jumpPlayer(1);
      runSteps(engine, landingSteps - stepsBefore);
      engine.jumpPlayer(1);
      runSteps(engine, stepsBefore);
      return { engine, jumps };
    }

    it("fires a request made 6 steps (50 ms) before landing on the landing step", () => {
      const { engine, jumps } = requestStepsBeforeLanding(6);
      expect(jumps).toHaveLength(2);
      expect(jumps[1]).toBeCloseTo(engine.getState().elapsedMs, 9);
      expect(engine.getState().players[1].grounded).toBe(false);
      expect(engine.getState().players[1].bufferedJumpAtMs).toBeNull();
    });

    it("fires at the edge of the window (12 steps ≈ 99.996 ms)", () => {
      const { jumps } = requestStepsBeforeLanding(12);
      expect(jumps).toHaveLength(2);
    });

    it("ignores a request just outside the window (13 steps ≈ 108 ms)", () => {
      const { engine, jumps } = requestStepsBeforeLanding(13);
      expect(jumps).toHaveLength(1);
      expect(engine.getState().players[1].grounded).toBe(true);
      expect(engine.getState().players[1].bufferedJumpAtMs).toBeNull();
    });

    it("ignores a request far outside the window (200 ms)", () => {
      const { jumps } = requestStepsBeforeLanding(24);
      expect(jumps).toHaveLength(1);
    });

    it("can be disabled with jumpBufferMs: 0", () => {
      const engine = startedEngine({ config: { ...NO_OBSTACLES, jumpBufferMs: 0 } });
      engine.jumpPlayer(1);
      runSteps(engine, landingSteps - 1);
      engine.jumpPlayer(1);
      runSteps(engine, 1);
      expect(engine.getState().players[1].jumps).toBe(1);
      expect(engine.getState().players[1].grounded).toBe(true);
    });
  });
});
