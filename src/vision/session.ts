// Composes camera, detector, assignment, gestures and calibration into a VisionSession.
import {
  DEFAULT_PLAYER_GESTURES,
  PLAYER_IDS,
  assertNever,
  type Listener,
  type PerPlayer,
  type PlayerId,
  type PlayerVisionDiagnostics,
  type TimestampMs,
  type Unsubscribe,
  type VisionDiagnostics,
  type VisionError,
  type VisionErrorCode,
  type VisionEvent,
  type VisionSession,
  type VisionSessionOptions,
  type VisionStartResult,
  type VisionStatus,
} from "../shared";
import {
  createFaceAssigner,
  type AssignerEvent,
  type AssignmentFrame,
  type FaceAssigner,
} from "./assignment/assigner";
import { observeFace, type FaceObservation } from "./assignment/observation";
import {
  createCalibrationRun,
  type CalibrationPlayerStatus,
  type CalibrationRun,
  type CalibrationRunEvent,
} from "./calibration/calibration";
import { CameraError } from "./camera/camera";
import {
  DEFAULT_VISION_CONFIG,
  validateVisionConfig,
  type MetricLevels,
  type MetricTuning,
  type VisionConfig,
} from "./config";
import { createFrameStats } from "./diagnostics/frame-stats";
import { describeError } from "./errors";
import { isUsableFrame } from "./geometry/geometry";
import { metricFunction } from "./gestures/metrics";
import {
  createGesturePipeline,
  type GestureFrame,
  type GesturePipeline,
  type QualityGateResult,
} from "./gestures/pipeline";
import type {
  CameraAdapter,
  Clock,
  DetectedFace,
  FrameSize,
  LandmarkDetector,
  LandmarkDetectorLoader,
  VideoFrameScheduler,
} from "./types";

/** Everything the session needs from the outside world; all replaceable by fakes. */
export interface VisionSessionDeps {
  readonly camera: CameraAdapter;
  readonly loadDetector: LandmarkDetectorLoader;
  readonly frames: VideoFrameScheduler;
  readonly now: Clock;
  /** Production: isCameraSupported (API present and secure context). */
  readonly isSupported: () => boolean;
}

/** One detected face in the last processed frame (dev-only debug view). */
export interface VisionDebugFace {
  readonly face: DetectedFace;
  readonly observation: FaceObservation;
  readonly playerId: PlayerId | null;
}

export interface VisionDebugPlayer {
  readonly gate: QualityGateResult;
  readonly measuredMetric: number | null;
  readonly smoothedMetric: number | null;
  /** Metric levels the score is computed from (calibrated, or defaults). */
  readonly levels: MetricLevels;
  readonly calibrating: CalibrationPlayerStatus | null;
}

/** Dev-only snapshot for the Vision Lab: includes landmarks. In memory only; cleared by stop(). */
export interface VisionDebugSnapshot {
  readonly frame: FrameSize | null;
  readonly mirrored: boolean;
  readonly locked: boolean;
  readonly lockProgress: number;
  readonly faces: readonly VisionDebugFace[];
  readonly players: PerPlayer<VisionDebugPlayer>;
}

export interface InternalVisionSession extends VisionSession {
  getDebugSnapshot(): VisionDebugSnapshot;
}

const START_OK: VisionStartResult = Object.freeze({ ok: true });

function cancelledStart(): VisionStartResult {
  return {
    ok: false,
    error: { code: "unknown", message: "start() was superseded by stop() or dispose()." },
  };
}

function toVisionEvent(event: AssignerEvent, timestamp: TimestampMs): VisionEvent {
  switch (event.type) {
    case "faces-changed":
      return { type: "faces-changed", count: event.count, timestamp };
    case "players-assigned":
      return { type: "players-assigned", reason: event.reason, timestamp };
    case "face-lost":
      return { type: "face-lost", playerId: event.playerId, timestamp };
    case "face-found":
      return { type: "face-found", playerId: event.playerId, timestamp };
    default:
      return assertNever(event);
  }
}

