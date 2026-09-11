import { describe, expect, it } from "vitest";
import { createInitialAppState, transition } from "../../src/app/state";
import type { AppEffect, AppEvent, AppState } from "../../src/app/state";
import type { GameStatus, VisionErrorCode, VisionEvent } from "../../src/shared";

function initial(overrides: { cameraSupported?: boolean; gameStatus?: GameStatus } = {}): AppState {
  return createInitialAppState({
    cameraSupported: overrides.cameraSupported ?? true,
    gameStatus: overrides.gameStatus ?? "ready",
  });
}

/** Apply events in order; return the final state and every effect produced. */
function run(state: AppState, ...events: AppEvent[]): { state: AppState; effects: AppEffect[] } {
  const effects: AppEffect[] = [];
  let current = state;
  for (const event of events) {
    const next = transition(current, event);
    current = next.state;
    effects.push(...next.effects);
  }
  return { state: current, effects };
}

const types = (effects: readonly AppEffect[]) =>
  effects.filter((effect) => effect.type !== "announce").map((effect) => effect.type);

const announcements = (effects: readonly AppEffect[]) =>
  effects.flatMap((effect) => (effect.type === "announce" ? [effect.announcement] : []));

const vision = (event: VisionEvent): AppEvent => ({ type: "vision-event", event });
const gameStatus = (status: GameStatus, previous: GameStatus): AppEvent => ({
  type: "game-event",
  event: { type: "status-changed", status, previous, elapsedMs: 0 },
});
const startResult = (attempt: number, code?: VisionErrorCode): AppEvent => ({
  type: "vision-start-result",
  attempt,
  result: code ? { ok: false, error: { code, message: code } } : { ok: true },
});
const faces = (count: number): AppEvent => vision({ type: "faces-changed", count, timestamp: 0 });

/** From welcome to the positioning screen through a successful camera start. */
function positioning(): AppState {
  return run(initial(), { type: "choose-camera" }, startResult(1)).state;
}

/** Two faces, calibration started for both players. */
function calibrating(): AppState {
  return run(positioning(), faces(2), { type: "continue-two-players" }).state;
}

function completeBoth(state: AppState): AppState {
  return run(
    state,
    vision({ type: "calibration-complete", playerId: 1, mode: "calibrated", timestamp: 0 }),
    vision({ type: "calibration-complete", playerId: 2, mode: "calibrated", timestamp: 0 }),
  ).state;
}

describe("initial state", () => {
  it("starts on the welcome screen in keyboard mode with the debug overlay hidden", () => {
    const state = initial();
    expect(state.screen).toBe("welcome");
    expect(state.mode).toBe("keyboard");
    expect(state.debugVisible).toBe(false);
  });
});

describe("keyboard-only path", () => {
  it("goes from welcome to ready without touching the camera", () => {
    const { state, effects } = run(initial(), { type: "choose-keyboard" });
    expect(state.screen).toBe("ready");
    expect(effects).toEqual([]);
  });

  it("plays a full round: start, pause, resume, game over, restart", () => {
    let { state } = run(initial(), { type: "choose-keyboard" });

    let step = run(state, { type: "start-or-restart" });
    expect(types(step.effects)).toEqual(["game-start"]);
    state = run(step.state, gameStatus("running", "ready")).state;
    expect(state.screen).toBe("playing");

    step = run(state, { type: "toggle-pause" });
    expect(types(step.effects)).toEqual(["game-pause"]);
    state = run(step.state, gameStatus("paused", "running")).state;
    expect(state.screen).toBe("paused");

    step = run(state, { type: "start-or-restart" });
    expect(types(step.effects)).toEqual(["game-resume"]);
    state = run(step.state, gameStatus("running", "paused")).state;
    expect(state.screen).toBe("playing");

    const result = { winner: 2 as const, scores: { 1: 10, 2: 30 } };
    state = run(state, gameStatus("game-over", "running"), {
      type: "game-event",
      event: { type: "game-over", result, elapsedMs: 5000 },
    }).state;
    expect(state.screen).toBe("game-over");
    expect(state.game.result).toEqual(result);

    step = run(state, { type: "start-or-restart" });
    expect(types(step.effects)).toEqual(["game-restart"]);
    state = run(step.state, gameStatus("running", "game-over")).state;
    expect(state.screen).toBe("playing");
    expect(state.game.result).toBeNull();
  });

  it("ignores Enter while running and on setup screens", () => {
    const running = run(
      initial(),
      { type: "choose-keyboard" },
      gameStatus("running", "ready"),
    ).state;
    expect(run(running, { type: "start-or-restart" }).effects).toEqual([]);
    expect(run(initial(), { type: "start-or-restart" }).effects).toEqual([]);
    expect(run(positioning(), { type: "start-or-restart" }).effects).toEqual([]);
  });

  it("ignores pause outside a running game and resume outside a paused one", () => {
    const ready = run(initial(), { type: "choose-keyboard" }).state;
    expect(run(ready, { type: "toggle-pause" }).effects).toEqual([]);
    expect(run(ready, { type: "pause" }).effects).toEqual([]);
    expect(run(ready, { type: "resume" }).effects).toEqual([]);
  });

  it("restarts from the paused screen", () => {
    const paused = run(
      initial(),
      { type: "choose-keyboard" },
      gameStatus("running", "ready"),
      gameStatus("paused", "running"),
    ).state;
    expect(types(run(paused, { type: "restart" }).effects)).toEqual(["game-restart"]);
  });

  it("drops vision events while the camera is not in use", () => {
    const ready = run(initial(), { type: "choose-keyboard" }).state;
    const next = run(
      ready,
      faces(2),
      vision({ type: "gesture", playerId: 1, gesture: "blink", timestamp: 0 }),
    );
    expect(next.state).toBe(ready);
  });
});

