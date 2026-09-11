import { assertNever, type GestureDetectorState, type TimestampMs } from "../../shared";
import type { GestureTuning } from "../config";

/**
 * Time-based gesture state machine (docs/architecture.md §10.4):
 *
 * ```text
 * disarmed ──score ≤ exit──► idle ──score ≥ enter──► pending ──held ≥ minActiveMs, cooldown over──► active
 *                             ▲  ▲                     │ score < enter or null (no event)          │
 *                             │  └─────────────────────┘                                            │
 *                             └────────────────────────────── score ≤ exit ◄────────────────────────┘
 * ```
 *
 * - One event, on entering `active`. Holding the gesture emits nothing; the score must fall to
 *   the exit threshold (eyes reopened, mouth closed) before the next activation.
 * - `pending` waits until the cooldown is over; the gesture must still be held then.
 * - A `null` score (face not visible, quality gate failed) never advances the state, and
 *   cancels `pending`.
 * - Uses timestamps, not frame counts, so it behaves the same at any frame rate.
 */
export interface GestureStateMachine {
  readonly state: GestureDetectorState;
  /** Timestamp of the last event, or null. */
  readonly lastEventAt: TimestampMs | null;
  /** Feeds one smoothed score. Returns true exactly when the gesture fires. */
  update(score: number | null, timestampMs: TimestampMs): boolean;
  /** Enters `disarmed`: after start, calibration, or losing or reacquiring a face. */
  disarm(): void;
  cooldownRemainingMs(timestampMs: TimestampMs): number;
}

export function createGestureStateMachine(tuning: GestureTuning): GestureStateMachine {
  let state: GestureDetectorState = "disarmed";
  let pendingSince = 0;
  let lastEventAt: TimestampMs | null = null;

  const cooldownOver = (timestampMs: TimestampMs): boolean =>
    lastEventAt === null || timestampMs - lastEventAt >= tuning.cooldownMs;

  const evaluatePending = (timestampMs: TimestampMs): boolean => {
    if (timestampMs - pendingSince >= tuning.minActiveMs && cooldownOver(timestampMs)) {
      state = "active";
      lastEventAt = timestampMs;
      return true;
    }
    return false;
  };

  return {
    get state(): GestureDetectorState {
      return state;
    },
    get lastEventAt(): TimestampMs | null {
      return lastEventAt;
    },
    update(score, timestampMs) {
      switch (state) {
        case "disarmed":
          if (score !== null && score <= tuning.exitThreshold) state = "idle";
          return false;
        case "idle":
          if (score === null || score < tuning.enterThreshold) return false;
          state = "pending";
          pendingSince = timestampMs;
          return evaluatePending(timestampMs);
        case "pending":
          if (score === null || score < tuning.enterThreshold) {
            state = "idle";
            return false;
          }
          return evaluatePending(timestampMs);
        case "active":
          if (score !== null && score <= tuning.exitThreshold) state = "idle";
          return false;
        default:
          return assertNever(state);
      }
    },
    disarm() {
      state = "disarmed";
    },
    cooldownRemainingMs(timestampMs) {
      if (lastEventAt === null) return 0;
      return Math.max(0, lastEventAt + tuning.cooldownMs - timestampMs);
    },
  };
}
