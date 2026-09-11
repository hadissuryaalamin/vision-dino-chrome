// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_PROCESSING_NOTICE } from "../../src/ui/copy";
import { createAppHarness } from "../support/app-harness";
import type { AppHarness } from "../support/app-harness";
import { visionError } from "../support/fake-vision";
import type { PendingStart } from "../support/fake-vision";

let harness: AppHarness;

afterEach(async () => {
  await harness.dispose();
});

async function toPositioning(): Promise<void> {
  harness.click("Play with camera");
  await harness.flush();
}

async function toReadyWithCamera(): Promise<void> {
  await toPositioning();
  harness.session.facesChanged(2);
  harness.click("Continue");
  harness.session.completeCalibration(1);
  harness.session.completeCalibration(2);
}

async function toPlayingWithCamera(): Promise<void> {
  await toReadyWithCamera();
  harness.press("Enter");
}

describe("camera permission", () => {
  it("is requested only from the click, after the local-processing notice", async () => {
    harness = createAppHarness();
    expect(harness.vision.sessions).toHaveLength(0);
    expect(harness.root.textContent).toContain(LOCAL_PROCESSING_NOTICE);

    harness.click("Play with camera");
    // The factory and start() ran synchronously inside the click (user activation).
    expect(harness.vision.sessions).toHaveLength(1);
    expect(harness.session.startCalls).toBe(1);
    expect(harness.session.options?.mirrored).toBe(true);
    expect(harness.session.options?.video).toBe(harness.root.querySelector("video"));

    await harness.flush();
    expect(harness.screen()).toBe("positioning");
    expect(harness.session.startCalls).toBe(1);
  });

  it("shows the requesting and loading states", async () => {
    let pending: PendingStart | null = null;
    harness = createAppHarness({
      configureSession: (session) => {
        pending = session.holdNextStart();
      },
    });
    harness.click("Play with camera");
    expect(harness.heading()?.textContent).toBe("Waiting for camera permission");
    expect(harness.root.querySelector(".vd-preview-status")?.closest("[hidden]")).toBeNull();

    (pending as PendingStart | null)?.loadModel();
    expect(harness.heading()?.textContent).toBe("Loading face tracking");

    (pending as PendingStart | null)?.resolve();
    await harness.flush();
    expect(harness.screen()).toBe("positioning");
  });

  it("falls back to the keyboard when permission is denied", async () => {
    harness = createAppHarness({
      configureSession: (session) =>
        session.queueStartResult(visionError("camera-permission-denied")),
    });
    await toPositioning();

    expect(harness.screen()).toBe("camera-error");
    expect(harness.heading()?.textContent).toBe("Camera permission was blocked");
    expect(document.activeElement).toBe(harness.heading());
    expect(harness.alertText()).toContain("Camera permission was blocked");
    expect(harness.queryButton("Try again")).not.toBeNull();
    expect(harness.session.stopCalls).toBeGreaterThanOrEqual(1);

    harness.click("Keyboard only");
    expect(harness.screen()).toBe("ready");
    harness.press("Enter");
    harness.keyboard.jump(1);
    expect(harness.game.acceptedJumps).toEqual([1]);
  });

  it("retries after a model load failure", async () => {
    harness = createAppHarness({
      configureSession: (session) => session.queueStartResult(visionError("model-load-failed")),
    });
    await toPositioning();
    expect(harness.heading()?.textContent).toBe("Face tracking could not be loaded");

    harness.click("Try again");
    expect(harness.session.startCalls).toBe(2);
    expect(harness.vision.sessions).toHaveLength(1);
    await harness.flush();
    expect(harness.screen()).toBe("positioning");
  });
});

describe("positioning and calibration", () => {
  it("goes from positioning through calibration to ready", async () => {
    harness = createAppHarness();
    await toPositioning();
    expect(harness.button("Continue").disabled).toBe(true);

    harness.session.facesChanged(1);
    expect(harness.liveText()).toBe("One face detected.");
    expect(harness.button("Continue").disabled).toBe(true);

    harness.session.facesChanged(2);
    harness.click("Continue");
    expect(harness.screen()).toBe("calibrating");
    expect(harness.session.calls).toContainEqual({ method: "startCalibration", players: [1, 2] });

    harness.session.progressCalibration(1, "gesture", 0.4);
    expect(harness.text(".vd-calibration-player")).toContain("Blink firmly three times.");

    harness.session.completeCalibration(1);
    expect(harness.screen()).toBe("calibrating");
    harness.session.completeCalibration(2);
    expect(harness.screen()).toBe("ready");
    expect(harness.text(".vd-face-list")).toContain("P1 · blink: Face tracked");
  });

  it("falls back to default settings after a calibration failure", async () => {
    harness = createAppHarness();
    await toPositioning();
    harness.session.facesChanged(2);
    harness.click("Continue");

    harness.session.failCalibration(2, "gesture-not-detected");
    expect(harness.text(".vd-failure")).toContain("Player 2: The gesture was not detected clearly");
    expect(harness.alertText()).toContain("Calibration failed.");

    harness.click("Use default settings");
    expect(harness.session.calls).toContainEqual({
      method: "useDefaultCalibration",
      players: [1, 2],
    });
    expect(harness.screen()).toBe("ready");
  });

  it("retries a failed calibration", async () => {
    harness = createAppHarness();
    await toPositioning();
    harness.session.facesChanged(2);
    harness.click("Continue");
    harness.session.failCalibration(null, "not-enough-faces");
    harness.click("Retry calibration");
    expect(harness.session.count("startCalibration")).toBe(2);
    expect(harness.root.querySelector(".vd-failure")).toBeNull();
  });

  it("continues with one player on camera, assigned by side", async () => {
    harness = createAppHarness();
    await toPositioning();
    harness.session.setDiagnostics({
      unassignedFaces: [{ x: 0.6, y: 0.3, width: 0.2, height: 0.3 }],
    });
    harness.session.facesChanged(1);
    harness.click("Continue with one player");

    expect(harness.session.calls).toContainEqual({ method: "startCalibration", players: [2] });
    harness.session.completeCalibration(2);
    expect(harness.screen()).toBe("ready");
    const hud = [...harness.root.querySelectorAll(".vd-hud-control")].map((el) => el.textContent);
    expect(hud).toEqual(["W", "Open mouth or ↑"]);
  });

  it("stops the camera when switching to the keyboard during setup", async () => {
    harness = createAppHarness();
    await toPositioning();
    harness.click("Keyboard only");
    expect(harness.session.stopCalls).toBe(1);
    expect(harness.session.getStatus()).toBe("idle");
    expect(harness.root.querySelector<HTMLElement>(".vd-camera")?.hidden).toBe(true);
  });
});