describe("camera start", () => {
  it("is not offered when the camera is unsupported", () => {
    const state = initial({ cameraSupported: false });
    const next = run(state, { type: "choose-camera" });
    expect(next.state).toBe(state);
    expect(next.effects).toEqual([]);
  });

  it("moves to camera-starting and asks for exactly one start", () => {
    const { state, effects } = run(initial(), { type: "choose-camera" });
    expect(state.screen).toBe("camera-starting");
    expect(state.mode).toBe("camera");
    expect(state.cameraPhase).toBe("requesting-camera");
    expect(effects).toEqual([{ type: "start-vision", attempt: 1 }]);
  });

  it("tracks the loading phase from status events", () => {
    const { state } = run(
      initial(),
      { type: "choose-camera" },
      vision({
        type: "status-changed",
        status: "loading-model",
        previous: "requesting-camera",
        timestamp: 0,
      }),
    );
    expect(state.cameraPhase).toBe("loading-model");
  });

  it("reaches positioning when the start succeeds", () => {
    expect(positioning().screen).toBe("positioning");
  });

  it.each<VisionErrorCode>([
    "camera-unsupported",
    "camera-permission-denied",
    "camera-not-found",
    "camera-in-use",
    "camera-disconnected",
    "model-load-failed",
    "inference-failed",
    "unknown",
  ])("shows the error screen for %s, stops the session and falls back to the keyboard", (code) => {
    const { state, effects } = run(initial(), { type: "choose-camera" }, startResult(1, code));
    expect(state.screen).toBe("camera-error");
    expect(state.cameraError).toBe(code);
    expect(state.mode).toBe("keyboard");
    expect(types(effects)).toEqual(["start-vision", "stop-vision"]);
    expect(announcements(effects)).toContainEqual({ kind: "vision-error", code });
  });

  it("lets the error screen retry or switch to the keyboard", () => {
    const failed = run(initial(), { type: "choose-camera" }, startResult(1, "camera-in-use")).state;

    const retry = run(failed, { type: "choose-camera" });
    expect(retry.state.screen).toBe("camera-starting");
    expect(retry.effects).toEqual([{ type: "start-vision", attempt: 2 }]);

    const keyboard = run(failed, { type: "choose-keyboard" });
    expect(keyboard.state.screen).toBe("ready");
    expect(keyboard.state.cameraError).toBeNull();
    expect(keyboard.effects).toEqual([]); // the session was already stopped on failure
  });

  it("ignores the error event during start-up; the start result reports it", () => {
    const { state, effects } = run(
      initial(),
      { type: "choose-camera" },
      vision({ type: "error", error: { code: "camera-in-use", message: "" }, timestamp: 0 }),
    );
    expect(state.screen).toBe("camera-starting");
    expect(types(effects)).toEqual(["start-vision"]);
  });

  it("ignores a start result from an abandoned attempt, stopping the camera if it opened", () => {
    const abandoned = run(initial(), { type: "choose-camera" }, { type: "choose-keyboard" });
    expect(types(abandoned.effects)).toEqual(["start-vision", "stop-vision"]);

    const late = run(abandoned.state, startResult(1));
    expect(late.state.screen).toBe("ready");
    expect(late.effects).toEqual([{ type: "stop-vision" }]);

    expect(run(abandoned.state, startResult(1, "camera-in-use")).effects).toEqual([]);
  });

  it("ignores a result for an older attempt while a newer one is starting", () => {
    const state = run(initial(), { type: "choose-camera" }, startResult(1, "camera-in-use"), {
      type: "choose-camera",
    }).state;
    const next = run(state, startResult(1));
    expect(next.state.screen).toBe("camera-starting");
    expect(next.effects).toEqual([]);
  });

  it("can be chosen from the ready and game-over screens in keyboard mode, but not mid-round", () => {
    const ready = run(initial(), { type: "choose-keyboard" }).state;
    expect(run(ready, { type: "choose-camera" }).state.screen).toBe("camera-starting");

    const playing = run(ready, gameStatus("running", "ready")).state;
    expect(run(playing, { type: "choose-camera" }).effects).toEqual([]);

    const over = run(playing, gameStatus("game-over", "running")).state;
    expect(run(over, { type: "choose-camera" }).state.screen).toBe("camera-starting");
  });
});

