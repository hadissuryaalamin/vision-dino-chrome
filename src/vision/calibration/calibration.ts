// Per-player calibration (docs/architecture.md §10.2). Everything stays in memory.
import {
  PLAYER_IDS,
  type CalibrationFailureReason,
  type CalibrationStep,
  type PerPlayer,
  type PlayerId,
  type PlayerTrackingState,
  type TimestampMs,
} from "../../shared";
import type { CalibrationConfig, MetricLevels, MetricTuning } from "../config";
import { median, robustSpread } from "./stats";

/** Calibration transitions; the session adds timestamps and applies completed levels. */
export type CalibrationRunEvent =
  | {
      readonly type: "calibration-progress";
      readonly playerId: PlayerId | null;
      readonly step: CalibrationStep;
      readonly progress: number;
    }
  | {
      readonly type: "calibration-complete";
      readonly playerId: PlayerId;
      readonly levels: MetricLevels;
    }
  | {
      readonly type: "calibration-failed";
      readonly playerId: PlayerId | null;
      readonly reason: CalibrationFailureReason;
    };

export interface CalibrationPlayerInput {
  readonly tracking: PlayerTrackingState;
  /** Metric that passed the quality gate this frame, or null. */
  readonly rawMetric: number | null;
  /** Smoothed metric (what the detector will see), or null. */
  readonly smoothedMetric: number | null;
}

export interface CalibrationFrameInput {
  readonly timestampMs: TimestampMs;
  readonly locked: boolean;
  readonly lockProgress: number;
  readonly players: PerPlayer<CalibrationPlayerInput>;
}

export interface CalibrationRunOptions {
  readonly players: readonly PlayerId[];
  readonly tuning: PerPlayer<MetricTuning>;
  readonly config: CalibrationConfig;
  /** A single player must be tracked this long before measuring starts (when not locked). */
  readonly assignmentStableMs: number;
}

/** Debug view of one player's calibration, for the Vision Lab. */
export interface CalibrationPlayerStatus {
  readonly step: CalibrationStep | "done";
  readonly neutral: number | null;
  readonly noise: number | null;
  readonly peakThreshold: number | null;
  readonly peaks: readonly number[];
}

/**
 * One calibration run for one or both players, measured concurrently:
 *
 * 1. `assign-players` (playerId null): wait for the face lock (both players), or for the one
 *    requested player to be tracked for `assignmentStableMs`. Timeout → `not-enough-faces`.
 * 2. `neutral`: median and robust noise of the metric over `neutralMs`. Too few samples or too
 *    much noise → `unstable-measurements` (or `face-lost` if the face was mostly missing).
 * 3. `gesture`: count `repetitions` deliberate gestures. An excursion counts when the smoothed
 *    metric moves at least max(`minSeparation`, `noiseFactor` × noise) from neutral and comes
 *    back halfway; its extreme is recorded. The active level is the median of the extremes.
 *    Timeout → `gesture-not-detected` (no gesture seen) or `timeout` (too few).
 *
 * Losing the face (`face-lost`) fails that player immediately. Players complete or fail
 * independently.
 */
export interface CalibrationRun {
  isActive(): boolean;
  includes(playerId: PlayerId): boolean;
  /** Players still being calibrated. */
  activePlayers(): readonly PlayerId[];
  begin(timestampMs: TimestampMs): CalibrationRunEvent[];
  update(input: CalibrationFrameInput): CalibrationRunEvent[];
  /** After a swap: measuring players restart their neutral step (the faces changed). */
  restartMeasurements(timestampMs: TimestampMs): CalibrationRunEvent[];
  /** After a reset of the assignment: go back to `assign-players`. */
  restartAssignment(timestampMs: TimestampMs): CalibrationRunEvent[];
  /** Ends the run, failing every active player with `reason`. */
  cancel(reason: CalibrationFailureReason): CalibrationRunEvent[];
  /** Drops a player without events (defaults were applied instead). */
  remove(playerId: PlayerId): void;
  status(playerId: PlayerId): CalibrationPlayerStatus | null;
}