describe("playing with the camera", () => {
  it("turns one gesture event into exactly one jump for that player", async () => {
    harness = createAppHarness();
    await toPlayingWithCamera();
    expect(harness.game.getSnapshot().status).toBe("running");

    harness.session.gesture(1, "blink", 1000);
    expect(harness.game.jumps).toEqual([1]);
    harness.session.gesture(2, "mouth-open", 1100);
    expect(harness.game.jumps).toEqual([1, 2]);

    // The wrong gesture for a player is not an action.
    harness.session.gesture(1, "mouth-open", 1200);
    expect(harness.game.jumps).toEqual([1, 2]);
  });

  it("routes keyboard and vision input at the same time", async () => {
    harness = createAppHarness();
    await toPlayingWithCamera();
    harness.keyboard.jump(2);
    harness.session.gesture(1);
    harness.keyboard.jump(1);
    expect(harness.game.acceptedJumps).toEqual([2, 1, 1]);
  });

  it("shows a gesture pulse on that player's HUD", async () => {
    harness = createAppHarness();
    await toPlayingWithCamera();
    harness.session.gesture(2);
    const pulses = [...harness.root.querySelectorAll(".vd-hud-pulse")];
    expect(pulses[1]?.classList.contains("is-active")).toBe(true);
    expect(pulses[0]?.classList.contains("is-active")).toBe(false);
  });

  it("warns about a lost face without pausing (O-04), and clears when it is found", async () => {
    harness = createAppHarness();
    await toPlayingWithCamera();

    harness.session.faceLost(2);
    const p2 = harness.root.querySelectorAll<HTMLElement>(".vd-hud-player")[1];
    expect(p2?.textContent).toContain("Face not visible");
    expect(harness.liveText()).toBe("Player 2: face not visible.");
    expect(harness.game.count("pause")).toBe(0);
    expect(harness.game.getSnapshot().status).toBe("running");

    harness.session.faceFound(2);
    expect(p2?.textContent).toContain("Face tracked");
  });

  it("keeps the round going on the keyboard when the camera disconnects", async () => {
    harness = createAppHarness();
    await toPlayingWithCamera();
    harness.session.fail("camera-disconnected");

    expect(harness.text(".vd-notice")).toContain("The camera was disconnected");
    expect(harness.alertText()).toContain("The camera was disconnected");
    expect(harness.session.stopCalls).toBeGreaterThanOrEqual(1);
    expect(harness.game.getSnapshot().status).toBe("running");
    expect(harness.root.querySelector<HTMLElement>(".vd-camera")?.hidden).toBe(true);
    harness.keyboard.jump(1);
    expect(harness.game.acceptedJumps).toEqual([1]);
  });

  it("offers swap, reset and camera off", async () => {
    harness = createAppHarness();
    await toReadyWithCamera();
    harness.click("Swap players");
    expect(harness.session.count("swapPlayers")).toBe(1);
    expect(harness.liveText()).toBe("Players swapped. Check the P1 and P2 labels.");

    harness.click("Reset assignment");
    expect(harness.session.count("resetAssignment")).toBe(1);

    harness.click("Turn camera off");
    expect(harness.session.stopCalls).toBe(1);
    expect(harness.screen()).toBe("ready");
    expect(harness.queryButton("Play with camera")).not.toBeNull();
  });

  it("feeds the debug overlay from polled diagnostics", async () => {
    harness = createAppHarness({ search: "?debug=1" });
    const overlay = harness.root.querySelector<HTMLElement>(".vd-debug");
    expect(overlay?.hidden).toBe(false);
    await toPositioning();
    harness.session.facesChanged(2);
    harness.scheduler.step(200);
    expect(overlay?.textContent).toContain("running");
    expect(overlay?.textContent).toContain("faces 2");
  });
});