function reportListenerError(error: unknown): void {
  // A throwing listener must not break the pipeline or starve later listeners.
  queueMicrotask(() => {
    throw error;
  });
}

interface ListenerEntry {
  readonly listener: Listener<VisionEvent>;
  active: boolean;
}

/**
 * Internal factory with injected dependencies and configuration (tests, Vision Lab).
 * `createVisionSession` in index.ts wires the production dependencies.
 *
 * Event order within one frame: `faces-changed`, `players-assigned`, `face-lost`/`face-found`,
 * calibration events, then `gesture`. Failures emit `error` and then `status-changed`.
 */
export function createVisionSessionWith(
  deps: VisionSessionDeps,
  options: VisionSessionOptions,
  config: VisionConfig = DEFAULT_VISION_CONFIG,
): InternalVisionSession {
  validateVisionConfig(config);
  const { video, mirrored } = options;
  const gestures = options.playerGestures ?? DEFAULT_PLAYER_GESTURES;
  const metricTuning = (playerId: PlayerId): MetricTuning =>
    config.metrics[config.metricSource][gestures[playerId]];
  const makePipeline = (playerId: PlayerId): GesturePipeline =>
    createGesturePipeline({
      gesture: gestures[playerId],
      metric: metricFunction(gestures[playerId], config.metricSource),
      tuning: config.gestures[gestures[playerId]],
      metricTuning: metricTuning(playerId),
      quality: config.quality,
      smoothingTauMs: config.smoothingTauMs,
    });
  const pipelines: PerPlayer<GesturePipeline> = { 1: makePipeline(1), 2: makePipeline(2) };
  const stats = createFrameStats();

  let status: VisionStatus = "idle";
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  /** Incremented whenever running work must be abandoned (stop, dispose, runtime failure). */
  let generation = 0;
  let startPromise: Promise<VisionStartResult> | null = null;
  let detector: LandmarkDetector | null = null;
  let detectorPromise: Promise<LandmarkDetector> | null = null;
  let cancelFrame: (() => void) | null = null;
  let detachTrackListeners: (() => void) | null = null;
  let consecutiveErrors = 0;
  /** Last timestamp given to the detector; kept across restarts because the model persists. */
  let lastDetectTimestamp = -Infinity;
  let assigner: FaceAssigner = createFaceAssigner(config.assignment);
  let calibration: CalibrationRun | null = null;
  let entries: ListenerEntry[] = [];

  // Last processed frame, for diagnostics.
  let lastAssignment: AssignmentFrame | null = null;
  let lastObservations: readonly FaceObservation[] = [];
  let lastObservedFaces: readonly DetectedFace[] = [];
  let lastFrame: FrameSize | null = null;
  let lastFrameTimestamp: TimestampMs | null = null;
  let facesDetected = 0;

  function emit(events: readonly VisionEvent[], gen: number): void {
    for (const event of events) {
      for (const entry of entries) {
        if (gen !== generation) return;
        if (!entry.active) continue;
        try {
          entry.listener(event);
        } catch (error) {
          reportListenerError(error);
        }
      }
    }
  }

  function transition(next: VisionStatus, gen: number): void {
    const previous = status;
    if (previous === next) return;
    status = next;
    emit([{ type: "status-changed", status: next, previous, timestamp: deps.now() }], gen);
  }

  function syncSuspension(): void {
    for (const playerId of PLAYER_IDS) {
      pipelines[playerId].setSuspended(calibration?.includes(playerId) ?? false);
    }
  }

  function calibrationEvents(
    runEvents: readonly CalibrationRunEvent[],
    timestamp: TimestampMs,
  ): VisionEvent[] {
    const events: VisionEvent[] = [];
    for (const event of runEvents) {
      if (event.type === "calibration-complete") {
        pipelines[event.playerId].setCalibration({ levels: event.levels, mode: "calibrated" });
        events.push({
          type: "calibration-complete",
          playerId: event.playerId,
          mode: "calibrated",
          timestamp,
        });
      } else {
        events.push({ ...event, timestamp });
      }
    }
    if (calibration !== null && !calibration.isActive()) calibration = null;
    syncSuspension();
    return events;
  }

  function cancelCalibrationRun(
    reason: "cancelled" | "not-running",
    timestamp: TimestampMs,
  ): VisionEvent[] {
    if (calibration === null) return [];
    const runEvents = calibration.cancel(reason);
    calibration = null;
    return calibrationEvents(runEvents, timestamp);
  }

  function resetRunState(): void {
    assigner = createFaceAssigner(config.assignment);
    stats.reset();
    consecutiveErrors = 0;
    lastAssignment = null;
    lastObservations = [];
    lastObservedFaces = [];
    lastFrame = null;
    lastFrameTimestamp = null;
    facesDetected = 0;
    for (const playerId of PLAYER_IDS) pipelines[playerId].resetSignal();
  }

  function teardownMedia(): void {
    cancelFrame?.();
    cancelFrame = null;
    detachTrackListeners?.();
    detachTrackListeners = null;
    deps.camera.close();
    video.srcObject = null;
  }

  function attachStream(stream: MediaStream, gen: number): void {
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const tracks = stream.getVideoTracks();
    const onEnded = (): void => {
      if (gen !== generation || status !== "running") return;
      failRuntime("camera-disconnected", "The camera track ended (device unplugged or revoked).");
    };
    for (const track of tracks) track.addEventListener("ended", onEnded);
    detachTrackListeners = () => {
      for (const track of tracks) track.removeEventListener("ended", onEnded);
    };
    // Muted inline playback is allowed without a gesture; a failure only means no frames yet.
    void video.play().catch(() => undefined);
  }

  function failStart(gen: number, error: VisionError): VisionStartResult {
    if (gen !== generation) return cancelledStart();
    teardownMedia();
    const timestamp = deps.now();
    const previous = status;
    status = "error";
    emit(
      [
        { type: "error", error, timestamp },
        { type: "status-changed", status: "error", previous, timestamp },
      ],
      gen,
    );
    return { ok: false, error };
  }

  /** A failure while running: stop everything, then report `error` and `status-changed`. */
  function failRuntime(code: VisionErrorCode, message: string): void {
    const timestamp = deps.now();
    generation++;
    const gen = generation;
    teardownMedia();
    const events = cancelCalibrationRun("not-running", timestamp);
    for (const playerId of PLAYER_IDS) pipelines[playerId].resetSignal();
    const previous = status;
    status = "error";
    events.push(
      { type: "error", error: { code, message }, timestamp },
      { type: "status-changed", status: "error", previous, timestamp },
    );
    emit(events, gen);
  }

  function ensureDetector(): Promise<LandmarkDetector> {
    if (detector !== null) return Promise.resolve(detector);
    if (detectorPromise === null) {
      const loading: Promise<LandmarkDetector> = deps.loadDetector().then(
        (loaded) => {
          if (disposed) {
            loaded.close();
            throw new Error("The session was disposed while the model was loading.");
          }
          detector = loaded;
          return loaded;
        },
        (error: unknown) => {
          if (detectorPromise === loading) detectorPromise = null;
          throw error;
        },
      );
      detectorPromise = loading;
      // The load runs in parallel with the camera request; nobody may be awaiting it yet.
      void loading.catch(() => undefined);
    }
    return detectorPromise;
  }

  async function runStart(gen: number): Promise<VisionStartResult> {
    if (!deps.isSupported()) {
      return failStart(gen, {
        code: "camera-unsupported",
        message:
          "navigator.mediaDevices.getUserMedia is unavailable, or the page is not a secure context (HTTPS or localhost).",
      });
    }
    transition("requesting-camera", gen);
    // The camera is requested synchronously inside the caller's click handler; the model
    // loads in parallel.
    const cameraRequest = deps.camera.open();
    const detectorRequest = ensureDetector();

    let stream: MediaStream;
    try {
      stream = await cameraRequest;
    } catch (error) {
      if (gen !== generation) return cancelledStart();
      return failStart(
        gen,
        error instanceof CameraError
          ? error.visionError
          : { code: "unknown", message: describeError(error) },
      );
    }
    if (gen !== generation) {
      deps.camera.close();
      return cancelledStart();
    }

    transition("loading-model", gen);
    try {
      await detectorRequest;
    } catch (error) {
      if (gen !== generation) return cancelledStart();
      return failStart(gen, { code: "model-load-failed", message: describeError(error) });
    }
    if (gen !== generation) return cancelledStart();

    resetRunState();
    attachStream(stream, gen);
    transition("running", gen);
    scheduleNextFrame(gen);
    return START_OK;
  }

  function start(): Promise<VisionStartResult> {
    if (disposed) {
      return Promise.resolve({
        ok: false,
        error: { code: "unknown", message: "The session has been disposed." },
      });
    }
    if (status === "running") return Promise.resolve(START_OK);
    if (startPromise !== null) return startPromise;
    const gen = generation;
    const promise = runStart(gen).catch((error: unknown): VisionStartResult =>
      failStart(gen, { code: "unknown", message: describeError(error) }),
    );
    startPromise = promise;
    void promise.then(() => {
      if (startPromise === promise) startPromise = null;
    });
    return promise;
  }

  function stop(): Promise<void> {
    if (status === "idle" && startPromise === null) return Promise.resolve();
    generation++;
    const gen = generation;
    const timestamp = deps.now();
    startPromise = null;
    const events = cancelCalibrationRun("cancelled", timestamp);
    teardownMedia();
    resetRunState();
    for (const playerId of PLAYER_IDS) pipelines[playerId].setCalibration(null);
    const previous = status;
    status = "idle";
    if (previous !== "idle") {
      events.push({ type: "status-changed", status: "idle", previous, timestamp });
    }
    emit(events, gen);
    return Promise.resolve();
  }

  function dispose(): Promise<void> {
    if (disposePromise !== null) return disposePromise;
    disposed = true;
    disposePromise = (async () => {
      await stop();
      if (detectorPromise !== null) {
        try {
          await detectorPromise;
        } catch {
          // The model never loaded; nothing to release.
        }
      }
      detector?.close();
      detector = null;
      detectorPromise = null;
      for (const entry of entries) entry.active = false;
      entries = [];
    })();
    return disposePromise;
  }

  function scheduleNextFrame(gen: number): void {
    if (gen !== generation || status !== "running") return;
    cancelFrame = deps.frames.request(video, (timestampMs) => {
      cancelFrame = null;
      onVideoFrame(timestampMs, gen);
    });
  }

  function onInferenceError(error: unknown, gen: number): void {
    consecutiveErrors++;
    if (consecutiveErrors >= config.maxConsecutiveInferenceErrors) {
      failRuntime("inference-failed", describeError(error));
    } else {
      scheduleNextFrame(gen);
    }
  }

  function onVideoFrame(frameTimestamp: TimestampMs, gen: number): void {
    if (gen !== generation || status !== "running" || detector === null) return;
    const frame: FrameSize = { width: video.videoWidth, height: video.videoHeight };
    if (!isUsableFrame(frame)) {
      scheduleNextFrame(gen);
      return;
    }
    // MediaPipe requires strictly increasing timestamps.
    const timestamp =
      frameTimestamp > lastDetectTimestamp ? frameTimestamp : lastDetectTimestamp + 1;
    lastDetectTimestamp = timestamp;
    const startedAt = deps.now();
    let result: readonly DetectedFace[] | Promise<readonly DetectedFace[]>;
    try {
      result = detector.detect(video, timestamp);
    } catch (error) {
      onInferenceError(error, gen);
      return;
    }
    if (result instanceof Promise) {
      // At most one inference in flight: the next frame is requested only when it settles.
      result.then(
        (faces) => {
          if (gen !== generation) return;
          processDetections(faces, frame, timestamp, deps.now() - startedAt, gen);
          scheduleNextFrame(gen);
        },
        (error: unknown) => {
          if (gen !== generation) return;
          onInferenceError(error, gen);
        },
      );
      return;
    }
    processDetections(result, frame, timestamp, deps.now() - startedAt, gen);
    scheduleNextFrame(gen);
  }

  function processDetections(
    faces: readonly DetectedFace[],
    frame: FrameSize,
    timestamp: TimestampMs,
    inferenceMs: number,
    gen: number,
  ): void {
    consecutiveErrors = 0;
    stats.record(timestamp, inferenceMs);

    const observations: FaceObservation[] = [];
    const observedFaces: DetectedFace[] = [];
    for (const face of faces) {
      const observation = observeFace(face, frame, mirrored);
      if (observation === null) continue;
      observations.push(observation);
      observedFaces.push(face);
    }

    const assignment = assigner.update(observations, timestamp);
    const events: VisionEvent[] = assignment.events.map((event) => toVisionEvent(event, timestamp));
    for (const playerId of assignment.rearm) pipelines[playerId].disarm();

    const results = {} as Record<PlayerId, GestureFrame>;
    for (const playerId of PLAYER_IDS) {
      const index = assignment.players[playerId].faceIndex;
      const face = index === null ? null : (observedFaces[index] ?? null);
      const widthPx = index === null ? 0 : (observations[index]?.widthPx ?? 0);
      results[playerId] = pipelines[playerId].process(face, widthPx, frame, timestamp);
    }

    if (calibration !== null) {
      const runEvents = calibration.update({
        timestampMs: timestamp,
        locked: assigner.isLocked(),
        lockProgress: assigner.lockProgress(),
        players: {
          1: {
            tracking: assignment.players[1].tracking,
            rawMetric: results[1].rawMetric,
            smoothedMetric: results[1].smoothedMetric,
          },
          2: {
            tracking: assignment.players[2].tracking,
            rawMetric: results[2].rawMetric,
            smoothedMetric: results[2].smoothedMetric,
          },
        },
      });
      events.push(...calibrationEvents(runEvents, timestamp));
    }

    for (const playerId of PLAYER_IDS) {
      if (results[playerId].fired) {
        events.push({ type: "gesture", playerId, gesture: gestures[playerId], timestamp });
      }
    }

    lastAssignment = assignment;
    lastObservations = observations;
    lastObservedFaces = observedFaces;
    lastFrame = frame;
    lastFrameTimestamp = timestamp;
    facesDetected = faces.length;
    emit(events, gen);
  }

  function requestedPlayers(players: readonly PlayerId[] | undefined): PlayerId[] {
    return PLAYER_IDS.filter((playerId) => (players ?? PLAYER_IDS).includes(playerId));
  }

  function startCalibration(players?: readonly PlayerId[]): void {
    if (disposed) return;
    const timestamp = deps.now();
    const gen = generation;
    if (status !== "running") {
      emit([{ type: "calibration-failed", playerId: null, reason: "not-running", timestamp }], gen);
      return;
    }
    const requested = requestedPlayers(players);
    if (requested.length === 0) return;
    calibration = createCalibrationRun({
      players: requested,
      tuning: { 1: metricTuning(1), 2: metricTuning(2) },
      config: config.calibration,
      assignmentStableMs: config.assignment.assignmentStableMs,
    });
    const runEvents = calibration.begin(timestamp);
    syncSuspension();
    emit(calibrationEvents(runEvents, timestamp), gen);
  }

  function cancelCalibration(): void {
    if (calibration === null) return;
    emit(cancelCalibrationRun("cancelled", deps.now()), generation);
  }

  function useDefaultCalibration(players?: readonly PlayerId[]): void {
    if (disposed) return;
    const timestamp = deps.now();
    const events: VisionEvent[] = [];
    for (const playerId of requestedPlayers(players)) {
      calibration?.remove(playerId);
      pipelines[playerId].setCalibration({
        levels: metricTuning(playerId).defaultLevels,
        mode: "default",
      });
      events.push({ type: "calibration-complete", playerId, mode: "default", timestamp });
    }
    if (calibration !== null && !calibration.isActive()) calibration = null;
    syncSuspension();
    emit(events, generation);
  }

  function swapPlayers(): void {
    if (status !== "running") return;
    const timestamp = deps.now();
    const events = assigner.swap().map((event) => toVisionEvent(event, timestamp));
    for (const playerId of PLAYER_IDS) pipelines[playerId].disarm();
    if (calibration !== null) {
      events.push(...calibrationEvents(calibration.restartMeasurements(timestamp), timestamp));
    }
    emit(events, generation);
  }

  function resetAssignment(): void {
    if (status !== "running") return;
    const timestamp = deps.now();
    assigner.reset();
    for (const playerId of PLAYER_IDS) pipelines[playerId].disarm();
    if (calibration !== null) {
      emit(calibrationEvents(calibration.restartAssignment(timestamp), timestamp), generation);
    }
  }

  function playerDiagnostics(playerId: PlayerId): PlayerVisionDiagnostics {
    const assignment = lastAssignment?.players[playerId];
    return {
      playerId,
      tracking: assignment?.tracking ?? "unassigned",
      faceRect: assignment?.rect ?? null,
      lastSeenAt: assignment?.lastSeenAt ?? null,
      gesture: pipelines[playerId].diagnostics(lastFrameTimestamp),
    };
  }

  function getDiagnostics(): VisionDiagnostics {
    const unassignedFaces = (lastAssignment?.unassigned ?? []).flatMap((index) => {
      const rect = lastObservations[index]?.rect;
      return rect ? [rect] : [];
    });
    return {
      status,
      mirrored,
      facesDetected,
      players: { 1: playerDiagnostics(1), 2: playerDiagnostics(2) },
      unassignedFaces,
      processingFps: stats.fps(),
      inferenceMs: stats.inferenceMs(),
      frameTimestamp: lastFrameTimestamp,
    };
  }

  function debugPlayer(playerId: PlayerId): VisionDebugPlayer {
    const pipeline = pipelines[playerId];
    return {
      gate: pipeline.last.gate,
      measuredMetric: pipeline.last.measuredMetric,
      smoothedMetric: pipeline.last.smoothedMetric,
      levels: pipeline.effectiveLevels(),
      calibrating: calibration?.status(playerId) ?? null,
    };
  }

  function getDebugSnapshot(): VisionDebugSnapshot {
    const owner = new Map<number, PlayerId>();
    for (const playerId of PLAYER_IDS) {
      const index = lastAssignment?.players[playerId].faceIndex;
      if (index !== undefined && index !== null) owner.set(index, playerId);
    }
    const faces: VisionDebugFace[] = [];
    lastObservedFaces.forEach((face, index) => {
      const observation = lastObservations[index];
      if (observation) faces.push({ face, observation, playerId: owner.get(index) ?? null });
    });
    return {
      frame: lastFrame,
      mirrored,
      locked: assigner.isLocked(),
      lockProgress: assigner.lockProgress(),
      faces,
      players: { 1: debugPlayer(1), 2: debugPlayer(2) },
    };
  }

  function subscribe(listener: Listener<VisionEvent>): Unsubscribe {
    if (disposed) return () => undefined;
    const entry: ListenerEntry = { listener, active: true };
    entries = [...entries, entry];
    return () => {
      if (!entry.active) return;
      entry.active = false;
      entries = entries.filter((candidate) => candidate !== entry);
    };
  }

  return {
    start,
    stop,
    dispose,
    getStatus: () => status,
    subscribe,
    startCalibration,
    cancelCalibration,
    useDefaultCalibration,
    swapPlayers,
    resetAssignment,
    getDiagnostics,
    getDebugSnapshot,
  };
}
