// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PLAYER_GESTURES } from "../../src/shared";
import type {
  CalibrationFailureReason,
  PerPlayer,
  PlayerId,
  VisionErrorCode,
} from "../../src/shared";
import {
  CALIBRATION_FAILURE_COPY,
  LOCAL_PROCESSING_NOTICE,
  VISION_ERROR_COPY,
} from "../../src/ui/copy";
import { createAppView } from "../../src/ui/view";
import type { AppView } from "../../src/ui/view";
import type {
  CalibrationPlayerView,
  HudPlayerView,
  ScreenView,
  UiIntent,
  ViewModel,
} from "../../src/ui/view-model";
import { createDiagnostics } from "../support/diagnostics";
import { createGameSnapshot } from "../support/fake-game";

const KEYS: PerPlayer<readonly string[]> = { 1: ["KeyW"], 2: ["ArrowUp"] };
const ERROR_CODES: readonly VisionErrorCode[] = [
  "camera-unsupported",
  "camera-permission-denied",
  "camera-not-found",
  "camera-in-use",
  "camera-disconnected",
  "model-load-failed",
  "inference-failed",
  "unknown",
];
const FAILURE_REASONS: readonly CalibrationFailureReason[] = [
  "not-running",
  "not-enough-faces",
  "face-lost",
  "gesture-not-detected",
  "unstable-measurements",
  "timeout",
  "cancelled",
];

let root: HTMLElement;
let intents: UiIntent[];
let view: AppView;

beforeEach(() => {
  root = document.createElement("main");
  document.body.append(root);
  intents = [];
  view = createAppView(root, {
    keyBindings: KEYS,
    playerGestures: DEFAULT_PLAYER_GESTURES,
    mirrored: true,
    onIntent: (intent) => intents.push(intent),
  });
});

afterEach(() => {
  view.destroy();
  root.remove();
});

function hudPlayer(playerId: PlayerId, overrides: Partial<HudPlayerView> = {}): HudPlayerView {
  return {
    playerId,
    control: "keyboard",
    gesture: DEFAULT_PLAYER_GESTURES[playerId],
    tracking: null,
    gestureCount: 0,
    ...overrides,
  };
}

function model(screen: ScreenView, overrides: Partial<ViewModel> = {}): ViewModel {
  return {
    screen,
    mode: "keyboard",
    hud: { visible: false, canPause: false, players: { 1: hudPlayer(1), 2: hudPlayer(2) } },
    camera: null,
    notice: null,
    debugVisible: false,
    ...overrides,
  };
}

function calibrationPlayer(
  playerId: PlayerId,
  overrides: Partial<CalibrationPlayerView> = {},
): CalibrationPlayerView {
  return {
    playerId,
    control: "camera",
    status: "waiting",
    step: null,
    progress: 0,
    mode: null,
    ...overrides,
  };
}

const visibleButtons = () =>
  [...root.querySelectorAll("button")]
    .filter((button) => button.closest("[hidden]") === null)
    .map((button) => button.textContent.trim());
const button = (name: string) => {
  const found = [...root.querySelectorAll("button")].find(
    (candidate) => candidate.textContent.trim() === name && candidate.closest("[hidden]") === null,
  );
  if (!found) throw new Error(`No button ${name}; visible: ${visibleButtons().join(", ")}`);
  return found;
};
const heading = () => root.querySelector<HTMLElement>("[data-screen-heading]");
const card = () => root.querySelector<HTMLElement>("[data-screen]");

