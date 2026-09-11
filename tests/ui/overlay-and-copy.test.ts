import { describe, expect, it } from "vitest";
import type { Announcement } from "../../src/ui/view-model";
import {
  CALIBRATION_FAILURE_COPY,
  VISION_ERROR_COPY,
  announcementText,
  keyName,
  resultText,
} from "../../src/ui/copy";
import { describeGameEvent, describeVisionEvent, formatNumber } from "../../src/ui/debug-overlay";
import { containRect, drawFaceOverlay, toPixelBox } from "../../src/ui/face-overlay";
import { createDiagnostics, createPlayerDiagnostics } from "../support/diagnostics";

function recordingContext() {
  const calls: [string, ...unknown[]][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  const ctx = {
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textBaseline: "",
    setTransform: record("setTransform"),
    clearRect: record("clearRect"),
    strokeRect: record("strokeRect"),
    fillRect: record("fillRect"),
    fillText: record("fillText"),
    setLineDash: record("setLineDash"),
    measureText: (text: string) => ({ width: text.length * 8 }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe("containRect", () => {
  it("letterboxes wide media in a taller box and pillarboxes tall media", () => {
    expect(containRect(400, 400, 1280, 720)).toEqual({ x: 0, y: 87.5, width: 400, height: 225 });
    expect(containRect(400, 200, 100, 100)).toEqual({ x: 100, y: 0, width: 200, height: 200 });
  });

  it("fills the box while the media size is unknown and handles an empty box", () => {
    expect(containRect(300, 150, 0, 0)).toEqual({ x: 0, y: 0, width: 300, height: 150 });
    expect(containRect(0, 150, 640, 480)).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("toPixelBox", () => {
  it("maps display-space rectangles into the content box", () => {
    const content = { x: 0, y: 87.5, width: 400, height: 225 };
    expect(toPixelBox({ x: 0.25, y: 0.2, width: 0.5, height: 0.4 }, content)).toEqual({
      x: 100,
      y: 132.5,
      width: 200,
      height: 90,
    });
  });
});

describe("drawFaceOverlay", () => {
  it("draws labelled boxes for each tracked player and '?' for unassigned faces", () => {
    const { ctx, calls } = recordingContext();
    const diagnostics = createDiagnostics({
      players: {
        1: createPlayerDiagnostics(1, {
          tracking: "tracked",
          faceRect: { x: 0.1, y: 0.2, width: 0.2, height: 0.3 },
        }),
        2: createPlayerDiagnostics(2, { tracking: "lost" }),
      },
      unassignedFaces: [{ x: 0.6, y: 0.2, width: 0.2, height: 0.3 }],
    });

    drawFaceOverlay(
      ctx,
      { width: 320, height: 180, pixelRatio: 2 },
      { width: 1280, height: 720 },
      diagnostics,
    );

    expect(calls[0]).toEqual(["setTransform", 2, 0, 0, 2, 0, 0]);
    const texts = calls.filter(([name]) => name === "fillText").map(([, text]) => text);
    expect(texts).toEqual(["?", "P1"]);
    const boxes = calls.filter(([name]) => name === "strokeRect");
    expect(boxes).toHaveLength(2);
    expect(boxes[1]).toEqual(["strokeRect", 32, 36, 64, 54]); // P1, drawn unmirrored
  });

  it("only clears when there are no diagnostics", () => {
    const { ctx, calls } = recordingContext();
    drawFaceOverlay(ctx, { width: 100, height: 50, pixelRatio: 1 }, { width: 0, height: 0 }, null);
    expect(calls.map(([name]) => name)).toEqual(["setTransform", "clearRect"]);
  });
});

describe("copy", () => {
  it("has a title, body and next steps for every vision error", () => {
    for (const copy of Object.values(VISION_ERROR_COPY)) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      expect(copy.steps.length).toBeGreaterThan(0);
    }
    expect(Object.keys(VISION_ERROR_COPY)).toHaveLength(8);
    expect(VISION_ERROR_COPY["camera-unsupported"].canRetry).toBe(false);
    expect(Object.keys(CALIBRATION_FAILURE_COPY)).toHaveLength(7);
  });

  it("explains how to re-enable a blocked camera", () => {
    expect(VISION_ERROR_COPY["camera-permission-denied"].steps.join(" ")).toMatch(/address bar/);
  });

  it("announces errors assertively and everything else politely", () => {
    const polite: Announcement[] = [
      { kind: "faces-detected", count: 2 },
      { kind: "players-assigned", reason: "reacquired" },
      { kind: "face-lost", playerId: 1 },
      { kind: "game-over", result: { winner: null, scores: { 1: 5, 2: 5 } } },
    ];
    for (const announcement of polite) {
      expect(announcementText(announcement).politeness).toBe("polite");
    }
    expect(announcementText({ kind: "vision-error", code: "camera-not-found" })).toEqual({
      text: "No camera found. Keyboard controls still work.",
      politeness: "assertive",
    });
    expect(
      announcementText({ kind: "calibration-failed", playerId: null, reason: "timeout" })
        .politeness,
    ).toBe("assertive");
  });

  it("describes results, including ties", () => {
    expect(resultText({ winner: null, scores: { 1: 5, 2: 5 } })).toBe(
      "It's a tie: both players scored 5 points.",
    );
    expect(resultText({ winner: 1, scores: { 1: 1, 2: 0 } })).toBe(
      "Player 1 wins with 1 point. Player 2 scored 0 points.",
    );
  });

  it("names keys for display and speech", () => {
    expect(keyName("KeyW")).toEqual({ label: "W", spoken: "W" });
    expect(keyName("ArrowUp")).toEqual({ label: "↑", spoken: "Up arrow" });
    expect(keyName("Digit1")).toEqual({ label: "1", spoken: "1" });
  });
});

describe("debug descriptions", () => {
  it("describes events for the log and skips calibration progress", () => {
    expect(
      describeVisionEvent({ type: "gesture", playerId: 1, gesture: "blink", timestamp: 1500.4 }),
    ).toBe("1500 ms · P1 blink");
    expect(
      describeVisionEvent({
        type: "calibration-progress",
        playerId: 1,
        step: "neutral",
        progress: 0.5,
        timestamp: 0,
      }),
    ).toBeNull();
    expect(describeGameEvent({ type: "player-jumped", playerId: 2, elapsedMs: 250 })).toBe(
      "game 250 ms · P2 jumped",
    );
  });

  it("formats missing numbers as a dash", () => {
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(Number.NaN)).toBe("—");
    expect(formatNumber(0.456, 1)).toBe("0.5");
  });
});
