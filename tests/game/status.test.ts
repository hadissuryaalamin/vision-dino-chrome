import { describe, expect, it } from "vitest";
import { createGameEngine, type GameEngine } from "../../src/game";
import type { GameStatus, PlayerId } from "../../src/shared";
import {
  NO_OBSTACLES,
  cloneState,
  collectEvents,
  perfectJumps,
  runSteps,
  runUntilGameOver,
} from "./helpers";

function engineIn(status: GameStatus): GameEngine {
  const engine = createGameEngine({ seed: 3 });
  if (status === "ready") return engine;
  engine.start();
  runSteps(engine, 10);
  if (status === "paused") engine.pause();
  if (status === "game-over") runUntilGameOver(engine);
  return engine;
}

type Command = "start" | "pause" | "resume" | "jumpPlayer(1)" | "jumpPlayer(2)" | "advance";

function run(engine: GameEngine, command: Command): void {
  switch (command) {
    case "start":
      return engine.start();
    case "pause":
      return engine.pause();
    case "resume":
      return engine.resume();
    case "jumpPlayer(1)":
      return engine.jumpPlayer(1);
    case "jumpPlayer(2)":
      return engine.jumpPlayer(2);
    case "advance":
      return engine.advance(50);
  }
}

describe("status machine", () => {
  it("starts in ready", () => {
    const engine = createGameEngine({ seed: 1 });
    expect(engine.getSnapshot().status).toBe("ready");
    expect(engine.getSnapshot().result).toBeNull();
    expect(engine.getState().round).toBe(1);
  });

  it("goes ready → running → paused → running → game-over", () => {
    const engine = createGameEngine({ seed: 1 });
    const events = collectEvents(engine);
    engine.start();
    expect(engine.getSnapshot().status).toBe("running");
    engine.pause();
    expect(engine.getSnapshot().status).toBe("paused");
    engine.resume();
    expect(engine.getSnapshot().status).toBe("running");
    runUntilGameOver(engine);
    expect(engine.getSnapshot().status).toBe("game-over");
    expect(engine.getSnapshot().result).not.toBeNull();
    const transitions = events
      .filter((e) => e.type === "status-changed")
      .map((e) => `${e.previous}→${e.status}`);
    expect(transitions).toEqual([
      "ready→running",
      "running→paused",
      "paused→running",
      "running→game-over",
    ]);
  });

  it.each<GameStatus>(["ready", "running", "paused", "game-over"])(
    "restart() from %s enters running with a fresh round",
    (status) => {
      const engine = engineIn(status);
      const events = collectEvents(engine);
      engine.restart();
      const state = engine.getState();
      expect(state.status).toBe("running");
      expect(state.round).toBe(2);
      expect(state.elapsedMs).toBe(0);
      expect(events).toEqual([
        { type: "status-changed", status: "running", previous: status, elapsedMs: 0 },
      ]);
    },
  );

  const ignored: Record<GameStatus, Command[]> = {
    ready: ["pause", "resume", "jumpPlayer(1)", "jumpPlayer(2)", "advance"],
    running: ["start", "resume"],
    paused: ["start", "pause", "jumpPlayer(1)", "jumpPlayer(2)", "advance"],
    "game-over": ["start", "pause", "resume", "jumpPlayer(1)", "jumpPlayer(2)", "advance"],
  };

  for (const [status, commands] of Object.entries(ignored) as [GameStatus, Command[]][]) {
    it.each(commands)(`ignores %s in ${status}`, (command) => {
      const engine = engineIn(status);
      const before = cloneState(engine.getState());
      const snapshot = engine.getSnapshot();
      const events = collectEvents(engine);
      expect(() => run(engine, command)).not.toThrow();
      expect(engine.getState()).toEqual(before);
      expect(engine.getSnapshot()).toBe(snapshot);
      expect(events).toEqual([]);
    });
  }

  it("does not apply a jump requested while paused after resuming", () => {
    const engine = engineIn("paused");
    engine.jumpPlayer(1);
    engine.resume();
    runSteps(engine, 3);
    expect(engine.getState().players[1].jumps).toBe(0);
  });

  it("ignores jumps from a crashed player while the other keeps running", () => {
    const engine = createGameEngine({ seed: 11 });
    engine.start();
    runUntilGameOver(engine, 20_000, () => {
      perfectJumps(engine, [1]);
      if (engine.getState().players[2].crashed) {
        const before = cloneState(engine.getState());
        engine.jumpPlayer(2);
        expect(engine.getState()).toEqual(before);
      }
    });
    expect(engine.getState().players[2].crashed).toBe(true);
    expect(engine.getState().players[2].jumps).toBe(0);
  });

  it("never throws for invalid player ids", () => {
    const engine = createGameEngine({ seed: 1, config: NO_OBSTACLES });
    engine.start();
    const before = cloneState(engine.getState());
    for (const id of [0, 3, -1, 1.5, Number.NaN]) {
      expect(() => engine.jumpPlayer(id as PlayerId)).not.toThrow();
    }
    expect(engine.getState()).toEqual(before);
  });
});
