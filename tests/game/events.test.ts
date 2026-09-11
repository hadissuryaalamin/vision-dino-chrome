import { describe, expect, it, vi } from "vitest";
import { createGameEngine } from "../../src/game";
import type { GameEvent, GameSnapshot } from "../../src/shared";
import { NO_OBSTACLES, collectEvents, perfectJumps, runSteps, runUntilGameOver } from "./helpers";

describe("game events", () => {
  it("emits every event exactly once, in a sensible order", () => {
    const engine = createGameEngine({ seed: 13 });
    const events = collectEvents(engine);
    engine.start();
    runUntilGameOver(engine, 100_000, () => {
      if (engine.getState().elapsedMs < 6000) perfectJumps(engine, [1]);
    });
    runSteps(engine, 100); // nothing after game over
    engine.pause();
    engine.resume();

    const state = engine.getState();
    const types = events.map((e) => e.type);
    const jumped = events.filter((e) => e.type === "player-jumped");
    const crashed = events.filter((e) => e.type === "player-crashed");
    expect(jumped).toHaveLength(state.players[1].jumps + state.players[2].jumps);
    expect(jumped.length).toBeGreaterThan(0);
    expect(crashed.map((e) => e.playerId).sort()).toEqual([1, 2]);
    expect(types.filter((t) => t === "game-over")).toHaveLength(1);
    expect(types.filter((t) => t === "status-changed")).toHaveLength(2);

    const lastCrash = types.lastIndexOf("player-crashed");
    const statusOver = events.findIndex(
      (e) => e.type === "status-changed" && e.status === "game-over",
    );
    const gameOver = types.indexOf("game-over");
    expect(lastCrash).toBeLessThan(statusOver);
    expect(statusOver).toBeLessThan(gameOver);
    expect(gameOver).toBe(events.length - 1);

    const over = events[gameOver] as Extract<GameEvent, { type: "game-over" }>;
    expect(over.result).toBe(engine.getSnapshot().result);
    expect(over.elapsedMs).toBe(state.elapsedMs);
  });

  it("emits player-jumped on the step the dinosaur takes off, with that step's time", () => {
    const engine = createGameEngine({ seed: 1, config: NO_OBSTACLES });
    const events = collectEvents(engine);
    engine.start();
    runSteps(engine, 10);
    engine.jumpPlayer(2);
    expect(events.filter((e) => e.type === "player-jumped")).toHaveLength(0);
    runSteps(engine, 1);
    expect(events.at(-1)).toEqual({
      type: "player-jumped",
      playerId: 2,
      elapsedMs: engine.getState().elapsedMs,
    });
  });

  it("calls listeners synchronously, in subscription order, after the change", () => {
    const engine = createGameEngine({ seed: 1 });
    const calls: string[] = [];
    let seen: GameSnapshot | null = null;
    engine.subscribe(() => {
      calls.push("a");
      seen = engine.getSnapshot();
    });
    engine.subscribe(() => calls.push("b"));
    engine.start();
    expect(calls).toEqual(["a", "b"]);
    expect(seen).not.toBeNull();
    expect(seen!.status).toBe("running");
  });

  it("stops delivery after unsubscribe; unsubscribe is idempotent", () => {
    const engine = createGameEngine({ seed: 1 });
    const listener = vi.fn();
    const other = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    engine.subscribe(other);
    engine.start();
    unsubscribe();
    unsubscribe();
    engine.pause();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);
  });

  it("does not call a listener removed by an earlier listener in the same emit", () => {
    const engine = createGameEngine({ seed: 1 });
    const late = vi.fn();
    let unsubscribeLate = (): void => undefined;
    engine.subscribe(() => unsubscribeLate());
    unsubscribeLate = engine.subscribe(late);
    engine.start();
    expect(late).not.toHaveBeenCalled();
  });

  it("isolates a throwing listener", () => {
    const onListenerError = vi.fn();
    const engine = createGameEngine({ seed: 1, onListenerError });
    const error = new Error("listener bug");
    const after = vi.fn();
    engine.subscribe(() => {
      throw error;
    });
    engine.subscribe(after);
    expect(() => engine.start()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(onListenerError).toHaveBeenCalledWith(error);
    expect(engine.getSnapshot().status).toBe("running");
  });

  it("handles a restart requested by a listener in the middle of advance()", () => {
    const engine = createGameEngine({ seed: 2 });
    engine.start();
    let restarted = false;
    engine.subscribe((event) => {
      if (event.type === "player-crashed" && !restarted) {
        restarted = true;
        engine.restart();
      }
    });
    runSteps(engine, 2000);
    expect(restarted).toBe(true);
    expect(engine.getState().round).toBe(2);
  });
});

describe("snapshots", () => {
  it("returns the same frozen object until the state changes", () => {
    const engine = createGameEngine({ seed: 1, config: NO_OBSTACLES });
    const ready = engine.getSnapshot();
    expect(engine.getSnapshot()).toBe(ready);
    expect(Object.isFrozen(ready)).toBe(true);
    expect(Object.isFrozen(ready.players)).toBe(true);
    expect(Object.isFrozen(ready.players[1])).toBe(true);

    engine.start();
    const running = engine.getSnapshot();
    expect(running).not.toBe(ready);
    expect(ready.status).toBe("ready"); // old snapshots are never mutated

    runSteps(engine, 5);
    const later = engine.getSnapshot();
    expect(later).not.toBe(running);
    expect(later.elapsedMs).toBeGreaterThan(0);

    engine.pause();
    const paused = engine.getSnapshot();
    engine.advance(100);
    engine.jumpPlayer(1);
    expect(engine.getSnapshot()).toBe(paused);
  });
});
