import { describe, expect, it } from "vitest";
import type { PlayerId } from "../../src/shared";
import {
  createFaceAssigner,
  type AssignerEvent,
  type AssignmentFrame,
  type FaceAssigner,
} from "../../src/vision/assignment/assigner";
import { observeFace, type FaceObservation } from "../../src/vision/assignment/observation";
import { DEFAULT_VISION_CONFIG } from "../../src/vision/config";
import { FRAME_720P, makeFace } from "./fixtures";

const CONFIG = DEFAULT_VISION_CONFIG.assignment;
const FPS = 30;
const STEP = 1000 / FPS;

/** An observation centred at display x (normalised) with a pixel width. */
function at(displayX: number, options: { y?: number; widthPx?: number } = {}): FaceObservation {
  const widthPx = options.widthPx ?? 200;
  const width = widthPx / FRAME_720P.width;
  const height = (widthPx * 1.3) / FRAME_720P.height;
  const y = options.y ?? 0.5;
  return {
    rect: { x: displayX - width / 2, y: y - height / 2, width, height },
    centerPx: { x: displayX * FRAME_720P.width, y: y * FRAME_720P.height },
    widthPx,
  };
}

interface Recorded {
  readonly t: number;
  readonly event: AssignerEvent;
}

interface FrameRecord {
  readonly t: number;
  readonly faces: readonly FaceObservation[];
  readonly frame: AssignmentFrame;
}

interface Driven {
  readonly events: Recorded[];
  readonly frames: FrameRecord[];
  readonly lastT: number;
}

/** Feeds frames at 30 fps over [from, to]; odd frames reverse the detector order. */
function drive(
  assigner: FaceAssigner,
  from: number,
  to: number,
  facesAt: (t: number) => readonly FaceObservation[],
): Driven {
  const events: Recorded[] = [];
  const frames: FrameRecord[] = [];
  let lastT = from;
  let index = 0;
  for (let t = from; t <= to + 1e-9; t += STEP, index++) {
    const ordered = facesAt(t);
    const faces = index % 2 === 1 ? [...ordered].reverse() : ordered;
    const frame = assigner.update(faces, t);
    for (const event of frame.events) events.push({ t, event });
    frames.push({ t, faces, frame });
    lastT = t;
  }
  return { events, frames, lastT };
}

/** Display x of the face a player uses in a frame, or null. */
function playerX(record: FrameRecord | undefined, playerId: PlayerId): number | null {
  if (!record) return null;
  const index = record.frame.players[playerId].faceIndex;
  const face = index === null ? undefined : record.faces[index];
  return face ? face.centerPx.x / FRAME_720P.width : null;
}

function typesOf(events: readonly Recorded[]): string[] {
  return events.map(({ event }) =>
    "playerId" in event
      ? `${event.type}:${event.playerId}`
      : "reason" in event
        ? `${event.type}:${event.reason}`
        : `${event.type}:${event.count}`,
  );
}

/** Identity transitions only (without the debounced face counts). */
function transitions(events: readonly Recorded[]): string[] {
  return typesOf(events).filter((type) => !type.startsWith("faces-changed"));
}

/** A locked pair: Player 1 at display x 0.3, Player 2 at 0.7. */
function lockedPair(): { assigner: FaceAssigner; t: number } {
  const assigner = createFaceAssigner(CONFIG);
  const { lastT } = drive(assigner, 0, 1000, () => [at(0.3), at(0.7)]);
  expect(assigner.isLocked()).toBe(true);
  return { assigner, t: lastT + STEP };
}

