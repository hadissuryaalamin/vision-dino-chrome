import { describe, expect, it } from "vitest";
import { createGameEngine, type GameConfig, type GameEngine } from "../../src/game";
import { buildResult } from "../../src/game/engine/step";
import type { GameEvent } from "../../src/shared";
import { NO_OBSTACLES, collectEvents, perfectJumps, runSteps, runUntilGameOver } from "./helpers";

/** Player 1 plays perfectly until `p1StopsAfterMs`; Player 2 never jumps. */
function survivorRound(config: Partial<GameConfig>, p1StopsAfterMs = 20_000) {
  const engine = createGameEngine({ seed: 17, config });
  const events = collectEvents(engine);
  engine.start();
  let p2ScoreAtCrash: number | null = null;
  const p2Scores: number[] = [];
  runUntilGameOver(engine, 100_000, () => {
    if (engine.getState().elapsedMs < p1StopsAfterMs) perfectJumps(engine, [1]);
    const p2 = engine.getSnapshot().players[2];
    if (p2.crashed) {
      p2ScoreAtCrash ??= p2.score;
      p2Scores.push(p2.score);
    }
  });
  return { engine, events, p2ScoreAtCrash, p2Scores };
}

describe("scoring", () => {
  it("grows with distance while alive: floor(distance × scorePerUnit)", () => {
    const engine = createGameEngine({ seed: 1, config: NO_OBSTACLES });
    engine.start();
    let previous = 0;
    for (let i = 0; i < 50; i += 1) {
      runSteps(engine, 20);
      const state = engine.getState();
      const expected = Math.floor(state.distance * engine.config.scorePerUnit);
      expect(state.players[1].score).toBe(expected);
      expect(state.players[2].score).toBe(expected);
      expect(expected).toBeGreaterThanOrEqual(previous);
      expect(Number.isInteger(expected)).toBe(true);
      previous = expected;
    }
    expect(previous).toBeGreaterThan(0);
  });

  it("freezes a crashed player's score while the other keeps scoring", () => {
    const { engine, events, p2ScoreAtCrash, p2Scores } = survivorRound({}, 8_000);
    const crashEvent = events.find(
      (e): e is Extract<GameEvent, { type: "player-crashed" }> =>
        e.type === "player-crashed" && e.playerId === 2,
    );
    expect(crashEvent?.score).toBe(p2ScoreAtCrash);
    expect(new Set(p2Scores)).toEqual(new Set([p2ScoreAtCrash]));
    expect(engine.getSnapshot().players[1].score).toBeGreaterThan(p2ScoreAtCrash ?? Infinity);
  });
});

describe("round end and results", () => {
  it('"all-crashed" (default) keeps running after the first crash; the survivor wins', () => {
    const { engine, events } = survivorRound({}, 8_000);
    const crashes = events.filter((e) => e.type === "player-crashed");
    expect(crashes.map((e) => e.playerId)).toEqual([2, 1]);
    // The first crash did not end the round: time passed between the two crashes.
    expect(crashes[1]!.elapsedMs).toBeGreaterThan(crashes[0]!.elapsedMs + 1000);
    const snapshot = engine.getSnapshot();
    expect(snapshot.status).toBe("game-over");
    expect(snapshot.result?.winner).toBe(1);
    expect(snapshot.result?.scores).toEqual({
      1: snapshot.players[1].score,
      2: snapshot.players[2].score,
    });
  });

  it('"first-crash" ends the round at the first crash', () => {
    const { engine, events } = survivorRound({ roundEnd: "first-crash" });
    const crashes = events.filter((e) => e.type === "player-crashed");
    expect(crashes.map((e) => e.playerId)).toEqual([2]);
    const snapshot = engine.getSnapshot();
    expect(snapshot.status).toBe("game-over");
    expect(snapshot.players[1].crashed).toBe(false);
    const { scores, winner } = snapshot.result!;
    expect(scores).toEqual({ 1: snapshot.players[1].score, 2: snapshot.players[2].score });
    expect(winner).toBe(scores[1] > scores[2] ? 1 : scores[2] > scores[1] ? 2 : null);
  });

  it("is a tie (winner null) when both crash on the same step", () => {
    const engine = createGameEngine({ seed: 5 });
    engine.start();
    runUntilGameOver(engine);
    const result = engine.getSnapshot().result;
    expect(result?.winner).toBeNull();
    expect(result?.scores[1]).toBe(result?.scores[2]);
  });

  it("builds results: higher score wins, equal scores tie", () => {
    expect(buildResult({ 1: 10, 2: 3 })).toEqual({ winner: 1, scores: { 1: 10, 2: 3 } });
    expect(buildResult({ 1: 3, 2: 10 })).toEqual({ winner: 2, scores: { 1: 3, 2: 10 } });
    expect(buildResult({ 1: 7, 2: 7 })).toEqual({ winner: null, scores: { 1: 7, 2: 7 } });
    expect(Object.isFrozen(buildResult({ 1: 0, 2: 0 }))).toBe(true);
  });

  it("stops the world at game over", () => {
    const engine: GameEngine = createGameEngine({ seed: 5 });
    engine.start();
    runUntilGameOver(engine);
    const distance = engine.getState().distance;
    engine.advance(100);
    expect(engine.getState().distance).toBe(distance);
  });
});
