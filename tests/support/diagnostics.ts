import { DEFAULT_PLAYER_GESTURES } from "../../src/shared";
import type {
  GestureDiagnostics,
  PlayerId,
  PlayerVisionDiagnostics,
  VisionDiagnostics,
} from "../../src/shared";

type PlayerOverrides = Partial<Omit<PlayerVisionDiagnostics, "playerId" | "gesture">> & {
  readonly gesture?: Partial<GestureDiagnostics>;
};

export function createPlayerDiagnostics(
  playerId: PlayerId,
  overrides: PlayerOverrides = {},
): PlayerVisionDiagnostics {
  const { gesture, ...rest } = overrides;
  return {
    playerId,
    tracking: "unassigned",
    faceRect: null,
    lastSeenAt: null,
    ...rest,
    gesture: {
      gesture: DEFAULT_PLAYER_GESTURES[playerId],
      rawMetric: null,
      score: null,
      enterThreshold: 0.6,
      exitThreshold: 0.35,
      state: "disarmed",
      cooldownRemainingMs: 0,
      lastGestureAt: null,
      calibration: "none",
      ...gesture,
    },
  };
}

export function createDiagnostics(overrides: Partial<VisionDiagnostics> = {}): VisionDiagnostics {
  return {
    status: "idle",
    mirrored: true,
    facesDetected: 0,
    players: { 1: createPlayerDiagnostics(1), 2: createPlayerDiagnostics(2) },
    unassignedFaces: [],
    processingFps: null,
    inferenceMs: null,
    frameTimestamp: null,
    ...overrides,
  };
}
