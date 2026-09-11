import { describe, expect, it } from "vitest";
import { LEFT_EYE, RIGHT_EYE } from "../../src/vision/gestures/landmark-indices";
import {
  activationScore,
  blendshapeBlink,
  blendshapeMouthOpen,
  eyeAspectRatio,
  eyeOpenness,
  metricFunction,
  mouthAspectRatio,
  normalizeMetric,
} from "../../src/vision/gestures/metrics";
import { FRAME_720P, makeFace } from "./fixtures";

describe("eye aspect ratio", () => {
  it("is high for an open eye and low for a closed eye", () => {
    const open = makeFace({ cx: 0.5, ear: 0.3 });
    const closed = makeFace({ cx: 0.5, ear: 0.08 });
    expect(eyeAspectRatio(open.landmarks, RIGHT_EYE, FRAME_720P)).toBeCloseTo(0.3);
    expect(eyeAspectRatio(open.landmarks, LEFT_EYE, FRAME_720P)).toBeCloseTo(0.3);
    expect(eyeAspectRatio(closed.landmarks, RIGHT_EYE, FRAME_720P)).toBeCloseTo(0.08);
    expect(eyeOpenness(closed.landmarks, FRAME_720P)).toBeCloseTo(0.08);
  });

  it("combines both eyes with max, so a wink is not a blink", () => {
    const wink = makeFace({ cx: 0.5, rightEar: 0.05, leftEar: 0.31 });
    expect(eyeOpenness(wink.landmarks, FRAME_720P)).toBeCloseTo(0.31);
    const otherWink = makeFace({ cx: 0.5, rightEar: 0.29, leftEar: 0.04 });
    expect(eyeOpenness(otherWink.landmarks, FRAME_720P)).toBeCloseTo(0.29);
  });

  it("falls back to the one measurable eye", () => {
    const face = makeFace({ cx: 0.5, rightEar: 0.22, leftEar: 0.3 });
    const partial = face.landmarks.slice(0, 300); // indices ≥ 300 (left eye) missing
    expect(eyeOpenness(partial, FRAME_720P)).toBeCloseTo(0.22);
    expect(eyeOpenness([], FRAME_720P)).toBeNull();
  });
});

describe("mouth aspect ratio", () => {
  it("is low for a closed mouth and high for an open mouth", () => {
    expect(mouthAspectRatio(makeFace({ cx: 0.5, mar: 0.05 }).landmarks, FRAME_720P)).toBeCloseTo(
      0.05,
    );
    expect(mouthAspectRatio(makeFace({ cx: 0.5, mar: 0.5 }).landmarks, FRAME_720P)).toBeCloseTo(
      0.5,
    );
    expect(mouthAspectRatio([], FRAME_720P)).toBeNull();
  });
});

describe("non-square frames", () => {
  it.each([
    { width: 1280, height: 720 },
    { width: 640, height: 480 },
    { width: 720, height: 1280 },
  ])("measures the pixel-space ratios on a $width×$height frame", (frame) => {
    const face = makeFace({ cx: 0.5, frame, widthPx: 180, ear: 0.25, mar: 0.4 });
    expect(eyeOpenness(face.landmarks, frame)).toBeCloseTo(0.25);
    expect(mouthAspectRatio(face.landmarks, frame)).toBeCloseTo(0.4);
  });

  it("differs from a naive ratio of normalised coordinates on 16:9", () => {
    const face = makeFace({ cx: 0.5, ear: 0.25 });
    const naive = eyeAspectRatio(face.landmarks, RIGHT_EYE, { width: 1, height: 1 });
    expect(naive).toBeCloseTo(0.25 * (1280 / 720));
  });
});

describe("blendshape metrics", () => {
  it("uses the more open eye for blinks and jawOpen for the mouth", () => {
    expect(blendshapeBlink({ eyeBlinkLeft: 0.9, eyeBlinkRight: 0.2 })).toBeCloseTo(0.2);
    expect(blendshapeBlink({ eyeBlinkLeft: 0.9 })).toBeNull();
    expect(blendshapeBlink(null)).toBeNull();
    expect(blendshapeMouthOpen({ jawOpen: 0.7 })).toBeCloseTo(0.7);
    expect(blendshapeMouthOpen(undefined)).toBeNull();
  });

  it("selects the metric by gesture and source", () => {
    const face = makeFace({
      cx: 0.5,
      ear: 0.27,
      mar: 0.33,
      blendshapes: { eyeBlinkLeft: 0.6, eyeBlinkRight: 0.8, jawOpen: 0.4 },
    });
    expect(metricFunction("blink", "geometry")(face, FRAME_720P)).toBeCloseTo(0.27);
    expect(metricFunction("mouth-open", "geometry")(face, FRAME_720P)).toBeCloseTo(0.33);
    expect(metricFunction("blink", "blendshapes")(face, FRAME_720P)).toBeCloseTo(0.6);
    expect(metricFunction("mouth-open", "blendshapes")(face, FRAME_720P)).toBeCloseTo(0.4);
  });
});

describe("normalisation", () => {
  const blink = { neutral: 0.28, active: 0.12 };
  const mouth = { neutral: 0.05, active: 0.45 };

  it("maps neutral to 0 and the gesture level to 1 in both directions", () => {
    expect(activationScore(0.28, blink)).toBeCloseTo(0);
    expect(activationScore(0.12, blink)).toBeCloseTo(1);
    expect(activationScore(0.2, blink)).toBeCloseTo(0.5);
    expect(activationScore(0.05, mouth)).toBeCloseTo(0);
    expect(activationScore(0.25, mouth)).toBeCloseTo(0.5);
  });

  it("clamps the score but not the normalised value", () => {
    expect(activationScore(0.4, blink)).toBe(0);
    expect(activationScore(0.02, blink)).toBe(1);
    expect(normalizeMetric(0.65, mouth)).toBeCloseTo(1.5);
    expect(normalizeMetric(0.3, { neutral: 0.3, active: 0.3 })).toBe(0);
  });
});
