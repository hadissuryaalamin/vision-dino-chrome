// Face-to-player assignment (docs/architecture.md §9, decision O-06: identity follows the person).
import {
  PLAYER_IDS,
  otherPlayer,
  type AssignmentReason,
  type NormalizedRect,
  type PerPlayer,
  type PlayerId,
  type PlayerTrackingState,
  type TimestampMs,
} from "../../shared";
import type { AssignmentConfig } from "../config";
import type { Point2 } from "../types";
import type { FaceObservation } from "./observation";

/** Assignment transitions, turned into VisionEvents (with the frame timestamp) by the session. */
export type AssignerEvent =
  | { readonly type: "faces-changed"; readonly count: number }
  | { readonly type: "players-assigned"; readonly reason: AssignmentReason }
  | { readonly type: "face-lost"; readonly playerId: PlayerId }
  | { readonly type: "face-found"; readonly playerId: PlayerId };

export interface PlayerAssignment {
  readonly tracking: PlayerTrackingState;
  /** Index into this frame's faces, or null when the player's face is not used this frame. */
  readonly faceIndex: number | null;
  /** Last known face bounds while tracked (kept through short dropouts), else null. */
  readonly rect: NormalizedRect | null;
  readonly lastSeenAt: TimestampMs | null;
}

export interface AssignmentFrame {
  readonly players: PerPlayer<PlayerAssignment>;
  /** Indices of faces that belong to no player (bystanders, or faces awaiting face-found). */
  readonly unassigned: readonly number[];
  readonly events: readonly AssignerEvent[];
  /** Players whose face may now be a different person: their gesture detectors must disarm. */
  readonly rearm: readonly PlayerId[];
}

/**
 * Replaceable assignment strategy. The default (`createFaceAssigner`) locks by left/right and
 * then tracks by position; a more robust strategy (e.g. face embeddings) can implement the same
 * interface.
 */
export interface FaceAssigner {
  /** Processes one frame of display-space observations, in the detector's arbitrary order. */
  update(faces: readonly FaceObservation[], timestampMs: TimestampMs): AssignmentFrame;
  /** Exchanges Player 1 and Player 2. Returns the resulting events. */
  swap(): readonly AssignerEvent[];
  /** Forgets the lock; faces are assigned by side until the next stable pair is locked. */
  reset(): void;
  isLocked(): boolean;
  /** 0..1 progress towards the lock (1 when locked). */
  lockProgress(): number;
}

interface Track {
  state: PlayerTrackingState;
  /** Last confidently matched centre (display pixels). */
  anchor: Point2 | null;
  anchorAt: TimestampMs;
  /** Pixels per ms, smoothed. */
  velocity: Point2;
  widthPx: number;
  rect: NormalizedRect | null;
  lastSeenAt: TimestampMs | null;
  /** Start of the continuous presence of a candidate face for a lost track. */
  candidateSince: TimestampMs | null;
}

const VELOCITY_TAU_MS = 120;
const MAX_PREDICTION_MS = 300;
/** Before the lock, a player's face jumping this many face widths is treated as a new person. */
const PROVISIONAL_JUMP_WIDTHS = 1.5;

const ZERO: Point2 = { x: 0, y: 0 };

