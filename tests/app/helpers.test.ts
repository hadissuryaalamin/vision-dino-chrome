import { describe, expect, it } from "vitest";
import { pickSingleCameraPlayer } from "../../src/app/assignment";
import { parseAppUrlOptions } from "../../src/app/url-options";
import { createDiagnostics, createPlayerDiagnostics } from "../support/diagnostics";

describe("parseAppUrlOptions", () => {
  it("is off by default", () => {
    expect(parseAppUrlOptions("")).toEqual({ debug: false, simulatedVision: false });
  });

  it("reads ?debug=1 and ?vision=simulated", () => {
    expect(parseAppUrlOptions("?debug=1&vision=simulated")).toEqual({
      debug: true,
      simulatedVision: true,
    });
    expect(parseAppUrlOptions("?debug").debug).toBe(true);
  });

  it("treats explicit off values as off", () => {
    expect(parseAppUrlOptions("?debug=0").debug).toBe(false);
    expect(parseAppUrlOptions("?debug=false").debug).toBe(false);
    expect(parseAppUrlOptions("?vision=camera").simulatedVision).toBe(false);
  });
});

describe("pickSingleCameraPlayer", () => {
  const face = (x: number) => ({ x, y: 0.3, width: 0.2, height: 0.3 });

  it("prefers a player that is already tracked", () => {
    const diagnostics = createDiagnostics({
      players: {
        1: createPlayerDiagnostics(1),
        2: createPlayerDiagnostics(2, { tracking: "tracked", faceRect: face(0.1) }),
      },
      unassignedFaces: [face(0.1)],
    });
    expect(pickSingleCameraPlayer(diagnostics)).toBe(2);
  });

  it("assigns an unassigned face by side of the preview", () => {
    expect(pickSingleCameraPlayer(createDiagnostics({ unassignedFaces: [face(0.1)] }))).toBe(1);
    expect(pickSingleCameraPlayer(createDiagnostics({ unassignedFaces: [face(0.6)] }))).toBe(2);
  });

  it("defaults to Player 1 when no face is visible", () => {
    expect(pickSingleCameraPlayer(createDiagnostics())).toBe(1);
  });
});
