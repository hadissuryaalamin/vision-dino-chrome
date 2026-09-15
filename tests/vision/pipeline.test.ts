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

// Follow-up F-02: mouth-open fired too easily during a two-player play-test.
describe("mouth sensitivity", () => {
  const MOUTH = DEFAULT_VISION_CONFIG.metrics.geometry["mouth-open"];
  /** The tuning that shipped before F-02, kept here to prove the regression is fixed. */
  const BEFORE_F02 = {
    tuning: { enterThreshold: 0.55, exitThreshold: 0.3, minActiveMs: 80, cooldownMs: 350 },
    levels: { neutral: 0.05, active: 0.45 },
  };

  function mouthPipeline(
    tuning = DEFAULT_VISION_CONFIG.gestures["mouth-open"],
    levels = MOUTH.defaultLevels,
  ) {
    const pipeline = createGesturePipeline({
      gesture: "mouth-open",
      metric: metricFunction("mouth-open", "geometry"),
      tuning,
      metricTuning: MOUTH,
      quality: DEFAULT_VISION_CONFIG.quality,
      smoothingTauMs: DEFAULT_VISION_CONFIG.smoothingTauMs,
    });
    pipeline.setCalibration({ levels, mode: "default" });
    return pipeline;
  }

  /** Feeds a mouth aspect ratio over time at 30 fps; returns the timestamps that fired. */
  function feed(
    pipeline: ReturnType<typeof mouthPipeline>,
    from: number,
    to: number,
    mar: (t: number) => number,
  ): number[] {
    const fired: number[] = [];
    for (let t = from; t <= to + 1e-9; t += 1000 / 30) {
      if (pipeline.process(makeFace({ cx: 0.5, mar: mar(t) }), 200, FRAME_720P, t).fired) {
        fired.push(t);
      }
    }
    return fired;
  }

  /** Talking: open vowels reach MAR ≈ 0.32 for ~250 ms, then the mouth nearly closes. */
  const talking = (t: number): number => (t % 400 < 250 ? 0.32 : 0.06);
  /** A deliberate wide opening from 500 ms to 1200 ms. */
  const wideOpening = (t: number): number => (t >= 500 && t < 1200 ? 0.55 : 0.05);

  it("no longer fires on a talking-like oscillation that used to fire", () => {
    // The pre-F-02 defaults treated an open vowel as a gesture.
    const before = feed(mouthPipeline(BEFORE_F02.tuning, BEFORE_F02.levels), 0, 4000, talking);
    expect(before.length).toBeGreaterThan(0);

    // The current defaults do not: 0.32 never reaches the enter threshold (≈0.45 MAR).
    expect(feed(mouthPipeline(), 0, 4000, talking)).toEqual([]);
  });

  it("still fires exactly once for a deliberate wide opening, within 300 ms", () => {
    const fired = feed(mouthPipeline(), 0, 2000, wideOpening);
    expect(fired).toHaveLength(1);
    const firedAt = fired[0] ?? 0;
    expect(firedAt).toBeGreaterThanOrEqual(
      500 + DEFAULT_VISION_CONFIG.gestures["mouth-open"].minActiveMs,
    );
    expect(firedAt).toBeLessThanOrEqual(800);
  });

  it("keeps a hysteresis gap so a half-open mouth cannot chatter", () => {
    const tuning = DEFAULT_VISION_CONFIG.gestures["mouth-open"];
    expect(tuning.enterThreshold - tuning.exitThreshold).toBeGreaterThanOrEqual(0.25);
    // A mouth held between the thresholds (≈0.35 MAR) never fires.
    expect(feed(mouthPipeline(), 0, 3000, () => 0.35)).toEqual([]);
  });
});
