import { describe, expect, it } from "vitest";
import { DEFAULT_VISION_CONFIG, type QualityConfig } from "../../src/vision/config";
import { metricFunction } from "../../src/vision/gestures/metrics";
import { checkQuality, createGesturePipeline } from "../../src/vision/gestures/pipeline";
import { EYES_CLOSED, EYES_OPEN, FRAME_720P, makeFace } from "./fixtures";

function blinkPipeline(quality: QualityConfig = DEFAULT_VISION_CONFIG.quality) {
  return createGesturePipeline({
    gesture: "blink",
    metric: metricFunction("blink", "geometry"),
    tuning: DEFAULT_VISION_CONFIG.gestures.blink,
    metricTuning: DEFAULT_VISION_CONFIG.metrics.geometry.blink,
    quality,
    smoothingTauMs: DEFAULT_VISION_CONFIG.smoothingTauMs,
  });
}

/** Opens the eyes for 200 ms, then closes them for 300 ms; returns how many events fired. */
function openThenClose(pipeline: ReturnType<typeof blinkPipeline>, from: number): number {
  let fired = 0;
  for (let t = from; t < from + 500; t += 33) {
    const ear = t < from + 200 ? EYES_OPEN : EYES_CLOSED;
    if (pipeline.process(makeFace({ cx: 0.5, ear }), 200, FRAME_720P, t).fired) fired++;
  }
  return fired;
}

describe("gesture pipeline", () => {
  it("emits nothing until the player has a calibration", () => {
    const pipeline = blinkPipeline();
    expect(openThenClose(pipeline, 0)).toBe(0);
    expect(pipeline.diagnostics(500).state).toBe("disarmed");
    expect(pipeline.diagnostics(500).calibration).toBe("none");
    // Scores are still computed (with default levels) for display.
    expect(pipeline.last.score).toBeGreaterThan(0.9);

    pipeline.setCalibration({
      levels: DEFAULT_VISION_CONFIG.metrics.geometry.blink.defaultLevels,
      mode: "default",
    });
    expect(openThenClose(pipeline, 1000)).toBe(1);
    const diagnostics = pipeline.diagnostics(1500);
    expect(diagnostics.calibration).toBe("default");
    expect(diagnostics.state).toBe("active");
    expect(diagnostics.enterThreshold).toBe(0.6);
    expect(diagnostics.exitThreshold).toBe(0.35);
    expect(diagnostics.lastGestureAt).not.toBeNull();
  });

  it("emits nothing while suspended for calibration", () => {
    const pipeline = blinkPipeline();
    pipeline.setCalibration({ levels: { neutral: 0.3, active: 0.1 }, mode: "calibrated" });
    pipeline.setSuspended(true);
    expect(openThenClose(pipeline, 0)).toBe(0);
    pipeline.setSuspended(false);
    expect(openThenClose(pipeline, 1000)).toBe(1);
  });

  it("gives a null score when the face is too small", () => {
    const pipeline = blinkPipeline();
    const frame = pipeline.process(makeFace({ cx: 0.5, widthPx: 60 }), 60, FRAME_720P, 0);
    expect(frame.gate).toBe("face-too-small");
    expect(frame.score).toBeNull();
    expect(frame.rawMetric).toBeNull();
    expect(frame.measuredMetric).toBeCloseTo(EYES_OPEN);
  });

  it("applies the head-pose gate only when enabled", () => {
    const quality = DEFAULT_VISION_CONFIG.quality;
    const lookingDown = makeFace({ cx: 0.5, pose: { pitchDeg: 35, yawDeg: 0 } });
    const turned = makeFace({ cx: 0.5, pose: { pitchDeg: 0, yawDeg: -40 } });
    const straight = makeFace({ cx: 0.5, pose: { pitchDeg: 10, yawDeg: 20 } });
    expect(checkQuality(lookingDown, 200, quality)).toBe("head-pose");
    expect(checkQuality(turned, 200, quality)).toBe("head-pose");
    expect(checkQuality(straight, 200, quality)).toBe("ok");
    expect(checkQuality(makeFace({ cx: 0.5 }), 200, quality)).toBe("ok"); // no pose output
    expect(checkQuality(lookingDown, 200, { ...quality, useHeadPose: false })).toBe("ok");
    expect(checkQuality(null, 200, quality)).toBe("no-face");
  });

  it("forgets the signal on resetSignal but keeps the calibration", () => {
    const pipeline = blinkPipeline();
    pipeline.setCalibration({ levels: { neutral: 0.3, active: 0.1 }, mode: "calibrated" });
    openThenClose(pipeline, 0);
    pipeline.resetSignal();
    expect(pipeline.last.score).toBeNull();
    expect(pipeline.diagnostics(600).lastGestureAt).toBeNull();
    expect(pipeline.getCalibration()?.mode).toBe("calibrated");
  });
});
