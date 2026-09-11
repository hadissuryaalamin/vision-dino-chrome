import { beforeEach, describe, expect, it } from "vitest";
import { connectInputs } from "../../src/app/input-router";
import { createVisionInputSource } from "../../src/app/vision-input";
import type { PlayerAction } from "../../src/shared";
import { FakeGameController } from "../support/fake-game";
import { FakeVisionSession } from "../support/fake-vision";

describe("createVisionInputSource", () => {
  let session: FakeVisionSession;
  let actions: PlayerAction[];

  beforeEach(async () => {
    session = new FakeVisionSession();
    await session.start();
    actions = [];
  });

  function started(gestures?: Parameters<typeof createVisionInputSource>[1]) {
    const source = createVisionInputSource(session, gestures);
    source.subscribe((action) => actions.push(action));
    void source.start();
    return source;
  }

  it("maps each player's configured gesture to one vision jump with the frame timestamp", () => {
    started();
    session.gesture(1, "blink", 1234.5);
    session.gesture(2, "mouth-open", 1300);

    expect(actions).toEqual([
      { type: "jump", playerId: 1, source: "vision", timestamp: 1234.5 },
      { type: "jump", playerId: 2, source: "vision", timestamp: 1300 },
    ]);
  });

  it("ignores the wrong gesture for a player", () => {
    started();
    session.gesture(1, "mouth-open");
    session.gesture(2, "blink");
    expect(actions).toEqual([]);
  });

  it("honours a custom gesture mapping", () => {
    started({ 1: "mouth-open", 2: "blink" });
    session.gesture(1, "mouth-open");
    session.gesture(2, "mouth-open");
    expect(actions.map((action) => action.playerId)).toEqual([1]);
  });

  it("turns no other vision event into an action", () => {
    started();
    session.facesChanged(2);
    session.assignPlayers();
    session.faceLost(1);
    session.faceFound(1);
    session.progressCalibration(1, "gesture", 0.5);
    session.completeCalibration(1);
    session.failCalibration(2, "timeout");
    session.fail("camera-disconnected");
    expect(actions).toEqual([]);
  });

  it("does not subscribe to the session, or open the camera, before start()", () => {
    const fresh = new FakeVisionSession();
    const source = createVisionInputSource(fresh);
    source.subscribe((action) => actions.push(action));
    expect(fresh.listenerCount).toBe(0);
    void source.start();
    expect(fresh.listenerCount).toBe(1);
    expect(fresh.startCalls).toBe(0);
  });

  it("has idempotent start and stop, and can restart", () => {
    const source = started();
    void source.start();
    expect(session.listenerCount).toBe(1);

    void source.stop();
    void source.stop();
    expect(session.listenerCount).toBe(0);
    session.gesture(1);
    expect(actions).toEqual([]);

    void source.start();
    session.gesture(1);
    expect(actions).toHaveLength(1);
    expect(session.stopCalls).toBe(0);
  });

  it("stops delivering to a listener after unsubscribe, idempotently", () => {
    const source = createVisionInputSource(session);
    const seen: number[] = [];
    const unsubscribe = source.subscribe((action) => seen.push(action.playerId));
    source.subscribe((action) => actions.push(action));
    void source.start();

    session.gesture(1);
    unsubscribe();
    unsubscribe();
    session.gesture(2);

    expect(seen).toEqual([1]);
    expect(actions.map((action) => action.playerId)).toEqual([1, 2]);
  });

  it("calls listeners in subscription order", () => {
    const source = createVisionInputSource(session);
    const order: string[] = [];
    source.subscribe(() => order.push("a"));
    source.subscribe(() => order.push("b"));
    void source.start();
    session.gesture(1);
    expect(order).toEqual(["a", "b"]);
  });

  it("turns one held gesture (one event) into exactly one jumpPlayer call", () => {
    const game = new FakeGameController({ status: "running" });
    const source = createVisionInputSource(session);
    connectInputs([source], game);
    void source.start();

    // The vision contract emits once per activation; holding the gesture emits nothing more.
    session.gesture(2, "mouth-open", 100);

    expect(game.jumps).toEqual([2]);
  });
});
