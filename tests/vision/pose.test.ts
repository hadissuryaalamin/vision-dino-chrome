import { describe, expect, it } from "vitest";
import { headPoseFromMatrix } from "../../src/vision/geometry/pose";

type Matrix3 = number[][];

const DEG = Math.PI / 180;

function multiply(a: Matrix3, b: Matrix3): Matrix3 {
  return [0, 1, 2].map((row) =>
    [0, 1, 2].map((column) =>
      [0, 1, 2].reduce((sum, k) => sum + (a[row]?.[k] ?? 0) * (b[k]?.[column] ?? 0), 0),
    ),
  );
}

function rotationY(deg: number): Matrix3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}

function rotationX(deg: number): Matrix3 {
  const c = Math.cos(deg * DEG);
  const s = Math.sin(deg * DEG);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}

/** A 4×4 face transform (rotation, scale, translation) flattened in the given layout. */
function transform(
  rotation: Matrix3,
  layout: "column" | "row",
  scale = 1,
  translation: readonly [number, number, number] = [2, -3, -50],
): number[] {
  const m = (row: number, column: number): number => {
    if (row < 3 && column < 3) return scale * (rotation[row]?.[column] ?? 0);
    if (row < 3) return translation[row] ?? 0;
    return column === 3 ? 1 : 0;
  };
  const data: number[] = [];
  for (let i = 0; i < 16; i++) {
    const major = Math.floor(i / 4);
    const minor = i % 4;
    data.push(layout === "column" ? m(minor, major) : m(major, minor));
  }
  return data;
}

describe("headPoseFromMatrix", () => {
  it("returns zero angles for a face looking at the camera", () => {
    const pose = headPoseFromMatrix(transform(rotationY(0), "column"));
    expect(Math.abs(pose?.yawDeg ?? NaN)).toBeCloseTo(0);
    expect(Math.abs(pose?.pitchDeg ?? NaN)).toBeCloseTo(0);
  });

  it.each(["column", "row"] as const)("recovers yaw and pitch magnitudes (%s-major)", (layout) => {
    const yawOnly = headPoseFromMatrix(transform(rotationY(30), layout, 1.7));
    expect(Math.abs(yawOnly?.yawDeg ?? NaN)).toBeCloseTo(30);
    expect(Math.abs(yawOnly?.pitchDeg ?? NaN)).toBeCloseTo(0);

    const pitchOnly = headPoseFromMatrix(transform(rotationX(20), layout));
    expect(Math.abs(pitchOnly?.pitchDeg ?? NaN)).toBeCloseTo(20);
    expect(Math.abs(pitchOnly?.yawDeg ?? NaN)).toBeCloseTo(0);

    const both = headPoseFromMatrix(transform(multiply(rotationY(-25), rotationX(15)), layout));
    expect(Math.abs(both?.yawDeg ?? NaN)).toBeCloseTo(25);
    expect(Math.abs(both?.pitchDeg ?? NaN)).toBeCloseTo(15);
  });

  it("gives the same magnitudes when the canonical face looks along −z", () => {
    const flipped = multiply(rotationY(30), rotationY(180));
    const pose = headPoseFromMatrix(transform(flipped, "column"));
    expect(Math.abs(pose?.yawDeg ?? NaN)).toBeCloseTo(30);
  });

  it("rejects malformed matrices", () => {
    expect(headPoseFromMatrix([])).toBeNull();
    expect(headPoseFromMatrix(new Array<number>(16).fill(0))).toBeNull();
    const withNaN = transform(rotationY(0), "column");
    withNaN[5] = Number.NaN;
    expect(headPoseFromMatrix(withNaN)).toBeNull();
  });
});
