import { describe, expect, it } from "vitest";
import { observeFace } from "../../src/vision/assignment/observation";
import {
  isUsableFrame,
  landmarkBounds,
  pixelDistance,
  rectCenter,
  toDisplayPoint,
  toDisplayRect,
  toDisplayX,
  toPixels,
} from "../../src/vision/geometry/geometry";
import { FRAME_720P, makeFace } from "./fixtures";

describe("display mapping", () => {
  it("flips x when mirrored and keeps it otherwise", () => {
    expect(toDisplayX(0.2, true)).toBeCloseTo(0.8);
    expect(toDisplayX(0.2, false)).toBe(0.2);
    expect(toDisplayPoint({ x: 0.25, y: 0.4 }, true)).toEqual({ x: 0.75, y: 0.4 });
    expect(toDisplayPoint({ x: 0.25, y: 0.4 }, false)).toEqual({ x: 0.25, y: 0.4 });
  });

  it("mirrors rectangles without changing their size", () => {
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const mirrored = toDisplayRect(rect, true);
    expect(mirrored.x).toBeCloseTo(0.6);
    expect(mirrored.y).toBe(0.2);
    expect(mirrored.width).toBe(0.3);
    expect(mirrored.height).toBe(0.4);
    expect(rectCenter(mirrored).x).toBeCloseTo(1 - rectCenter(rect).x);
    expect(toDisplayRect(rect, false)).toEqual(rect);
  });

  it("shows the person on the right of the raw frame on the left of a mirrored preview", () => {
    const face = makeFace({ cx: 0.7 });
    const mirrored = observeFace(face, FRAME_720P, true);
    const unmirrored = observeFace(face, FRAME_720P, false);
    expect(mirrored && rectCenter(mirrored.rect).x).toBeCloseTo(0.3);
    expect(unmirrored && rectCenter(unmirrored.rect).x).toBeCloseTo(0.7);
    expect(mirrored?.widthPx).toBeCloseTo(200);
    expect(mirrored?.centerPx.x).toBeCloseTo(0.3 * 1280);
  });
});

describe("pixel space", () => {
  it("scales normalised points by the frame size", () => {
    expect(toPixels({ x: 0.5, y: 0.25 }, FRAME_720P)).toEqual({ x: 640, y: 180 });
  });

  it("measures aspect-corrected distances on a 16:9 frame", () => {
    expect(pixelDistance({ x: 0, y: 0 }, { x: 0.1, y: 0 }, FRAME_720P)).toBeCloseTo(128);
    expect(pixelDistance({ x: 0, y: 0 }, { x: 0, y: 0.1 }, FRAME_720P)).toBeCloseTo(72);
    expect(pixelDistance({ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }, FRAME_720P)).toBeCloseTo(
      Math.hypot(128, 72),
    );
  });

  it("computes landmark bounds and ignores non-finite points", () => {
    const bounds = landmarkBounds([
      { x: 0.2, y: 0.3 },
      { x: 0.4, y: 0.1 },
      { x: Number.NaN, y: 0.9 },
    ]);
    expect(bounds?.x).toBeCloseTo(0.2);
    expect(bounds?.y).toBeCloseTo(0.1);
    expect(bounds?.width).toBeCloseTo(0.2);
    expect(bounds?.height).toBeCloseTo(0.2);
    expect(landmarkBounds([])).toBeNull();
  });

  it("rejects unusable frames", () => {
    expect(isUsableFrame(FRAME_720P)).toBe(true);
    expect(isUsableFrame({ width: 0, height: 720 })).toBe(false);
    expect(isUsableFrame({ width: Number.NaN, height: 720 })).toBe(false);
  });
});
