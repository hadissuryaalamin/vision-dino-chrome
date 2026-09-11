import { describe, expect, it } from "vitest";
import { createGameEngine } from "../../src/game";
import { NO_OBSTACLES, cloneState, perfectJumps, runSteps, runUntilGameOver } from "./helpers";

describe("restart", () => {
  it("resets everything for a new round", () => {
    const engine = createGameEngine({ seed: 8 });
    engine.start();
    runSteps(engine, 3000, () => perfectJumps(engine, [1]));
    engine.jumpPlayer(1);
    engine.restart();
    const state = engine.getState();
    const config = engine.config;
    expect(state).toMatchObject({
      status: "running",
      round: 2,
      stepCount: 0,
      elapsedMs: 0,
      distance: 0,
      speed: config.startSpeed,
      obstacles: [],
      nextObstacleX: config.firstObstacleX,
      nextObstacleId: 0,
      result: null,
    });
    for (const player of [state.players[1], state.players[2]]) {
      expect(player).toMatchObject({
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
      });
    }
    expect(engine.getSnapshot()).toEqual({
      status: "running",
      elapsedMs: 0,
      players: {
        1: { playerId: 1, score: 0, crashed: false, airborne: false },
        2: { playerId: 2, score: 0, crashed: false, airborne: false },
      },
      result: null,
    });
  });

  it("derives a new seed deterministically", () => {
    const a = createGameEngine({ seed: 42 });
    const b = createGameEngine({ seed: 42 });
    a.restart();
    b.restart();
    expect(a.getState().seed).toBe(b.getState().seed);
    expect(a.getState().seed).not.toBe(42);
    const second = a.getState().seed;
    a.restart();
    expect(a.getState().seed).not.toBe(second);
    expect(a.getState().round).toBe(3);
  });

  it("derives the same next seed however the round went", () => {
    const idle = createGameEngine({ seed: 42 });
    const played = createGameEngine({ seed: 42 });
    played.start();
    runUntilGameOver(played, 5000, () => perfectJumps(played));
    idle.restart();
    played.restart();
    expect(played.getState()).toEqual(idle.getState());
  });

  it("plays the restarted round like a fresh engine with that seed", () => {
    const restarted = createGameEngine({ seed: 42 });
    restarted.restart();
    const fresh = createGameEngine({ seed: restarted.getState().seed });
    fresh.start();
    runSteps(restarted, 2000, () => perfectJumps(restarted, [1]));
    runSteps(fresh, 2000, () => perfectJumps(fresh, [1]));
    // Only the round counter and the seed stream differ.
    const bookkeeping = { round: 0, seedRngState: 0 };
    expect({ ...restarted.getState(), ...bookkeeping }).toEqual({
      ...fresh.getState(),
      ...bookkeeping,
    });
  });
});

describe("pause and resume", () => {
  it("freezes elapsed time and positions while paused", () => {
    const engine = createGameEngine({ seed: 3 });
    engine.start();
    runSteps(engine, 100);
    engine.jumpPlayer(1);
    runSteps(engine, 10); // mid-jump
    engine.pause();
    const frozen = cloneState(engine.getState());
    for (let i = 0; i < 50; i += 1) engine.advance(100);
    expect(engine.getState().status).toBe("paused");
    expect(engine.getState()).toEqual(frozen);
    expect(engine.getSnapshot().elapsedMs).toBe(frozen.elapsedMs);
    expect(engine.getState().players[1].y).toBeGreaterThan(0);
  });

  it("continues after resume exactly as if it had never paused", () => {
    const paused = createGameEngine({ seed: 3 });
    const straight = createGameEngine({ seed: 3 });
    paused.start();
    straight.start();
    runSteps(paused, 150, () => perfectJumps(paused, [1]));
    paused.pause();
    paused.advance(100);
    paused.advance(5000);
    paused.resume();
    runSteps(paused, 300, () => perfectJumps(paused, [1]));
    runSteps(straight, 450, () => perfectJumps(straight, [1]));
    expect(paused.getState()).toEqual(straight.getState());
  });

  it("keeps an idle round in ready until start()", () => {
    const engine = createGameEngine({ seed: 3, config: NO_OBSTACLES });
    engine.advance(100);
    expect(engine.getState().elapsedMs).toBe(0);
    engine.start();
    engine.advance(100);
    expect(engine.getState().elapsedMs).toBeGreaterThan(0);
  });
});
