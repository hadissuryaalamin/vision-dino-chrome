// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createAppHarness } from "../support/app-harness";
import type { AppHarness } from "../support/app-harness";

let harness: AppHarness;

afterEach(async () => {
  await harness.dispose();
});

async function toPositioning(): Promise<void> {
  harness.click("Play with camera");
  await harness.flush();
}

function setVisibility(state: DocumentVisibilityState): () => void {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  return () => {
    delete (document as { visibilityState?: unknown }).visibilityState;
  };
}

describe("keyboard-only play", () => {
  it("plays a full round and never creates a vision session", () => {
    harness = createAppHarness();
    expect(harness.screen()).toBe("welcome");
    expect(harness.keyboard.startCalls).toBe(1);
    expect(harness.keyboard.options).toEqual({ target: window });

    harness.click("Keyboard only");
    expect(harness.screen()).toBe("ready");
    expect(document.activeElement).toBe(harness.heading());
    expect(harness.heading()?.textContent).toBe("Ready");

    harness.press("Enter");
    expect(harness.game.count("start")).toBe(1);
    expect(harness.screen()).toBeNull();
    expect(harness.liveText()).toBe("Game started.");

    harness.keyboard.jump(1);
    harness.keyboard.jump(2);
    expect(harness.game.acceptedJumps).toEqual([1, 2]);

    harness.press("p");
    expect(harness.screen()).toBe("paused");
    expect(document.activeElement).toBe(harness.heading());
    harness.press("Escape");
    expect(harness.screen()).toBeNull();

    harness.game.finish({ winner: 2, scores: { 1: 10, 2: 30 } });
    expect(harness.screen()).toBe("game-over");
    expect(harness.text(".vd-result")).toBe(
      "Player 2 wins with 30 points. Player 1 scored 10 points.",
    );

    harness.press("Enter");
    expect(harness.game.count("restart")).toBe(1);
    expect(harness.vision.sessions).toHaveLength(0);
  });

  it("works without camera support", () => {
    harness = createAppHarness({ cameraSupported: false });
    expect(harness.button("Play with camera").disabled).toBe(true);
    harness.button("Play with camera").click();
    expect(harness.vision.sessions).toHaveLength(0);
    harness.click("Keyboard only");
    expect(harness.queryButton("Play with camera")).toBeNull();
  });

  it("does not double-start when Enter is pressed on a focused button", () => {
    harness = createAppHarness();
    harness.click("Keyboard only");
    const start = harness.button("Start");
    start.focus();
    // In a browser, Enter on a focused button fires keydown and then a click.
    const event = harness.press("Enter");
    start.click();
    expect(event.defaultPrevented).toBe(false);
    expect(harness.game.count("start")).toBe(1);
  });

  it("does not double-restart from a focused Play again button", () => {
    harness = createAppHarness();
    harness.click("Keyboard only");
    harness.press("Enter");
    harness.game.finish({ winner: null, scores: { 1: 3, 2: 3 } });
    const again = harness.button("Play again");
    again.focus();
    harness.press("Enter");
    again.click();
    expect(harness.game.count("restart")).toBe(1);
  });

  it("ignores held Enter (auto-repeat)", () => {
    harness = createAppHarness();
    harness.click("Keyboard only");
    harness.press("Enter", { repeat: true });
    expect(harness.game.count("start")).toBe(0);
  });

  it("toggles the debug overlay with the backquote key", () => {
    harness = createAppHarness();
    const overlay = harness.root.querySelector<HTMLElement>(".vd-debug");
    expect(overlay?.hidden).toBe(true);
    harness.press("`");
    expect(overlay?.hidden).toBe(false);
    harness.scheduler.step(200);
    expect(overlay?.textContent).toContain("not running");
    harness.press("`");
    expect(overlay?.hidden).toBe(true);
  });

  it("updates the HUD scores every frame", () => {
    harness = createAppHarness();
    harness.click("Keyboard only");
    harness.press("Enter");
    harness.game.setScores({ 1: 12, 2: 7 });
    harness.scheduler.step();
    const scores = [...harness.root.querySelectorAll(".vd-hud-score")].map((el) => el.textContent);
    expect(scores).toEqual(["12", "7"]);
    expect(harness.gameCanvases[0]?.getAttribute("aria-label")).toContain("Player 1: 12 points");
  });
});

describe("page lifecycle", () => {
  it("pauses a running game when the page becomes hidden", () => {
    harness = createAppHarness();
    harness.click("Keyboard only");
    harness.press("Enter");
    const restore = setVisibility("hidden");
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      restore();
    }
    expect(harness.game.count("pause")).toBe(1);
    expect(harness.screen()).toBe("paused");
  });

  it("stops the camera on pagehide", async () => {
    harness = createAppHarness();
    await toPositioning();
    window.dispatchEvent(new Event("pagehide"));
    expect(harness.session.stopCalls).toBe(1);
    expect(harness.screen()).toBe("ready");
    expect(harness.text(".vd-notice")).toContain("turned off when you left the page");
  });

  it("stops and disposes the camera and removes every listener on destroy", async () => {
    harness = createAppHarness();
    await toPositioning();
    const { session, game, keyboard, scheduler } = harness;

    const first = harness.app.destroy();
    expect(harness.app.destroy()).toBe(first);
    await first;

    expect(session.stopCalls).toBeGreaterThanOrEqual(1);
    expect(session.disposeCalls).toBe(1);
    expect(session.listenerCount).toBe(0);
    expect(game.destroyed).toBe(true);
    expect(game.listenerCount).toBe(0);
    expect(keyboard.stopCalls).toBe(1);
    expect(keyboard.listenerCount).toBe(0);
    expect(scheduler.pendingCount).toBe(0);
    expect(harness.root.children).toHaveLength(0);

    const callsBefore = game.calls.length;
    harness.press("Enter", { target: document.body });
    harness.press("p", { target: document.body });
    window.dispatchEvent(new Event("pagehide"));
    expect(game.calls.length).toBe(callsBefore);
  });

  it("destroys cleanly in keyboard-only mode without creating a session", async () => {
    harness = createAppHarness();
    await harness.app.destroy();
    expect(harness.vision.sessions).toHaveLength(0);
    expect(harness.game.destroyed).toBe(true);
  });
});