type Phase =
  | { readonly kind: "assign" }
  | {
      readonly kind: "neutral";
      readonly startedAt: TimestampMs;
      readonly samples: number[];
      frames: number;
      trackedFrames: number;
    }
  | {
      readonly kind: "gesture";
      readonly startedAt: TimestampMs;
      readonly neutral: number;
      readonly noise: number;
      readonly threshold: number;
      readonly direction: 1 | -1;
      readonly peaks: number[];
      excursion: number | null;
    };

const PROGRESS_STEPS = 10;

export function createCalibrationRun(options: CalibrationRunOptions): CalibrationRun {
  const { config } = options;
  const phases = new Map<PlayerId, Phase>();
  for (const playerId of PLAYER_IDS) {
    if (options.players.includes(playerId)) phases.set(playerId, { kind: "assign" });
  }
  let assignStartedAt: TimestampMs = 0;
  let readySince: TimestampMs | null = null;
  const lastBucket = new Map<string, number>();

  const inAssign = (): boolean => [...phases.values()].some((phase) => phase.kind === "assign");

  function progress(
    events: CalibrationRunEvent[],
    playerId: PlayerId | null,
    step: CalibrationStep,
    value: number,
    force = false,
  ): void {
    const clamped = Math.min(1, Math.max(0, value));
    const key = `${playerId ?? "all"}:${step}`;
    const bucket = Math.floor(clamped * PROGRESS_STEPS);
    if (!force && lastBucket.get(key) === bucket) return;
    lastBucket.set(key, bucket);
    events.push({ type: "calibration-progress", playerId, step, progress: clamped });
  }

  function startNeutral(events: CalibrationRunEvent[], playerId: PlayerId, t: TimestampMs): void {
    phases.set(playerId, {
      kind: "neutral",
      startedAt: t,
      samples: [],
      frames: 0,
      trackedFrames: 0,
    });
    progress(events, playerId, "neutral", 0, true);
  }

  function fail(
    events: CalibrationRunEvent[],
    playerId: PlayerId,
    reason: CalibrationFailureReason,
  ): void {
    phases.delete(playerId);
    events.push({ type: "calibration-failed", playerId, reason });
  }

  function updateAssign(input: CalibrationFrameInput, events: CalibrationRunEvent[]): void {
    const t = input.timestampMs;
    const players = [...phases.keys()];
    const allTracked = players.every((playerId) => input.players[playerId].tracking === "tracked");
    let ready: boolean;
    let value: number;
    if (players.length >= 2) {
      ready = input.locked && allTracked;
      value = input.locked ? (allTracked ? 1 : 0) : input.lockProgress;
    } else {
      readySince = allTracked ? (readySince ?? t) : null;
      const held = readySince === null ? 0 : t - readySince;
      ready = allTracked && (input.locked || held >= options.assignmentStableMs);
      value =
        options.assignmentStableMs <= 0 ? (allTracked ? 1 : 0) : held / options.assignmentStableMs;
    }
    if (ready) {
      progress(events, null, "assign-players", 1);
      for (const playerId of players) startNeutral(events, playerId, t);
      return;
    }
    if (t - assignStartedAt >= config.assignTimeoutMs) {
      phases.clear();
      events.push({ type: "calibration-failed", playerId: null, reason: "not-enough-faces" });
      return;
    }
    progress(events, null, "assign-players", ready ? 1 : value);
  }

  function updateNeutral(
    playerId: PlayerId,
    phase: Extract<Phase, { kind: "neutral" }>,
    input: CalibrationPlayerInput,
    t: TimestampMs,
    events: CalibrationRunEvent[],
  ): void {
    phase.frames++;
    if (input.tracking === "tracked") phase.trackedFrames++;
    if (input.rawMetric !== null) phase.samples.push(input.rawMetric);
    const elapsed = t - phase.startedAt;
    progress(events, playerId, "neutral", config.neutralMs <= 0 ? 1 : elapsed / config.neutralMs);
    if (elapsed < config.neutralMs) return;

    const tuning = options.tuning[playerId];
    const neutral = median(phase.samples);
    const noise = robustSpread(phase.samples);
    if (phase.samples.length < config.minNeutralSamples || neutral === null || noise === null) {
      fail(
        events,
        playerId,
        phase.trackedFrames * 2 < phase.frames ? "face-lost" : "unstable-measurements",
      );
      return;
    }
    if (noise > tuning.maxNeutralNoise) {
      fail(events, playerId, "unstable-measurements");
      return;
    }
    const { defaultLevels } = tuning;
    phases.set(playerId, {
      kind: "gesture",
      startedAt: t,
      neutral,
      noise,
      threshold: Math.max(tuning.minSeparation, config.noiseFactor * noise),
      direction: defaultLevels.active >= defaultLevels.neutral ? 1 : -1,
      peaks: [],
      excursion: null,
    });
    progress(events, playerId, "gesture", 0, true);
  }

  function updateGesture(
    playerId: PlayerId,
    phase: Extract<Phase, { kind: "gesture" }>,
    input: CalibrationPlayerInput,
    t: TimestampMs,
    events: CalibrationRunEvent[],
  ): void {
    const metric = input.smoothedMetric;
    if (metric !== null) {
      const deviation = phase.direction * (metric - phase.neutral);
      if (phase.excursion === null) {
        if (deviation >= phase.threshold) phase.excursion = deviation;
      } else {
        phase.excursion = Math.max(phase.excursion, deviation);
        if (deviation <= phase.threshold / 2) {
          phase.peaks.push(phase.neutral + phase.direction * phase.excursion);
          phase.excursion = null;
          progress(events, playerId, "gesture", phase.peaks.length / config.repetitions, true);
          if (phase.peaks.length >= config.repetitions) {
            const active = median(phase.peaks) ?? phase.neutral;
            phases.delete(playerId);
            events.push({
              type: "calibration-complete",
              playerId,
              levels: { neutral: phase.neutral, active },
            });
            return;
          }
        }
      }
    }
    if (t - phase.startedAt >= config.gestureTimeoutMs) {
      fail(events, playerId, phase.peaks.length === 0 ? "gesture-not-detected" : "timeout");
    }
  }

  return {
    isActive: () => phases.size > 0,
    includes: (playerId) => phases.has(playerId),
    activePlayers: () => [...phases.keys()],
    begin(timestampMs) {
      assignStartedAt = timestampMs;
      readySince = null;
      const events: CalibrationRunEvent[] = [];
      if (phases.size > 0) progress(events, null, "assign-players", 0, true);
      return events;
    },
    update(input) {
      const events: CalibrationRunEvent[] = [];
      if (phases.size === 0) return events;
      if (inAssign()) {
        updateAssign(input, events);
        return events;
      }
      for (const [playerId, phase] of [...phases]) {
        const player = input.players[playerId];
        if (player.tracking === "lost") {
          fail(events, playerId, "face-lost");
          continue;
        }
        if (phase.kind === "neutral")
          updateNeutral(playerId, phase, player, input.timestampMs, events);
        else if (phase.kind === "gesture")
          updateGesture(playerId, phase, player, input.timestampMs, events);
      }
      return events;
    },
    restartMeasurements(timestampMs) {
      const events: CalibrationRunEvent[] = [];
      if (inAssign()) return events;
      for (const playerId of [...phases.keys()]) startNeutral(events, playerId, timestampMs);
      return events;
    },
    restartAssignment(timestampMs) {
      for (const playerId of [...phases.keys()]) phases.set(playerId, { kind: "assign" });
      return this.begin(timestampMs);
    },
    cancel(reason) {
      const events: CalibrationRunEvent[] = [];
      if (phases.size === 0) return events;
      if (inAssign()) events.push({ type: "calibration-failed", playerId: null, reason });
      else {
        for (const playerId of phases.keys()) {
          events.push({ type: "calibration-failed", playerId, reason });
        }
      }
      phases.clear();
      return events;
    },
    remove(playerId) {
      phases.delete(playerId);
    },
    status(playerId) {
      const phase = phases.get(playerId);
      if (!phase) return null;
      if (phase.kind === "assign") {
        return {
          step: "assign-players",
          neutral: null,
          noise: null,
          peakThreshold: null,
          peaks: [],
        };
      }
      if (phase.kind === "neutral") {
        return { step: "neutral", neutral: null, noise: null, peakThreshold: null, peaks: [] };
      }
      return {
        step: "gesture",
        neutral: phase.neutral,
        noise: phase.noise,
        peakThreshold: phase.threshold,
        peaks: [...phase.peaks],
      };
    },
  };
}
