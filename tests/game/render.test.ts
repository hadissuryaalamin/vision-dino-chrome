import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANE_LABELS,
  createGameEngine,
  renderGame,
  type GameEngine,
  type GameState,
} from "../../src/game";
import {
  cloneState,
  createRecordingContext,
  deepFreeze,
  perfectJumps,
  runSteps,
  runUntilGameOver,
} from "./helpers";

const VIEWPORT = { width: 900, height: 560, pixelRatio: 2 };

function engineWith(setup: (engine: GameEngine) => void): GameEngine {
  const engine = createGameEngine({ seed: 19 });
  setup(engine);
  return engine;
}

const scenarios: Record<string, () => GameEngine> = {
  ready: () => engineWith(() => undefined),
  running: () =>
    engineWith((engine) => {
      engine.start();
      runSteps(engine, 400, () => perfectJumps(engine));
      engine.jumpPlayer(1);
      runSteps(engine, 2); // jump cue visible, obstacles on screen
    }),
  paused: () =>
    engineWith((engine) => {
      engine.start();
      runSteps(engine, 100);
      engine.pause();
    }),
  "one crashed": () =>
    engineWith((engine) => {
      engine.start();
      runUntilGameOver(engine, 100_000, () => {
        perfectJumps(engine, [1]);
        if (engine.getState().players[2].crashed) engine.pause();
      });
    }),
  "game over with a winner": () =>
    engineWith((engine) => {
      engine.start();
      runUntilGameOver(engine, 100_000, () => {
        if (engine.getState().elapsedMs < 5000) perfectJumps(engine, [1]);
      });
    }),
  "game over tie": () =>
    engineWith((engine) => {
      engine.start();
      runUntilGameOver(engine);
    }),
};

function render(state: Readonly<GameState>, engine: GameEngine, options = {}) {
  const recording = createRecordingContext();
  renderGame(recording.ctx, state, engine.config, VIEWPORT, options);
  return recording;
}

describe("renderer", () => {
  it.each(Object.keys(scenarios))("renders %s without throwing or mutating state", (name) => {
    const engine = scenarios[name]!();
    const frozen = deepFreeze(cloneState(engine.getState()));
    expect(() => render(frozen, engine)).not.toThrow();

    const before = cloneState(engine.getState());
    const { texts, calls } = render(engine.getState(), engine);
    expect(engine.getState()).toEqual(before);

    expect(texts).toContain(DEFAULT_LANE_LABELS[1]);
    expect(texts).toContain(DEFAULT_LANE_LABELS[2]);
    const saves = calls.filter((c) => c.name === "save").length;
    expect(calls.filter((c) => c.name === "restore")).toHaveLength(saves);
  });

  it("shows the status and result as text", () => {
    const text = (name: string): string[] => {
      const engine = scenarios[name]!();
      return render(engine.getState(), engine).texts;
    };
    expect(text("ready")).toContain("READY");
    expect(text("paused")).toContain("PAUSED");
    expect(text("running")).not.toContain("PAUSED");
    expect(text("game over tie")).toEqual(expect.arrayContaining(["GAME OVER", "Tie"]));
    expect(text("game over with a winner")).toEqual(
      expect.arrayContaining(["GAME OVER", "Player 1 wins"]),
    );
    expect(text("one crashed")).toContain("P2 CRASHED");
    expect(text("one crashed")).not.toContain("P1 CRASHED");
  });

  it("draws scores for both players", () => {
    const engine = scenarios.running!();
    const { texts } = render(engine.getState(), engine);
    const score = String(engine.getState().players[1].score).padStart(5, "0");
    expect(texts).toContain(`P1 ${score}`);
    expect(texts.some((t) => t.startsWith("P2 "))).toBe(true);
  });

  it("can hide the status overlay and relabel lanes", () => {
    const engine = scenarios.paused!();
    const { texts } = render(engine.getState(), engine, {
      showStatusOverlay: false,
      laneLabels: { 1: "Left", 2: "Right" },
    });
    expect(texts).not.toContain("PAUSED");
    expect(texts).toEqual(expect.arrayContaining(["Left", "Right"]));
  });

  it("scales to the device pixel ratio", () => {
    const engine = scenarios.ready!();
    const { calls } = render(engine.getState(), engine);
    expect(calls[0]).toEqual({ name: "setTransform", args: [2, 0, 0, 2, 0, 0] });
  });

  it("survives a zero-size or invalid viewport", () => {
    const engine = scenarios.running!();
    const { ctx } = createRecordingContext();
    for (const viewport of [
      { width: 0, height: 0, pixelRatio: 1 },
      { width: 100, height: 100, pixelRatio: 0 },
      { width: Number.NaN, height: 10, pixelRatio: 1 },
    ]) {
      expect(() => renderGame(ctx, engine.getState(), engine.config, viewport)).not.toThrow();
    }
  });
});
