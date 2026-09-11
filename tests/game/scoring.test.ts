import { describe, expect, it } from "vitest";
import { createGameEngine, type GameConfig, type GameEngine } from "../../src/game";
import { buildResult } from "../../src/game/engine/step";
import type { GameEvent, PlayerId } from "../../src/shared";
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

/** The ICR 1 rule, written independently of the implementation. */
function expectedWinner(
  scores: { 1: number; 2: number },
  crashedAt: { 1: number | null; 2: number | null },
): PlayerId | null {
  if (scores[1] !== scores[2]) return scores[1] > scores[2] ? 1 : 2;
  const t1 = crashedAt[1] ?? Infinity;
  const t2 = crashedAt[2] ?? Infinity;
  return t1 === t2 ? null : t1 > t2 ? 1 : 2;
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

describe("buildResult (ICR 1)", () => {
  it("gives the win to the higher score", () => {
    expect(
      buildResult({ 1: { score: 10, crashedAtMs: 500 }, 2: { score: 3, crashedAtMs: 100 } }),
    ).toEqual({ winner: 1, scores: { 1: 10, 2: 3 } });
    expect(
      buildResult({ 1: { score: 3, crashedAtMs: 100 }, 2: { score: 10, crashedAtMs: 500 } }),
    ).toEqual({ winner: 2, scores: { 1: 3, 2: 10 } });
    // The score decides even if the crash order says otherwise.
    expect(
      buildResult({ 1: { score: 10, crashedAtMs: 100 }, 2: { score: 9, crashedAtMs: null } })
        .winner,
    ).toBe(1);
  });

  it("gives the win to the later crasher on equal scores", () => {
    expect(
      buildResult({ 1: { score: 7, crashedAtMs: 1000 }, 2: { score: 7, crashedAtMs: 1050 } }),
    ).toEqual({ winner: 2, scores: { 1: 7, 2: 7 } });
    expect(
      buildResult({ 1: { score: 7, crashedAtMs: 1050 }, 2: { score: 7, crashedAtMs: 1000 } })
        .winner,
    ).toBe(1);
  });

  it("gives the win to the survivor on equal scores", () => {
    expect(
      buildResult({ 1: { score: 7, crashedAtMs: null }, 2: { score: 7, crashedAtMs: 1000 } })
        .winner,
    ).toBe(1);
    expect(
      buildResult({ 1: { score: 7, crashedAtMs: 1000 }, 2: { score: 7, crashedAtMs: null } })
        .winner,
    ).toBe(2);
  });

  it("is a tie only for a same-step crash with equal scores", () => {
    expect(
      buildResult({ 1: { score: 7, crashedAtMs: 1000 }, 2: { score: 7, crashedAtMs: 1000 } }),
    ).toEqual({ winner: null, scores: { 1: 7, 2: 7 } });
  });

  it("returns frozen results", () => {
    const result = buildResult({
      1: { score: 0, crashedAtMs: 0 },
      2: { score: 0, crashedAtMs: 0 },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.scores)).toBe(true);
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

  it('"first-crash" ends the round at the first crash; the survivor wins', () => {
    const { engine, events } = survivorRound({ roundEnd: "first-crash" });
    const crashes = events.filter((e) => e.type === "player-crashed");
    expect(crashes.map((e) => e.playerId)).toEqual([2]);
    const snapshot = engine.getSnapshot();
    expect(snapshot.status).toBe("game-over");
    expect(snapshot.players[1].crashed).toBe(false);
    const { scores, winner } = snapshot.result!;
    expect(scores).toEqual({ 1: snapshot.players[1].score, 2: snapshot.players[2].score });
    // Both travelled the same distance, so the scores are (nearly always) equal here.
    expect(scores[1]).toBeGreaterThanOrEqual(scores[2]);
    expect(winner).toBe(1);
  });

  it('"first-crash" with both players crashing on the same step is a tie', () => {
    const engine = createGameEngine({ seed: 5, config: { roundEnd: "first-crash" } });
    const events = collectEvents(engine);
    engine.start();
    runUntilGameOver(engine);
    expect(events.filter((e) => e.type === "player-crashed")).toHaveLength(2);
    expect(engine.getSnapshot().result?.winner).toBeNull();
  });

  it("is a tie (winner null) when both crash on the same step", () => {
    const engine = createGameEngine({ seed: 5 });
    engine.start();
    runUntilGameOver(engine);
    const state = engine.getState();
    expect(state.players[1].crash?.elapsedMs).toBe(state.players[2].crash?.elapsedMs);
    expect(state.result?.winner).toBeNull();
    expect(state.result?.scores[1]).toBe(state.result?.scores[2]);
  });

  it("follows the rule in engine rounds, including equal scores with a later crash", () => {
    // Both players idle crash into the first obstacle on step `crashStep`. Player 1 now
    // takes off `k` steps earlier: too late (same-step crash), in time (clears it and
    // crashes much later), or slightly too early (lands on it a few steps after Player 2,
    // usually with an equal score).
    const reference = createGameEngine({ seed: 5 });
    reference.start();
    const crashStep = runUntilGameOver(reference);

    const outcomes = Array.from({ length: 70 }, (_, index) => {
      const k = index + 1;
      const engine = createGameEngine({ seed: 5 });
      engine.start();
      let step = 0;
      runUntilGameOver(engine, 100_000, () => {
        step += 1;
        if (step === crashStep - k) engine.jumpPlayer(1);
      });
      const state = engine.getState();
      const scores = { 1: state.players[1].score, 2: state.players[2].score };
      const crashedAt = {
        1: state.players[1].crash?.elapsedMs ?? null,
        2: state.players[2].crash?.elapsedMs ?? null,
      };
      expect(state.status).toBe("game-over");
      expect(state.result?.winner, `k = ${k}`).toBe(expectedWinner(scores, crashedAt));
      return { scores, crashedAt, winner: state.result?.winner };
    });

    const sameStep = outcomes.filter((o) => o.crashedAt[1] === o.crashedAt[2]);
    const laterEqual = outcomes.filter(
      (o) => o.scores[1] === o.scores[2] && (o.crashedAt[1] ?? 0) > (o.crashedAt[2] ?? 0),
    );
    const higher = outcomes.filter((o) => o.scores[1] > o.scores[2]);
    expect(sameStep.length).toBeGreaterThan(0);
    expect(sameStep.every((o) => o.winner === null)).toBe(true);
    expect(laterEqual.length).toBeGreaterThan(0);
    expect(laterEqual.every((o) => o.winner === 1)).toBe(true);
    expect(higher.length).toBeGreaterThan(0);
    expect(higher.every((o) => o.winner === 1)).toBe(true);
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