describe("welcome screen", () => {
  it("states that processing is local before the camera button, which it describes", () => {
    view.render(model({ id: "welcome", cameraSupported: true }));
    const notice = root.querySelector("#vd-privacy-notice");
    const camera = button("Play with camera");

    expect(notice?.textContent).toContain(LOCAL_PROCESSING_NOTICE);
    expect(notice?.compareDocumentPosition(camera)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(camera.getAttribute("aria-describedby")).toBe("vd-privacy-notice");
    expect(camera.disabled).toBe(false);
    expect(visibleButtons()).toEqual(expect.arrayContaining(["Play with camera", "Keyboard only"]));
  });

  it("explains the controls for both players", () => {
    view.render(model({ id: "welcome", cameraSupported: true }));
    const text = card()?.textContent ?? "";
    expect(text).toContain("Player 1 (on the left) jumps by blinking");
    expect(text).toContain("Player 2 (on the right) jumps by opening their mouth");
  });

  it("disables the camera option with an explanation when unsupported", () => {
    view.render(model({ id: "welcome", cameraSupported: false }));
    const camera = button("Play with camera");
    expect(camera.disabled).toBe(true);
    const explanation = root.querySelector(`#${camera.getAttribute("aria-describedby") ?? ""}`);
    expect(explanation?.textContent).toMatch(/not available/);
  });

  it("reports clicks as intents", () => {
    view.render(model({ id: "welcome", cameraSupported: true }));
    button("Play with camera").click();
    button("Keyboard only").click();
    expect(intents).toEqual([{ type: "play-with-camera" }, { type: "keyboard-only" }]);
  });
});

describe("camera screens", () => {
  it("shows the loading phases with a keyboard escape", () => {
    view.render(model({ id: "camera-starting", phase: "requesting-camera" }));
    expect(heading()?.textContent).toBe("Waiting for camera permission");
    view.render(model({ id: "camera-starting", phase: "loading-model" }));
    expect(heading()?.textContent).toBe("Loading face tracking");
    expect(card()?.textContent).toContain(LOCAL_PROCESSING_NOTICE);
    expect(visibleButtons()).toContain("Keyboard only");
  });

  it.each(ERROR_CODES)("gives clear copy and next steps for %s", (code) => {
    view.render(model({ id: "camera-error", code, cameraSupported: true }));
    const copy = VISION_ERROR_COPY[code];
    expect(heading()?.textContent).toBe(copy.title);
    expect(card()?.textContent).toContain(copy.body);
    const steps = [...(card()?.querySelectorAll(".vd-steps li") ?? [])].map((li) => li.textContent);
    expect(steps).toEqual(copy.steps);
    expect(visibleButtons().includes("Try again")).toBe(copy.canRetry);
    expect(visibleButtons()).toContain("Keyboard only");
  });

  it("offers no retry when the camera is unsupported", () => {
    view.render(model({ id: "camera-error", code: "camera-in-use", cameraSupported: false }));
    expect(visibleButtons()).toEqual(expect.not.arrayContaining(["Try again"]));
  });

  it("gates positioning on the face count", () => {
    view.render(model({ id: "positioning", facesDetected: 0 }));
    expect(button("Continue").disabled).toBe(true);
    expect(card()?.textContent).toContain("Player 1 on the left, Player 2 on the right");

    view.render(model({ id: "positioning", facesDetected: 1 }));
    expect(button("Continue").disabled).toBe(true);
    expect(visibleButtons()).toContain("Continue with one player");

    view.render(model({ id: "positioning", facesDetected: 2 }));
    expect(button("Continue").disabled).toBe(false);
    expect(visibleButtons()).not.toContain("Continue with one player");
  });

  it("shows per-player calibration steps and progress", () => {
    view.render(
      model({
        id: "calibrating",
        assigning: false,
        players: {
          1: calibrationPlayer(1, { status: "in-progress", step: "neutral", progress: 0.5 }),
          2: calibrationPlayer(2, { status: "in-progress", step: "gesture", progress: 0.25 }),
        },
        failure: null,
      }),
    );
    const items = [...root.querySelectorAll(".vd-calibration-player")];
    expect(items[0]?.textContent).toContain(
      "Look at the screen with your eyes open and your mouth closed.",
    );
    expect(items[1]?.textContent).toContain("Open your mouth wide three times.");
    expect(items[0]?.querySelector("progress")?.value).toBe(0.5);
    expect(visibleButtons()).toEqual(
      expect.arrayContaining(["Restart calibration", "Use default settings", "Keyboard only"]),
    );
  });

  it("shows that a keyboard player is not calibrated", () => {
    view.render(
      model({
        id: "calibrating",
        assigning: true,
        players: {
          1: calibrationPlayer(1, { status: "complete", mode: "default" }),
          2: calibrationPlayer(2, { control: "keyboard" }),
        },
        failure: null,
      }),
    );
    const items = [...root.querySelectorAll(".vd-calibration-player")];
    expect(items[0]?.textContent).toContain("Using the default settings.");
    expect(items[1]?.textContent).toContain("Player 2 uses the keyboard.");
  });

  it.each(FAILURE_REASONS)("explains the calibration failure %s", (reason) => {
    view.render(
      model({
        id: "calibrating",
        assigning: false,
        players: { 1: calibrationPlayer(1, { status: "failed" }), 2: calibrationPlayer(2) },
        failure: { playerId: 1, reason },
      }),
    );
    const failure = root.querySelector(".vd-failure")?.textContent ?? "";
    expect(failure).toContain(`Player 1: ${CALIBRATION_FAILURE_COPY[reason].title}`);
    expect(failure).toContain(CALIBRATION_FAILURE_COPY[reason].body);
    expect(visibleButtons()).toEqual(
      expect.arrayContaining(["Retry calibration", "Use default settings", "Keyboard only"]),
    );
  });
});

describe("game screens", () => {
  it("describes the controls on the ready screen", () => {
    view.render(
      model(
        { id: "ready", controls: { 1: "camera", 2: "keyboard" }, canUseCamera: false },
        {
          hud: {
            visible: true,
            canPause: false,
            players: {
              1: hudPlayer(1, { control: "camera", tracking: "tracked" }),
              2: hudPlayer(2),
            },
          },
        },
      ),
    );
    const text = card()?.textContent ?? "";
    expect(text).toContain("Player 1: blink or press W.");
    expect(text).toContain("Player 2 presses ↑");
    expect(visibleButtons()).toContain("Start");
  });

  it("shows paused and game-over cards", () => {
    view.render(model({ id: "paused" }));
    expect(visibleButtons()).toEqual(expect.arrayContaining(["Resume", "Restart"]));
    view.render(
      model({
        id: "game-over",
        result: { winner: 2, scores: { 1: 10, 2: 30 } },
        canUseCamera: true,
      }),
    );
    expect(card()?.textContent).toContain(
      "Player 2 wins with 30 points. Player 1 scored 10 points.",
    );
    expect(visibleButtons()).toEqual(expect.arrayContaining(["Play again", "Play with camera"]));
  });

  it("shows no card while playing", () => {
    view.render(model({ id: "playing" }));
    expect(card()).toBeNull();
  });
});

describe("focus management", () => {
  it("does not steal focus on the first render, then moves it to each new screen's heading", () => {
    view.render(model({ id: "welcome", cameraSupported: true }));
    expect(document.activeElement).toBe(document.body);

    view.render(model({ id: "positioning", facesDetected: 0 }));
    expect(document.activeElement).toBe(heading());
    expect(heading()?.textContent).toBe("Get into position");
  });

  it("moves focus to the game heading when play starts", () => {
    view.render(
      model({ id: "ready", controls: { 1: "keyboard", 2: "keyboard" }, canUseCamera: false }),
    );
    view.render(model({ id: "playing" }));
    expect(document.activeElement?.id).toBe("vd-stage-heading");
  });

  it("keeps focus on the same control when a screen re-renders", () => {
    view.render(model({ id: "positioning", facesDetected: 1 }));
    button("Keyboard only").focus();
    view.render(model({ id: "positioning", facesDetected: 2 }));
    expect(document.activeElement).toBe(button("Keyboard only"));
  });

  it("falls back to the heading when the focused control disappears", () => {
    view.render(model({ id: "positioning", facesDetected: 1 }));
    button("Continue with one player").focus();
    view.render(model({ id: "positioning", facesDetected: 2 }));
    expect(document.activeElement).toBe(heading());
  });
});

describe("live regions", () => {
  it("announces politely, and errors assertively", () => {
    view.announce({ kind: "face-lost", playerId: 2 });
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Player 2: face not visible.");
    view.announce({ kind: "vision-error", code: "camera-in-use" });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("The camera is busy");
    expect(root.querySelector('[role="status"]')?.getAttribute("aria-live")).toBe("polite");
    expect(root.querySelector('[role="alert"]')?.getAttribute("aria-live")).toBe("assertive");
  });

  it("re-announces a repeated message", () => {
    view.announce({ kind: "game-paused" });
    const first = root.querySelector('[role="status"]')?.textContent;
    view.announce({ kind: "game-paused" });
    const second = root.querySelector('[role="status"]')?.textContent;
    expect(second).not.toBe(first);
    expect(second?.trim()).toBe("Game paused.");
  });
});

describe("legend, HUD and camera panel", () => {
  it("builds the keyboard legend from the key bindings", () => {
    const legend = root.querySelector(".vd-legend")?.textContent ?? "";
    expect(legend).toContain("W");
    expect(legend).toContain("Up arrow");
    expect(legend).toContain("Enter");
    expect(legend).toContain("Esc");
    expect(legend).toContain("`");
    expect(legend).toContain("blink (camera)");
    expect(legend).toContain("open mouth (camera)");
  });

  it("shows the HUD on game screens with per-player camera status and a pause button", () => {
    view.render(model({ id: "welcome", cameraSupported: true }));
    expect(root.querySelector(".vd-hud")?.hasAttribute("hidden")).toBe(true);

    view.render(
      model(
        { id: "playing" },
        {
          mode: "camera",
          hud: {
            visible: true,
            canPause: true,
            players: {
              1: hudPlayer(1, { control: "camera", tracking: "tracked" }),
              2: hudPlayer(2, { control: "camera", tracking: "lost" }),
            },
          },
        },
      ),
    );
    const players = [...root.querySelectorAll<HTMLElement>(".vd-hud-player")];
    expect(players[0]?.textContent).toContain("Face tracked");
    expect(players[0]?.textContent).toContain("Blink or W");
    expect(players[1]?.textContent).toContain("Face not visible");
    expect(players[1]?.dataset.tracking).toBe("lost");
    button("Pause").click();
    expect(intents).toEqual([{ type: "pause" }]);
  });

  it("pulses briefly when a gesture is detected", async () => {
    const hud = (count: number) => ({
      visible: true,
      canPause: true,
      players: {
        1: hudPlayer(1, { control: "camera", tracking: "tracked", gestureCount: count }),
        2: hudPlayer(2),
      },
    });
    view.render(model({ id: "playing" }, { hud: hud(0) }));
    const pulse = root.querySelector(".vd-hud-player .vd-hud-pulse");
    expect(pulse?.classList.contains("is-active")).toBe(false);

    view.render(model({ id: "playing" }, { hud: hud(1) }));
    expect(pulse?.classList.contains("is-active")).toBe(true);
    expect(pulse?.textContent).toBe("Blink detected");

    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(pulse?.classList.contains("is-active")).toBe(false);
  });

  it("updates scores and the canvas text alternative from the snapshot", () => {
    const snapshot = createGameSnapshot({
      status: "running",
      players: {
        1: { playerId: 1, score: 12, crashed: false, airborne: false },
        2: { playerId: 2, score: 1, crashed: true, airborne: false },
      },
    });
    view.updateGame(snapshot, 0);
    const scores = [...root.querySelectorAll(".vd-hud-score")].map((el) => el.textContent);
    expect(scores).toEqual(["12", "1"]);
    expect(view.gameCanvas.getAttribute("role")).toBe("img");
    expect(view.gameCanvas.getAttribute("aria-label")).toBe(
      "Game area, running. Player 1: 12 points. Player 2: 1 point, crashed.",
    );
  });

  it("shows the mirrored preview and face status only in camera mode", () => {
    const panel = root.querySelector<HTMLElement>(".vd-camera");
    view.render(model({ id: "welcome", cameraSupported: true }));
    expect(panel?.hidden).toBe(true);

    view.render(
      model(
        { id: "positioning", facesDetected: 2 },
        {
          mode: "camera",
          camera: {
            starting: false,
            facesDetected: 2,
            controls: { 1: "camera", 2: "camera" },
            tracking: { 1: "tracked", 2: "lost" },
            canAdjustAssignment: false,
          },
        },
      ),
    );
    expect(panel?.hidden).toBe(false);
    expect(panel?.textContent).toContain(LOCAL_PROCESSING_NOTICE);
    expect(panel?.textContent).toContain("P1 · blink: Face tracked");
    expect(panel?.textContent).toContain("P2 · open mouth: Face not visible");
    expect(panel?.querySelector(".vd-preview")?.classList.contains("is-mirrored")).toBe(true);
    const video = view.video;
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(true);
    expect(video.muted).toBe(true);
    expect(button("Swap players").disabled).toBe(true);
    button("Turn camera off").click();
    expect(intents).toEqual([{ type: "camera-off" }]);
  });

  it("shows a non-blocking notice with retry and dismiss", () => {
    view.render(
      model(
        { id: "game-over", result: null, canUseCamera: true },
        { notice: { kind: "vision-error", code: "camera-disconnected", canRetry: true } },
      ),
    );
    expect(root.querySelector(".vd-notice")?.textContent).toContain("The camera was disconnected");
    button("Try the camera again").click();
    button("Dismiss").click();
    expect(intents).toEqual([{ type: "play-with-camera" }, { type: "dismiss-notice" }]);
  });
});

describe("debug overlay", () => {
  it("is hidden by default and shows diagnostics and events when toggled on", () => {
    const overlay = root.querySelector<HTMLElement>(".vd-debug");
    view.render(model({ id: "welcome", cameraSupported: true }));
    expect(overlay?.hidden).toBe(true);

    view.logEvent("0 ms · faces 2");
    view.render(model({ id: "welcome", cameraSupported: true }, { debugVisible: true }));
    expect(overlay?.hidden).toBe(false);
    view.updateDebug(
      createDiagnostics({ status: "running", facesDetected: 2, processingFps: 29.5 }),
    );
    const text = overlay?.textContent ?? "";
    expect(text).toContain("running");
    expect(text).toContain("29.5");
    expect(text).toContain("faces 2");

    view.render(model({ id: "welcome", cameraSupported: true }));
    expect(overlay?.hidden).toBe(true);
  });

  it("shows every per-player diagnostics field", () => {
    view.render(model({ id: "welcome", cameraSupported: true }, { debugVisible: true }));
    view.updateDebug(createDiagnostics());
    const rows = [...root.querySelectorAll(".vd-debug-table tbody th")].map((th) => th.textContent);
    for (const label of [
      "Tracking",
      "Face rect (x, y, w, h)",
      "Last seen (ms)",
      "Raw metric",
      "Score",
      "Enter threshold",
      "Exit threshold",
      "Detector state",
      "Cooldown left (ms)",
      "Last gesture (ms)",
      "Calibration",
      "Processing fps",
      "Inference (ms)",
    ]) {
      expect(rows).toContain(label);
    }
  });
});

it("removes its DOM on destroy", () => {
  view.render(model({ id: "welcome", cameraSupported: true }));
  view.destroy();
  expect(root.children).toHaveLength(0);
});
