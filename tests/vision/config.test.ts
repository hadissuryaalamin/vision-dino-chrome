import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISION_CONFIG,
  mergeVisionConfig,
  validateVisionConfig,
} from "../../src/vision/config";

describe("vision configuration", () => {
  it("uses the documented starting values", () => {
    const config = DEFAULT_VISION_CONFIG;
    expect(config.camera).toEqual({
      facingMode: "user",
      idealWidth: 1280,
      idealHeight: 720,
      idealFrameRate: 30,
    });
    expect(config.detector.numFaces).toBe(2);
    expect(config.smoothingTauMs).toBe(40);
    expect(config.gestures.blink).toEqual({
      enterThreshold: 0.6,
      exitThreshold: 0.35,
      minActiveMs: 80,
      cooldownMs: 350,
    });
    expect(config.gestures["mouth-open"]).toMatchObject({
      enterThreshold: 0.55,
      exitThreshold: 0.3,
    });
    expect(config.assignment).toMatchObject({
      assignmentStableMs: 750,
      faceLostAfterMs: 400,
      faceFoundAfterMs: 200,
      reacquireWindowMs: 3000,
    });
    expect(config.calibration).toMatchObject({
      neutralMs: 2000,
      gestureTimeoutMs: 10_000,
      repetitions: 3,
    });
    expect(() => {
      validateVisionConfig(config);
    }).not.toThrow();
  });

  it("is deeply frozen", () => {
    expect(Object.isFrozen(DEFAULT_VISION_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_VISION_CONFIG.gestures.blink)).toBe(true);
    expect(Object.isFrozen(DEFAULT_VISION_CONFIG.metrics.geometry.blink.defaultLevels)).toBe(true);
  });

  it("merges nested overrides without touching the defaults", () => {
    const merged = mergeVisionConfig(DEFAULT_VISION_CONFIG, {
      gestures: { blink: { minActiveMs: 120 } },
      metricSource: "blendshapes",
    });
    expect(merged.gestures.blink.minActiveMs).toBe(120);
    expect(merged.gestures.blink.enterThreshold).toBe(0.6);
    expect(merged.metricSource).toBe("blendshapes");
    expect(DEFAULT_VISION_CONFIG.gestures.blink.minActiveMs).toBe(80);
    expect(Object.isFrozen(merged.gestures.blink)).toBe(true);
  });

  it("rejects invalid values", () => {
    expect(() =>
      mergeVisionConfig(DEFAULT_VISION_CONFIG, { gestures: { blink: { exitThreshold: 0.7 } } }),
    ).toThrow(RangeError);
    expect(() => mergeVisionConfig(DEFAULT_VISION_CONFIG, { detector: { numFaces: 0 } })).toThrow(
      /numFaces/,
    );
    expect(() =>
      mergeVisionConfig(DEFAULT_VISION_CONFIG, { calibration: { repetitions: 1.5 } }),
    ).toThrow(/repetitions/);
  });
});