function newTrack(): Track {
  return {
    state: "unassigned",
    anchor: null,
    anchorAt: 0,
    velocity: ZERO,
    widthPx: 1,
    rect: null,
    lastSeenAt: null,
    candidateSince: null,
  };
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centerX(face: FaceObservation): number {
  return face.rect.x + face.rect.width / 2;
}

interface FrameWork {
  readonly timestampMs: TimestampMs;
  readonly faces: readonly FaceObservation[];
  readonly events: AssignerEvent[];
  readonly rearm: Set<PlayerId>;
  /** Player → face index used this frame. */
  readonly seen: Map<PlayerId, number>;
  /** Lost players that had a candidate face this frame. */
  readonly candidates: Set<PlayerId>;
}

/**
 * Default strategy:
 *
 * 1. **Before the lock**, faces are assigned by side every frame (two largest faces: left of
 *    the preview → Player 1, right → Player 2; a single face: left half → Player 1), so labels
 *    show immediately. When two faces have been visible for `assignmentStableMs`, the mapping
 *    is locked and `players-assigned` is emitted (`calibration`, or `reset` after reset()).
 * 2. **After the lock**, detections are matched to the tracks' predicted positions by minimum
 *    total distance in face widths. The detector's order is ignored. When the alternative
 *    matching is not clearly worse (within `swapMargin`, e.g. overlapping faces), positions are
 *    held rather than updated, so jitter or a crossing never swaps identities.
 * 3. A track missing for `faceLostAfterMs` emits `face-lost`. A new face appearing while the
 *    other player is tracked goes to the lost track (`face-found` after `faceFoundAfterMs`).
 *    If both were lost, reappearing faces are matched to their last positions within
 *    `reacquireWindowMs`; after the window, or if ambiguous, they are re-locked by side with
 *    `players-assigned` (`reacquired`).
 * 4. `faces-changed` is debounced by `facesChangedDebounceMs`.
 */
export function createFaceAssigner(config: AssignmentConfig): FaceAssigner {
  let tracks: Record<PlayerId, Track> = { 1: newTrack(), 2: newTrack() };
  let locked = false;
  let inverted = false;
  let pairSince: TimestampMs | null = null;
  let nextLockReason: AssignmentReason = "calibration";
  let bothLostCandidateSince: TimestampMs | null = null;
  let lastTimestamp = 0;
  let reportedCount = 0;
  let candidateCount = 0;
  let candidateCountSince = 0;

  function debounceFaceCount(count: number, work: FrameWork): void {
    if (count === reportedCount) {
      candidateCount = count;
      return;
    }
    if (count !== candidateCount) {
      candidateCount = count;
      candidateCountSince = work.timestampMs;
    }
    if (work.timestampMs - candidateCountSince >= config.facesChangedDebounceMs) {
      reportedCount = count;
      work.events.push({ type: "faces-changed", count });
    }
  }

  /** Side-based mapping: two largest faces by display x; one face by display half. */
  function sideMapping(faces: readonly FaceObservation[], invert: boolean): Map<PlayerId, number> {
    const mapping = new Map<PlayerId, number>();
    const only = faces[0];
    if (faces.length === 1 && only) {
      mapping.set(centerX(only) < 0.5 !== invert ? 1 : 2, 0);
      return mapping;
    }
    const largest = faces
      .map((face, index) => ({ face, index }))
      .sort((a, b) => b.face.widthPx - a.face.widthPx || a.index - b.index)
      .slice(0, 2)
      .sort((a, b) => centerX(a.face) - centerX(b.face));
    const [left, right] = largest;
    if (left && right) {
      mapping.set(invert ? 2 : 1, left.index);
      mapping.set(invert ? 1 : 2, right.index);
    }
    return mapping;
  }

  function place(track: Track, face: FaceObservation, timestampMs: TimestampMs): void {
    track.anchor = face.centerPx;
    track.anchorAt = timestampMs;
    track.velocity = ZERO;
    track.widthPx = Math.max(face.widthPx, 1);
    track.rect = face.rect;
    track.lastSeenAt = timestampMs;
  }

  function predict(track: Track, timestampMs: TimestampMs): Point2 | null {
    if (track.anchor === null) return null;
    const dt = Math.min(Math.max(timestampMs - track.anchorAt, 0), MAX_PREDICTION_MS);
    return { x: track.anchor.x + track.velocity.x * dt, y: track.anchor.y + track.velocity.y * dt };
  }

  function cost(face: FaceObservation, track: Track, target: Point2 | null): number {
    return target === null
      ? Infinity
      : distance(face.centerPx, target) / Math.max(track.widthPx, 1);
  }

  /** Updates a tracked player's position; `confident` moves the anchor and velocity. */
  function observeTracked(
    playerId: PlayerId,
    index: number,
    face: FaceObservation,
    confident: boolean,
    work: FrameWork,
  ): void {
    const track = tracks[playerId];
    const t = work.timestampMs;
    if (confident) {
      if (track.anchor !== null && t > track.anchorAt) {
        const dt = t - track.anchorAt;
        const alpha = 1 - Math.exp(-dt / VELOCITY_TAU_MS);
        const vx = (face.centerPx.x - track.anchor.x) / dt;
        const vy = (face.centerPx.y - track.anchor.y) / dt;
        track.velocity = {
          x: track.velocity.x + alpha * (vx - track.velocity.x),
          y: track.velocity.y + alpha * (vy - track.velocity.y),
        };
      }
      track.anchor = face.centerPx;
      track.anchorAt = t;
    }
    track.widthPx = Math.max(face.widthPx, 1);
    track.rect = face.rect;
    track.lastSeenAt = t;
    work.seen.set(playerId, index);
  }

  /** A face offered to a lost player; it is found once present for `faceFoundAfterMs`. */
  function offerCandidate(
    playerId: PlayerId,
    index: number,
    face: FaceObservation,
    work: FrameWork,
  ): void {
    const track = tracks[playerId];
    work.candidates.add(playerId);
    track.candidateSince ??= work.timestampMs;
    if (work.timestampMs - track.candidateSince < config.faceFoundAfterMs) return;
    track.state = "tracked";
    track.candidateSince = null;
    place(track, face, work.timestampMs);
    work.seen.set(playerId, index);
    work.events.push({ type: "face-found", playerId });
    work.rearm.add(playerId);
  }

  function updateUnlocked(work: FrameWork): void {
    const { faces, timestampMs } = work;
    const mapping = sideMapping(faces, inverted);
    for (const playerId of PLAYER_IDS) {
      const index = mapping.get(playerId);
      const face = index === undefined ? undefined : faces[index];
      if (index === undefined || face === undefined) continue;
      const track = tracks[playerId];
      if (track.state === "lost") {
        offerCandidate(playerId, index, face, work);
        continue;
      }
      if (track.state === "unassigned") {
        track.state = "tracked";
        work.rearm.add(playerId);
      } else if (
        track.anchor !== null &&
        distance(face.centerPx, track.anchor) >
          PROVISIONAL_JUMP_WIDTHS * Math.max(track.widthPx, face.widthPx)
      ) {
        work.rearm.add(playerId);
      }
      place(track, face, timestampMs);
      work.seen.set(playerId, index);
    }

    if (faces.length >= 2) {
      pairSince ??= timestampMs;
      if (
        timestampMs - pairSince >= config.assignmentStableMs &&
        work.seen.has(1) &&
        work.seen.has(2)
      ) {
        locked = true;
        pairSince = null;
        work.events.push({ type: "players-assigned", reason: nextLockReason });
        nextLockReason = "calibration";
      }
    } else {
      pairSince = null;
    }
  }

  function matchBoth(work: FrameWork): void {
    const { faces, timestampMs } = work;
    const track1 = tracks[1];
    const track2 = tracks[2];
    const predicted1 = predict(track1, timestampMs);
    const predicted2 = predict(track2, timestampMs);
    const only = faces[0];
    if (faces.length === 1 && only) {
      const cost1 = cost(only, track1, predicted1);
      const cost2 = cost(only, track2, predicted2);
      const playerId: PlayerId = cost1 <= cost2 ? 1 : 2;
      observeTracked(playerId, 0, only, Math.abs(cost1 - cost2) >= config.swapMargin, work);
      return;
    }
    let best: { i: number; j: number; total: number } | null = null;
    for (let i = 0; i < faces.length; i++) {
      for (let j = 0; j < faces.length; j++) {
        const faceI = faces[i];
        const faceJ = faces[j];
        if (i === j || !faceI || !faceJ) continue;
        const total = cost(faceI, track1, predicted1) + cost(faceJ, track2, predicted2);
        if (best === null || total < best.total) best = { i, j, total };
      }
    }
    if (best === null) return;
    const face1 = faces[best.i];
    const face2 = faces[best.j];
    if (!face1 || !face2) return;
    const swappedTotal = cost(face2, track1, predicted1) + cost(face1, track2, predicted2);
    const confident = swappedTotal - best.total >= config.swapMargin;
    observeTracked(1, best.i, face1, confident, work);
    observeTracked(2, best.j, face2, confident, work);
  }

  function matchOneWithLost(tracked: PlayerId, lost: PlayerId, work: FrameWork): void {
    const { faces, timestampMs } = work;
    if (faces.length === 0) return;
    const track = tracks[tracked];
    const lostTrack = tracks[lost];
    const predicted = predict(track, timestampMs);
    const costs = faces.map((face) => cost(face, track, predicted));
    const lostCost = (face: FaceObservation): number =>
      lostTrack.anchor === null
        ? Infinity
        : distance(face.centerPx, lostTrack.anchor) / Math.max(lostTrack.widthPx, 1);

    const only = faces[0];
    if (faces.length === 1 && only) {
      // The face belongs to whichever player it is closer to.
      if ((costs[0] ?? Infinity) <= lostCost(only)) observeTracked(tracked, 0, only, true, work);
      else offerCandidate(lost, 0, only, work);
      return;
    }
    const order = faces
      .map((_, index) => index)
      .sort((a, b) => (costs[a] ?? Infinity) - (costs[b] ?? Infinity));
    const [bestIndex, secondIndex] = order;
    if (bestIndex === undefined) return;
    const bestFace = faces[bestIndex];
    if (!bestFace) return;
    const confident =
      secondIndex === undefined ||
      (costs[secondIndex] ?? Infinity) - (costs[bestIndex] ?? Infinity) >= config.swapMargin;
    observeTracked(tracked, bestIndex, bestFace, confident, work);

    // The new face nearest to the lost player's last position (or the largest) goes to them.
    let candidate: { index: number; score: number } | null = null;
    for (const index of order.slice(1)) {
      const face = faces[index];
      if (!face) continue;
      const score = lostTrack.anchor === null ? -face.widthPx : lostCost(face);
      if (candidate === null || score < candidate.score) candidate = { index, score };
    }
    const candidateFace = candidate === null ? undefined : faces[candidate.index];
    if (candidate !== null && candidateFace)
      offerCandidate(lost, candidate.index, candidateFace, work);
  }

  function reacquireBoth(work: FrameWork): void {
    const { faces, timestampMs } = work;
    if (faces.length === 0) {
      bothLostCandidateSince = null;
      return;
    }
    bothLostCandidateSince ??= timestampMs;
    if (timestampMs - bothLostCandidateSince < config.faceFoundAfterMs) return;
    bothLostCandidateSince = null;

    const lastSeen = Math.max(tracks[1].lastSeenAt ?? -Infinity, tracks[2].lastSeenAt ?? -Infinity);
    const expired = timestampMs - lastSeen > config.reacquireWindowMs;
    const anchorCost = (face: FaceObservation, track: Track): number =>
      cost(face, track, track.anchor);
    let mapping: Map<PlayerId, number> | null = null;

    if (!expired) {
      const largestTwo = faces
        .map((face, index) => ({ face, index }))
        .sort((a, b) => b.face.widthPx - a.face.widthPx || a.index - b.index)
        .slice(0, 2);
      const [first, second] = largestTwo;
      if (first && second) {
        const direct = anchorCost(first.face, tracks[1]) + anchorCost(second.face, tracks[2]);
        const swapped = anchorCost(second.face, tracks[1]) + anchorCost(first.face, tracks[2]);
        if (Math.abs(direct - swapped) >= config.swapMargin) {
          mapping = new Map<PlayerId, number>(
            direct < swapped
              ? [
                  [1, first.index],
                  [2, second.index],
                ]
              : [
                  [1, second.index],
                  [2, first.index],
                ],
          );
        }
      } else if (first) {
        const cost1 = anchorCost(first.face, tracks[1]);
        const cost2 = anchorCost(first.face, tracks[2]);
        if (Math.abs(cost1 - cost2) >= config.swapMargin) {
          mapping = new Map<PlayerId, number>([[cost1 < cost2 ? 1 : 2, first.index]]);
        }
      }
    }

    const bySide = mapping === null;
    if (mapping === null) {
      inverted = false;
      mapping = sideMapping(faces, false);
    }
    if (bySide) work.events.push({ type: "players-assigned", reason: "reacquired" });
    for (const playerId of PLAYER_IDS) {
      const index = mapping.get(playerId);
      const face = index === undefined ? undefined : faces[index];
      if (index === undefined || face === undefined) continue;
      const track = tracks[playerId];
      track.state = "tracked";
      track.candidateSince = null;
      place(track, face, timestampMs);
      work.seen.set(playerId, index);
      work.events.push({ type: "face-found", playerId });
      work.rearm.add(playerId);
    }
  }

  function updateLocked(work: FrameWork): void {
    const tracked1 = tracks[1].state === "tracked";
    const tracked2 = tracks[2].state === "tracked";
    if (tracked1 && tracked2) matchBoth(work);
    else if (!tracked1 && !tracked2) reacquireBoth(work);
    else {
      const trackedPlayer: PlayerId = tracked1 ? 1 : 2;
      matchOneWithLost(trackedPlayer, otherPlayer(trackedPlayer), work);
    }
  }

  function view(playerId: PlayerId, seen: Map<PlayerId, number>): PlayerAssignment {
    const track = tracks[playerId];
    return {
      tracking: track.state,
      faceIndex: seen.get(playerId) ?? null,
      rect: track.state === "tracked" ? track.rect : null,
      lastSeenAt: track.lastSeenAt,
    };
  }

  return {
    update(faces, timestampMs) {
      lastTimestamp = timestampMs;
      const work: FrameWork = {
        timestampMs,
        faces,
        events: [],
        rearm: new Set(),
        seen: new Map(),
        candidates: new Set(),
      };
      debounceFaceCount(faces.length, work);
      if (locked) updateLocked(work);
      else updateUnlocked(work);

      for (const playerId of PLAYER_IDS) {
        const track = tracks[playerId];
        if (track.state === "lost" && !work.candidates.has(playerId)) track.candidateSince = null;
        if (
          track.state === "tracked" &&
          !work.seen.has(playerId) &&
          track.lastSeenAt !== null &&
          timestampMs - track.lastSeenAt >= config.faceLostAfterMs
        ) {
          track.state = "lost";
          track.candidateSince = null;
          work.events.push({ type: "face-lost", playerId });
          work.rearm.add(playerId);
        }
      }

      const used = new Set(work.seen.values());
      return {
        players: { 1: view(1, work.seen), 2: view(2, work.seen) },
        unassigned: faces.map((_, index) => index).filter((index) => !used.has(index)),
        events: work.events,
        rearm: PLAYER_IDS.filter((playerId) => work.rearm.has(playerId)),
      };
    },
    swap() {
      tracks = { 1: tracks[2], 2: tracks[1] };
      if (!locked) inverted = !inverted;
      return [{ type: "players-assigned", reason: "swapped" }];
    },
    reset() {
      locked = false;
      inverted = false;
      pairSince = null;
      bothLostCandidateSince = null;
      nextLockReason = "reset";
      for (const playerId of PLAYER_IDS) {
        tracks[playerId].velocity = ZERO;
        tracks[playerId].candidateSince = null;
      }
    },
    isLocked: () => locked,
    lockProgress() {
      if (locked) return 1;
      if (pairSince === null) return 0;
      if (config.assignmentStableMs <= 0) return 1;
      return Math.min(1, (lastTimestamp - pairSince) / config.assignmentStableMs);
    },
  };
}
