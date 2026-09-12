import { describe, expect, it } from "vitest";
import { connectInputs } from "../../src/app/input-router";
import { FakeGameController } from "../support/fake-game";
import { FakeInputSource } from "../support/fake-input";

function startedSource(): FakeInputSource {
  const source = new FakeInputSource();
  source.start();
  return source;
}

describe("connectInputs", () => {
  it("forwards each jump action to jumpPlayer exactly once", () => {
    const game = new FakeGameController();
    const source = startedSource();
    connectInputs([source], game);

    source.jump(1);
    source.jump(2);
    source.jump(1);

    expect(game.jumps).toEqual([1, 2, 1]);
  });

  it("routes keyboard, vision and simulated sources through the same path at the same time", () => {
    const game = new FakeGameController();
    const keyboard = startedSource();
    const vision = startedSource();
    const simulated = startedSource();
    connectInputs([keyboard, vision, simulated], game);

    keyboard.jump(1, "keyboard");
    vision.jump(2, "vision");
    simulated.jump(1, "simulated");

    expect(game.jumps).toEqual([1, 2, 1]);
  });

  it("does not start or stop the sources", () => {
    const source = new FakeInputSource();
    const disconnect = connectInputs([source], new FakeGameController());
    disconnect();
    expect(source.startCalls).toBe(0);
    expect(source.stopCalls).toBe(0);
  });

  it("unsubscribes from every source, idempotently", () => {
    const game = new FakeGameController();
    const first = startedSource();
    const second = startedSource();
    const disconnect = connectInputs([first, second], game);
    expect(first.listenerCount + second.listenerCount).toBe(2);

    disconnect();
    disconnect();
    first.jump(1);
    second.jump(2);

    expect(first.listenerCount + second.listenerCount).toBe(0);
    expect(game.jumps).toEqual([]);
  });

  it("forwards nothing after disconnect even if a source keeps a stale listener", () => {
    const game = new FakeGameController();
    const stale: { listener?: Parameters<FakeInputSource["subscribe"]>[0] } = {};
    const leaky = {
      start: () => undefined,
      stop: () => undefined,
      subscribe: (listener: Parameters<FakeInputSource["subscribe"]>[0]) => {
        stale.listener = listener;
        return () => undefined; // a broken source that ignores unsubscribe
      },
    };
    const disconnect = connectInputs([leaky], game);
    disconnect();
    stale.listener?.({ type: "jump", playerId: 1, source: "keyboard", timestamp: 0 });
    expect(game.jumps).toEqual([]);
  });

  it("accepts an empty source list", () => {
    const disconnect = connectInputs([], new FakeGameController());
    expect(() => disconnect()).not.toThrow();
  });
});
