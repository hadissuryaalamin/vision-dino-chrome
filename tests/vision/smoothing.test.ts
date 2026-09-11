import { describe, expect, it } from "vitest";
import { createEmaSmoother, emaAlpha } from "../../src/vision/gestures/smoothing";

describe("time-constant EMA", () => {
  it.each([15, 30, 60])("responds to a step identically at %i fps", (fps) => {
    const tau = 40;
    const smoother = createEmaSmoother(tau);
    smoother.next(0, 0);
    let value = 0;
    const frames = Math.round(fps * 0.2); // 200 ms
    for (let i = 1; i <= frames; i++) value = smoother.next(1, (i * 1000) / fps);
    expect(value).toBeCloseTo(1 - Math.exp(-200 / tau), 9);
  });

  it("takes the first sample as is and forgets history on reset", () => {
    const smoother = createEmaSmoother(40);
    expect(smoother.value).toBeNull();
    expect(smoother.next(5, 100)).toBe(5);
    smoother.next(0, 140);
    smoother.reset();
    expect(smoother.value).toBeNull();
    expect(smoother.next(3, 150)).toBe(3);
  });

  it("ignores samples with a non-increasing timestamp", () => {
    const smoother = createEmaSmoother(40);
    smoother.next(1, 100);
    expect(smoother.next(0, 100)).toBe(1);
    expect(smoother.next(0, 90)).toBe(1);
  });

  it("passes samples through when τ is 0", () => {
    const smoother = createEmaSmoother(0);
    smoother.next(1, 0);
    expect(smoother.next(0.25, 10)).toBe(0.25);
    expect(emaAlpha(33, 0)).toBe(1);
    expect(emaAlpha(0, 40)).toBe(0);
    expect(emaAlpha(40, 40)).toBeCloseTo(1 - Math.exp(-1));
  });
});
