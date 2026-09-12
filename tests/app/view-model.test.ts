import { describe, expect, it } from "vitest";
import { createInitialAppState, transition } from "../../src/app/state";
import type { AppEvent, AppState } from "../../src/app/state";
import { toViewModel } from "../../src/app/view-model";
import { DEFAULT_PLAYER_GESTURES } from "../../src/shared";

function apply(state: AppState, ...events: AppEvent[]): AppState {
  return events.reduce((current, event) => transition(current, event).state, state);
}

const base = createInitialAppState({ cameraSupported: true, gameStatus: "ready" });
const view = (state: AppState) => toViewModel(state, DEFAULT_PLAYER_GESTURES);
const faces = (count: number): AppEvent => ({
  type: "vision-event",
  event: { type: "faces-changed", count, timestamp: 0 },
});

describe("toViewModel", () => {
  it("shows the welcome screen with camera support and no camera panel", () => {
    const model = view(base);
    expect(model.screen).toEqual({ id: "welcome", cameraSupported: true });
    expect(model.camera).toBeNull();
    expect(model.hud.visible).toBe(false);
  });

  it("describes keyboard control on the ready screen and offers the camera", () => {
    const model = view(apply(base, { type: "choose-keyboard" }));
    expect(model.screen).toEqual({
      id: "ready",
      controls: { 1: "keyboard", 2: "keyboard" },
      canUseCamera: true,
    });
    expect(model.hud.visible).toBe(true);
    expect(model.hud.players[1]).toEqual({
      playerId: 1,
      control: "keyboard",
      gesture: "blink",
      tracking: null,
      gestureCount: 0,
    });
  });

  it("does not offer the camera when unsupported", () => {
    const unsupported = createInitialAppState({ cameraSupported: false, gameStatus: "ready" });
    const model = view(apply(unsupported, { type: "choose-keyboard" }));
    expect(model.screen).toMatchObject({ id: "ready", canUseCamera: false });
  });

  it("shows the camera panel from the start of camera mode", () => {
    const starting = view(apply(base, { type: "choose-camera" }));
    expect(starting.screen).toEqual({ id: "camera-starting", phase: "requesting-camera" });
    expect(starting.camera).toMatchObject({ starting: true, canAdjustAssignment: false });

    const positioning = view(
      apply(
        base,
        { type: "choose-camera" },
        {
          type: "vision-start-result",
          attempt: 1,
          result: { ok: true },
        },
        faces(2),
      ),
    );
    expect(positioning.screen).toEqual({ id: "positioning", facesDetected: 2 });
    expect(positioning.camera).toMatchObject({
      starting: false,
      facesDetected: 2,
      canAdjustAssignment: true,
    });
  });

  it("marks the keyboard player in single-player camera mode", () => {
    const state = apply(
      base,
      { type: "choose-camera" },
      { type: "vision-start-result", attempt: 1, result: { ok: true } },
      faces(1),
      { type: "continue-one-player", cameraPlayer: 2 },
    );
    const model = view(state);
    expect(model.screen).toMatchObject({
      id: "calibrating",
      players: { 1: { control: "keyboard" }, 2: { control: "camera", status: "waiting" } },
    });
    expect(model.hud.players[1].tracking).toBeNull();
    expect(model.hud.players[2]).toMatchObject({ control: "camera", tracking: "unassigned" });
  });

  it("reports the error code on the camera error screen", () => {
    const model = view(
      apply(
        base,
        { type: "choose-camera" },
        {
          type: "vision-start-result",
          attempt: 1,
          result: { ok: false, error: { code: "camera-not-found", message: "" } },
        },
      ),
    );
    expect(model.screen).toEqual({
      id: "camera-error",
      code: "camera-not-found",
      cameraSupported: true,
    });
    expect(model.camera).toBeNull();
  });

  it("offers a camera retry from a runtime error notice only once the round allows it", () => {
    const playing = apply(
      base,
      { type: "choose-camera" },
      { type: "vision-start-result", attempt: 1, result: { ok: true } },
      faces(2),
      { type: "continue-two-players" },
      {
        type: "vision-event",
        event: { type: "calibration-complete", playerId: 1, mode: "default", timestamp: 0 },
      },
      {
        type: "vision-event",
        event: { type: "calibration-complete", playerId: 2, mode: "default", timestamp: 0 },
      },
      {
        type: "game-event",
        event: { type: "status-changed", status: "running", previous: "ready", elapsedMs: 0 },
      },
      {
        type: "vision-event",
        event: { type: "error", error: { code: "camera-disconnected", message: "" }, timestamp: 0 },
      },
    );
    expect(view(playing).notice).toEqual({
      kind: "vision-error",
      code: "camera-disconnected",
      canRetry: false,
    });
    expect(view(playing).hud.canPause).toBe(true);

    const over = apply(playing, {
      type: "game-event",
      event: { type: "status-changed", status: "game-over", previous: "running", elapsedMs: 0 },
    });
    expect(view(over).notice).toEqual({
      kind: "vision-error",
      code: "camera-disconnected",
      canRetry: true,
    });
  });
});