describe("positioning", () => {
  it("announces face counts and requires two faces to continue with both players", () => {
    const one = run(positioning(), faces(1));
    expect(announcements(one.effects)).toEqual([{ kind: "faces-detected", count: 1 }]);
    expect(run(one.state, { type: "continue-two-players" }).state.screen).toBe("positioning");

    const two = run(one.state, faces(2), { type: "continue-two-players" });
    expect(two.state.screen).toBe("calibrating");
    expect(two.state.cameraPlayers).toEqual([1, 2]);
    expect(types(two.effects)).toEqual(["start-calibration"]);
    expect(two.effects).toContainEqual({ type: "start-calibration", players: [1, 2] });
  });

  it("offers one player on camera with the other on the keyboard", () => {
    expect(run(positioning(), { type: "continue-one-player", cameraPlayer: 2 }).effects).toEqual(
      [],
    );

    const { state, effects } = run(positioning(), faces(1), {
      type: "continue-one-player",
      cameraPlayer: 2,
    });
    expect(state.screen).toBe("calibrating");
    expect(state.cameraPlayers).toEqual([2]);
    expect(effects).toContainEqual({ type: "start-calibration", players: [2] });
  });

  it("returns to the keyboard and stops the camera", () => {
    const { state, effects } = run(positioning(), { type: "choose-keyboard" });
    expect(state.screen).toBe("ready");
    expect(state.mode).toBe("keyboard");
    expect(effects).toEqual([{ type: "stop-vision" }]);
  });

  it("shows the error screen when the camera fails", () => {
    const { state, effects } = run(
      positioning(),
      vision({ type: "error", error: { code: "camera-disconnected", message: "" }, timestamp: 0 }),
    );
    expect(state.screen).toBe("camera-error");
    expect(state.cameraError).toBe("camera-disconnected");
    expect(types(effects)).toEqual(["stop-vision"]);
  });
});

