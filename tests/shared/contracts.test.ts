import { describe, expect, expectTypeOf, it } from "vitest";
import {
  DEFAULT_PLAYER_GESTURES,
  PLAYER_IDS,
  assertNever,
  isPlayerId,
  otherPlayer,
  type GameController,
  type GameEvent,
  type PlayerAction,
  type PlayerId,
  type PlayerInputSource,
  type Unsubscribe,
  type VisionEvent,
  type VisionSession,
  type VisionStartResult,
} from "../../src/shared";

describe("player identity", () => {
  it("lists exactly two players in order", () => {
    expect(PLAYER_IDS).toEqual([1, 2]);
  });

  it("accepts only 1 and 2 as player ids", () => {
    expect(isPlayerId(1)).toBe(true);
    expect(isPlayerId(2)).toBe(true);
    for (const value of [0, 3, 1.5, "1", null, undefined]) {
      expect(isPlayerId(value)).toBe(false);
    }
  });

  it("returns the other player", () => {
    expect(otherPlayer(1)).toBe(2);
    expect(otherPlayer(2)).toBe(1);
  });
});

describe("gesture mapping", () => {
  it("maps Player 1 to blinking and Player 2 to mouth opening", () => {
    expect(DEFAULT_PLAYER_GESTURES).toEqual({ 1: "blink", 2: "mouth-open" });
  });
});

describe("assertNever", () => {
  it("throws when reached at runtime", () => {
    expect(() => assertNever("unexpected" as never)).toThrow(/unexpected/);
  });
});

// The type assertions below are verified by `npm run typecheck`. They fail when a contract
// changes without the matching orchestrator-approved update to this file.
describe("contract shapes", () => {
  it("keeps one game-facing action type for keyboard, vision and fakes", () => {
    expectTypeOf<PlayerAction["type"]>().toEqualTypeOf<"jump">();
    expectTypeOf<PlayerAction["playerId"]>().toEqualTypeOf<PlayerId>();
    expectTypeOf<PlayerAction["source"]>().toEqualTypeOf<"keyboard" | "vision" | "simulated">();
    expectTypeOf<PlayerInputSource["subscribe"]>().returns.toEqualTypeOf<Unsubscribe>();
  });

  it("exposes jumpPlayer(playerId) on the game controller", () => {
    expectTypeOf<GameController["jumpPlayer"]>().parameters.toEqualTypeOf<[PlayerId]>();
    expectTypeOf<GameEvent["type"]>().toEqualTypeOf<
      "status-changed" | "player-jumped" | "player-crashed" | "game-over"
    >();
  });

  it("keeps the vision event vocabulary the integration layer relies on", () => {
    expectTypeOf<VisionEvent["type"]>().toEqualTypeOf<
      | "status-changed"
      | "error"
      | "faces-changed"
      | "players-assigned"
      | "face-lost"
      | "face-found"
      | "gesture"
      | "calibration-progress"
      | "calibration-complete"
      | "calibration-failed"
    >();
    expectTypeOf<ReturnType<VisionSession["start"]>>().toEqualTypeOf<Promise<VisionStartResult>>();
  });
});