describe("face assigner: lock", () => {
  it.each([true, false])(
    "locks the face on the left of the preview as Player 1 (mirrored: %s)",
    (mirrored) => {
      const cameraLeft = makeFace({ cx: 0.3 });
      const cameraRight = makeFace({ cx: 0.7 });
      const leftObservation = observeFace(cameraLeft, FRAME_720P, mirrored);
      const rightObservation = observeFace(cameraRight, FRAME_720P, mirrored);
      if (!leftObservation || !rightObservation) throw new Error("fixture has no bounds");

      const assigner = createFaceAssigner(CONFIG);
      const { events, frames } = drive(assigner, 0, 1000, () => [
        leftObservation,
        rightObservation,
      ]);
      const last = frames.at(-1);

      expect(typesOf(events)).toEqual(["faces-changed:2", "players-assigned:calibration"]);
      expect(events[0]?.t).toBeGreaterThanOrEqual(CONFIG.facesChangedDebounceMs);
      expect(events[1]?.t).toBeGreaterThanOrEqual(CONFIG.assignmentStableMs);
      expect(assigner.isLocked()).toBe(true);
      expect(playerX(last, 1)).toBeCloseTo(0.3);
      expect(playerX(last, 2)).toBeCloseTo(0.7);
      // Mirrored: the person on the right of the raw frame is on the left of the preview.
      const player1Face = last ? last.faces[last.frame.players[1].faceIndex ?? -1] : undefined;
      expect(player1Face).toBe(mirrored ? rightObservation : leftObservation);
    },
  );

  it("labels faces by side before the lock and reports lock progress", () => {
    const assigner = createFaceAssigner(CONFIG);
    const { frames } = drive(assigner, 0, 300, () => [at(0.7), at(0.3)]);
    expect(assigner.isLocked()).toBe(false);
    expect(assigner.lockProgress()).toBeCloseTo(300 / CONFIG.assignmentStableMs, 1);
    expect(playerX(frames.at(-1), 1)).toBeCloseTo(0.3);
    expect(frames.at(-1)?.frame.players[1].tracking).toBe("tracked");
  });
});

describe("face assigner: tracking", () => {
  it("never swaps identities under jitter and a changing detector order", () => {
    const { assigner, t } = lockedPair();
    let seed = 3;
    const jitter = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return (seed / 2147483648 - 0.5) * 0.02; // ±0.01 of the frame width ≈ ±13 px
    };
    const { events, frames } = drive(assigner, t, t + 5000, () => [
      at(0.3 + jitter(), { y: 0.5 + jitter() }),
      at(0.7 + jitter(), { y: 0.5 + jitter() }),
    ]);
    expect(events).toEqual([]);
    for (const record of frames) {
      expect(playerX(record, 1)).toBeLessThan(0.5);
      expect(playerX(record, 2)).toBeGreaterThan(0.5);
    }
  });

  it("keeps identities through a continuous crossing", () => {
    const { assigner, t } = lockedPair();
    const duration = 1500;
    const progress = (x: number): number => Math.min(1, Math.max(0, (x - t) / duration));
    const { events, frames } = drive(assigner, t, t + duration + 500, (x) => [
      at(0.3 + 0.4 * progress(x)), // Player 1 walks right
      at(0.7 - 0.4 * progress(x)), // Player 2 walks left
    ]);
    expect(events).toEqual([]);
    const last = frames.at(-1);
    expect(playerX(last, 1)).toBeCloseTo(0.7);
    expect(playerX(last, 2)).toBeCloseTo(0.3);
  });

  it("emits face-lost once and gives a returning face to the lost player", () => {
    const { assigner, t } = lockedPair();
    // A 200 ms dropout is shorter than faceLostAfterMs: nothing happens.
    const short = drive(assigner, t, t + 200, () => [at(0.3)]);
    const back = drive(assigner, short.lastT + STEP, short.lastT + 500, () => [at(0.3), at(0.7)]);
    expect([...short.events, ...back.events]).toEqual([]);

    const lostFrom = back.lastT + STEP;
    const lost = drive(assigner, lostFrom, lostFrom + 1000, () => [at(0.3)]);
    expect(transitions(lost.events)).toEqual(["face-lost:2"]);
    const lostAt = lost.events.find(({ event }) => event.type === "face-lost")?.t ?? 0;
    expect(lostAt).toBeGreaterThanOrEqual(lostFrom + CONFIG.faceLostAfterMs - STEP);
    expect(lost.frames.at(-1)?.frame.players[1].tracking).toBe("tracked");
    expect(lost.frames.at(-1)?.frame.players[2]).toMatchObject({ tracking: "lost", rect: null });

    const foundFrom = lost.lastT + STEP;
    const found = drive(assigner, foundFrom, foundFrom + 1000, () => [at(0.3), at(0.72)]);
    expect(transitions(found.events)).toEqual(["face-found:2"]);
    const foundFrame = found.frames.find((record) =>
      record.frame.events.some((event) => event.type === "face-found"),
    );
    expect(foundFrame?.t).toBeGreaterThanOrEqual(foundFrom + CONFIG.faceFoundAfterMs);
    expect(foundFrame?.frame.rearm).toEqual([2]);
    expect(playerX(found.frames.at(-1), 2)).toBeCloseTo(0.72);
    expect(playerX(found.frames.at(-1), 1)).toBeCloseTo(0.3);
  });

  it("matches faces that return within the window to their last positions", () => {
    const { assigner, t } = lockedPair();
    const gone = drive(assigner, t, t + 1000, () => []);
    expect(transitions(gone.events).sort()).toEqual(["face-lost:1", "face-lost:2"]);
    const back = drive(assigner, gone.lastT + STEP, gone.lastT + 1000, () => [at(0.68), at(0.32)]);
    expect(transitions(back.events)).toEqual(["face-found:1", "face-found:2"]);
    expect(playerX(back.frames.at(-1), 1)).toBeCloseTo(0.32);
  });

  it("re-locks by side when both faces return after the window", () => {
    const { assigner, t } = lockedPair();
    assigner.swap(); // Player 1 is now the right face
    const gone = drive(assigner, t, t + CONFIG.reacquireWindowMs + 1000, () => []);
    expect(transitions(gone.events).sort()).toEqual(["face-lost:1", "face-lost:2"]);
    const back = drive(assigner, gone.lastT + STEP, gone.lastT + 1000, () => [at(0.65), at(0.35)]);
    expect(transitions(back.events)).toEqual([
      "players-assigned:reacquired",
      "face-found:1",
      "face-found:2",
    ]);
    expect(playerX(back.frames.at(-1), 1)).toBeCloseTo(0.35);
    expect(playerX(back.frames.at(-1), 2)).toBeCloseTo(0.65);
  });
});