describe("calibration", () => {
  it("tracks per-player progress and the assignment step", () => {
    let state = run(
      calibrating(),
      vision({
        type: "calibration-progress",
        playerId: null,
        step: "assign-players",
        progress: 0.5,
        timestamp: 0,
      }),
    ).state;
    expect(state.calibration.assigning).toBe(true);

    state = run(
      state,
      vision({
        type: "calibration-progress",
        playerId: 1,
        step: "neutral",
        progress: 0.25,
        timestamp: 0,
      }),
      vision({
        type: "calibration-progress",
        playerId: 2,
        step: "gesture",
        progress: 7,
        timestamp: 0,
      }),
    ).state;
    expect(state.calibration.assigning).toBe(false);
    expect(state.calibration.players[1]).toMatchObject({
      status: "in-progress",
      step: "neutral",
      progress: 0.25,
    });
    expect(state.calibration.players[2].progress).toBe(1); // clamped
  });

  it("moves to ready once every camera player has completed", () => {
    const one = run(
      calibrating(),
      vision({ type: "calibration-complete", playerId: 1, mode: "calibrated", timestamp: 0 }),
    );
    expect(one.state.screen).toBe("calibrating");
    expect(announcements(one.effects)).toEqual([
      { kind: "calibration-complete", playerId: 1, mode: "calibrated" },
    ]);
    expect(completeBoth(calibrating()).screen).toBe("ready");
  });

  it("needs only the camera player in single-player mode", () => {
    const state = run(
      positioning(),
      faces(1),
      { type: "continue-one-player", cameraPlayer: 1 },
      vision({ type: "calibration-complete", playerId: 1, mode: "calibrated", timestamp: 0 }),
    ).state;
    expect(state.screen).toBe("ready");
  });

  it("shows a failure with its reason and allows a retry", () => {
    const failed = run(
      calibrating(),
      vision({
        type: "calibration-failed",
        playerId: 2,
        reason: "gesture-not-detected",
        timestamp: 0,
      }),
    );
    expect(failed.state.screen).toBe("calibrating");
    expect(failed.state.calibration.failure).toEqual({
      playerId: 2,
      reason: "gesture-not-detected",
    });
    expect(failed.state.calibration.players[2].status).toBe("failed");
    expect(announcements(failed.effects)).toEqual([
      { kind: "calibration-failed", playerId: 2, reason: "gesture-not-detected" },
    ]);

    const retry = run(failed.state, { type: "calibration-retry" });
    expect(retry.state.calibration.failure).toBeNull();
    expect(retry.effects).toEqual([{ type: "start-calibration", players: [1, 2] }]);
  });

  it("never shows a cancellation as a failure: the app owns every cancel", () => {
    const { state, effects } = run(
      calibrating(),
      vision({ type: "calibration-failed", playerId: 1, reason: "cancelled", timestamp: 0 }),
    );
    expect(state.calibration.failure).toBeNull();
    expect(effects).toEqual([]);
  });

  it("renders a game-over result taken from the snapshot at the status change", () => {
    const result = { winner: 1 as const, scores: { 1: 9, 2: 9 } };
    const { state } = run(
      run(initial(), { type: "choose-keyboard" }, gameStatus("running", "ready")).state,
      {
        type: "game-event",
        event: { type: "status-changed", status: "game-over", previous: "running", elapsedMs: 0 },
        result,
      },
    );
    expect(state.screen).toBe("game-over");
    expect(state.game.result).toEqual(result);
  });

  it("applies defaults, ignoring the cancellation that may cause", () => {
    const failed = run(
      calibrating(),
      vision({
        type: "calibration-failed",
        playerId: null,
        reason: "unstable-measurements",
        timestamp: 0,
      }),
    ).state;
    const defaults = run(failed, { type: "calibration-use-defaults" });
    expect(defaults.effects).toEqual([{ type: "use-default-calibration", players: [1, 2] }]);

    const done = run(
      defaults.state,
      vision({ type: "calibration-failed", playerId: null, reason: "cancelled", timestamp: 0 }),
      vision({ type: "calibration-complete", playerId: 1, mode: "default", timestamp: 0 }),
      vision({ type: "calibration-complete", playerId: 2, mode: "default", timestamp: 0 }),
    ).state;
    expect(done.screen).toBe("ready");
    expect(done.calibration.players[1].mode).toBe("default");
  });

  it("returns to the keyboard and stops the camera", () => {
    const { state, effects } = run(calibrating(), { type: "choose-keyboard" });
    expect(state.screen).toBe("ready");
    expect(state.mode).toBe("keyboard");
    expect(types(effects)).toEqual(["stop-vision"]);
  });

  it("forwards swap and reset to the session", () => {
    expect(run(calibrating(), { type: "swap-players" }).effects).toEqual([
      { type: "swap-players" },
    ]);
    const reset = run(calibrating(), { type: "reset-assignment" });
    expect(reset.effects).toEqual([{ type: "reset-assignment" }]);
    expect(reset.state.tracking).toEqual({ 1: "unassigned", 2: "unassigned" });
  });

  it("does not forward swap or reset without a running camera", () => {
    const ready = run(initial(), { type: "choose-keyboard" }).state;
    expect(run(ready, { type: "swap-players" }).effects).toEqual([]);
    const starting = run(initial(), { type: "choose-camera" }).state;
    expect(run(starting, { type: "reset-assignment" }).effects).toEqual([]);
  });
});

describe("camera mode during play", () => {
  function playingWithCamera(): AppState {
    return run(
      completeBoth(calibrating()),
      { type: "start-or-restart" },
      gameStatus("running", "ready"),
    ).state;
  }

  it("keeps playing when a face is lost, warning on that player only (O-04)", () => {
    const lost = run(playingWithCamera(), vision({ type: "face-lost", playerId: 2, timestamp: 0 }));
    expect(lost.state.screen).toBe("playing");
    expect(lost.state.tracking).toEqual({ 1: "tracked", 2: "lost" });
    expect(types(lost.effects)).toEqual([]);
    expect(announcements(lost.effects)).toEqual([{ kind: "face-lost", playerId: 2 }]);

    const found = run(lost.state, vision({ type: "face-found", playerId: 2, timestamp: 0 }));
    expect(found.state.tracking[2]).toBe("tracked");
  });

  it("counts gestures per camera player", () => {
    const { state } = run(
      playingWithCamera(),
      vision({ type: "gesture", playerId: 1, gesture: "blink", timestamp: 0 }),
      vision({ type: "gesture", playerId: 1, gesture: "blink", timestamp: 0 }),
      vision({ type: "gesture", playerId: 2, gesture: "mouth-open", timestamp: 0 }),
    );
    expect(state.gestureCounts).toEqual({ 1: 2, 2: 1 });
  });

  it("falls back to the keyboard without interrupting the round when the camera fails", () => {
    const { state, effects } = run(
      playingWithCamera(),
      vision({ type: "error", error: { code: "camera-disconnected", message: "" }, timestamp: 0 }),
    );
    expect(state.screen).toBe("playing");
    expect(state.mode).toBe("keyboard");
    expect(state.notice).toEqual({ kind: "vision-error", code: "camera-disconnected" });
    expect(types(effects)).toEqual(["stop-vision"]);
  });

  it("turns the camera off on request without leaving the game", () => {
    const { state, effects } = run(playingWithCamera(), { type: "camera-off" });
    expect(state.screen).toBe("playing");
    expect(state.mode).toBe("keyboard");
    expect(types(effects)).toEqual(["stop-vision"]);
    expect(run(state, { type: "camera-off" }).effects).toEqual([]);
  });

  it("asks players to check the labels after a re-lock", () => {
    const { state } = run(
      playingWithCamera(),
      vision({ type: "players-assigned", reason: "reacquired", timestamp: 0 }),
    );
    expect(state.notice).toEqual({ kind: "players-reassigned" });
    expect(run(state, { type: "dismiss-notice" }).state.notice).toBeNull();
  });
});

describe("page lifecycle", () => {
  it("pauses a running game when the page is hidden", () => {
    const playing = run(
      initial(),
      { type: "choose-keyboard" },
      gameStatus("running", "ready"),
    ).state;
    expect(run(playing, { type: "page-hidden" }).effects).toEqual([{ type: "game-pause" }]);
    expect(run(initial(), { type: "page-hidden" }).effects).toEqual([]);
  });

  it("stops the camera on pagehide and explains why", () => {
    const { state, effects } = run(positioning(), { type: "page-hide" });
    expect(state.mode).toBe("keyboard");
    expect(state.screen).toBe("ready");
    expect(state.notice).toEqual({ kind: "camera-stopped-hidden" });
    expect(types(effects)).toEqual(["stop-vision"]);
  });

  it("pauses and stops the camera on pagehide during a camera round", () => {
    const playing = run(completeBoth(calibrating()), gameStatus("running", "ready")).state;
    expect(types(run(playing, { type: "page-hide" }).effects)).toEqual([
      "game-pause",
      "stop-vision",
    ]);
  });

  it("does nothing on pagehide in keyboard mode with no running game", () => {
    expect(run(initial(), { type: "page-hide" }).effects).toEqual([]);
  });
});

describe("debug overlay", () => {
  it("toggles and announces its visibility", () => {
    const shown = run(initial(), { type: "toggle-debug" });
    expect(shown.state.debugVisible).toBe(true);
    expect(announcements(shown.effects)).toEqual([{ kind: "debug-overlay", visible: true }]);
    expect(run(shown.state, { type: "toggle-debug" }).state.debugVisible).toBe(false);
  });

  it("can start visible", () => {
    const state = createInitialAppState({
      cameraSupported: true,
      gameStatus: "ready",
      debugVisible: true,
    });
    expect(state.debugVisible).toBe(true);
  });
});

describe("game announcements", () => {
  it("announces start, pause, resume, crashes and the result", () => {
    const { effects } = run(
      run(initial(), { type: "choose-keyboard" }).state,
      gameStatus("running", "ready"),
      gameStatus("paused", "running"),
      gameStatus("running", "paused"),
      {
        type: "game-event",
        event: { type: "player-crashed", playerId: 1, score: 42, elapsedMs: 0 },
      },
      { type: "game-event", event: { type: "player-jumped", playerId: 2, elapsedMs: 0 } },
    );
    expect(announcements(effects)).toEqual([
      { kind: "game-started" },
      { kind: "game-paused" },
      { kind: "game-resumed" },
      { kind: "player-crashed", playerId: 1, score: 42 },
    ]);
  });
});