describe("face assigner: swap and reset", () => {
  it("swaps the players and keeps tracking the swapped assignment", () => {
    const { assigner, t } = lockedPair();
    expect(assigner.swap()).toEqual([{ type: "players-assigned", reason: "swapped" }]);
    const { events, frames } = drive(assigner, t, t + 1000, () => [at(0.3), at(0.7)]);
    expect(events).toEqual([]);
    for (const record of frames) expect(playerX(record, 1)).toBeCloseTo(0.7);
  });

  it("resets to side-based labels and re-locks with reason reset", () => {
    const { assigner, t } = lockedPair();
    assigner.swap();
    assigner.reset();
    expect(assigner.isLocked()).toBe(false);
    const { events, frames } = drive(assigner, t, t + 1000, () => [at(0.3), at(0.7)]);
    expect(playerX(frames[0], 1)).toBeCloseTo(0.3);
    expect(typesOf(events)).toEqual(["players-assigned:reset"]);
    expect(assigner.isLocked()).toBe(true);
  });

  it("swaps the side rule before the lock", () => {
    const assigner = createFaceAssigner(CONFIG);
    assigner.swap();
    const { frames } = drive(assigner, 0, 100, () => [at(0.3), at(0.7)]);
    expect(playerX(frames.at(-1), 1)).toBeCloseTo(0.7);
  });
});

describe("face assigner: face counts", () => {
  it("assigns a single face by side and never locks on it", () => {
    const left = createFaceAssigner(CONFIG);
    const { events, frames } = drive(left, 0, 3000, () => [at(0.3)]);
    expect(typesOf(events)).toEqual(["faces-changed:1"]);
    expect(left.isLocked()).toBe(false);
    expect(frames.at(-1)?.frame.players[1].tracking).toBe("tracked");
    expect(frames.at(-1)?.frame.players[2].tracking).toBe("unassigned");

    const right = createFaceAssigner(CONFIG);
    const onRight = drive(right, 0, 500, () => [at(0.7)]);
    expect(onRight.frames.at(-1)?.frame.players[2].tracking).toBe("tracked");
    expect(onRight.frames.at(-1)?.frame.players[1].tracking).toBe("unassigned");
  });

  it("ignores extra faces: the two largest are locked, the rest stay unassigned", () => {
    const assigner = createFaceAssigner(CONFIG);
    const bystander = at(0.5, { widthPx: 100, y: 0.3 });
    const { frames } = drive(assigner, 0, 2000, () => [bystander, at(0.3), at(0.7)]);
    const last = frames.at(-1);
    expect(assigner.isLocked()).toBe(true);
    expect(playerX(last, 1)).toBeCloseTo(0.3);
    expect(playerX(last, 2)).toBeCloseTo(0.7);
    expect(last?.frame.unassigned.map((index) => last.faces[index])).toEqual([bystander]);
  });

  it("debounces faces-changed across single-frame dropouts", () => {
    const assigner = createFaceAssigner(CONFIG);
    const { events } = drive(assigner, 0, 1500, (t) =>
      Math.abs(t - 500) < 1 ? [at(0.3)] : [at(0.3), at(0.7)],
    );
    expect(typesOf(events).filter((type) => type.startsWith("faces-changed"))).toEqual([
      "faces-changed:2",
    ]);
  });
});
