import { DEFAULT_PLAYER_GESTURES, PLAYER_IDS } from "../../src/shared";
import type {
  AssignmentReason,
  CalibrationFailureReason,
  CalibrationMode,
  CalibrationStep,
  GestureKind,
  Listener,
  PlayerId,
  PlayerVisionDiagnostics,
  TimestampMs,
  Unsubscribe,
  VisionDiagnostics,
  VisionErrorCode,
  VisionEvent,
  VisionSession,
  VisionSessionFactory,
  VisionSessionOptions,
  VisionStartResult,
  VisionStatus,
} from "../../src/shared";
import { createDiagnostics } from "./diagnostics";
import { ListenerList } from "./listeners";

export type FakeVisionCall =
  | {
      readonly method:
        "start" | "stop" | "dispose" | "cancelCalibration" | "swapPlayers" | "resetAssignment";
    }
  | {
      readonly method: "startCalibration" | "useDefaultCalibration";
      readonly players: readonly PlayerId[];
    };

/** Controls a start() call that the test resolves by hand (see FakeVisionSession.holdNextStart). */
export interface PendingStart {
  /** Emit status-changed to loading-model, as the real session does after camera access. */
  loadModel(): void;
  /** Finish the held start() with this result (default `{ ok: true }`). */
  resolve(result?: VisionStartResult): void;
  readonly settled: boolean;
}

export function visionError(code: VisionErrorCode, message = `fake ${code}`): VisionStartResult {
  return { ok: false, error: { code, message } };
}

/** Error codes that happen after camera access succeeded, i.e. while loading the model. */
const MODEL_PHASE_ERRORS: ReadonlySet<VisionErrorCode> = new Set([
  "model-load-failed",
  "inference-failed",
]);

interface StartAttempt {
  loaded: boolean;
  settled: boolean;
  finish: ((result: VisionStartResult) => void) | null;
}

/**
 * A scriptable VisionSession that follows the contract TSDoc in src/shared/vision.ts:
 *
 * - `start()` never rejects. It moves idle → requesting-camera → (loading-model) → running or
 *   error, emitting `status-changed` for each step, plus an `error` event on failure. Results
 *   come from `queueStartResult` (default `{ ok: true }`); `holdNextStart` keeps the session in
 *   the loading states until the test resolves it.
 * - `stop()` is idempotent, returns to idle and emits nothing afterwards: events passed to
 *   `emit` while idle or disposed are dropped. The session can be started again. Stopping
 *   during a held start resolves that start with `{ ok: false }`.
 * - `dispose()` stops, and the session can no longer be started.
 * - When running, `useDefaultCalibration` emits `calibration-complete` (`mode: "default"`) per
 *   player and `swapPlayers` emits `players-assigned` (`reason: "swapped"`), as described in
 *   docs/architecture.md §9 and §10.2. `startCalibration` while not running emits
 *   `calibration-failed` (`reason: "not-running"`); `cancelCalibration` during a calibration
 *   emits `calibration-failed` (`reason: "cancelled"`). Other calibration outcomes are scripted
 *   with `progressCalibration`, `completeCalibration` and `failCalibration`.
 */
export class FakeVisionSession implements VisionSession {
  readonly options: VisionSessionOptions | null;
  readonly calls: FakeVisionCall[] = [];
  disposed = false;
  /** Players of the calibration in progress, or null. */
  calibrating: readonly PlayerId[] | null = null;
  /** Timestamp used for events the fake creates itself. Tests may change it. */
  now: TimestampMs = 0;
  private status: VisionStatus = "idle";
  private diagnostics: VisionDiagnostics = createDiagnostics();
  private readonly startResults: VisionStartResult[] = [];
  private nextHold: StartAttempt | null = null;
  private current: StartAttempt | null = null;
  private readonly listeners = new ListenerList<VisionEvent>();

  constructor(options: VisionSessionOptions | null = null) {
    this.options = options;
  }

  get startCalls(): number {
    return this.count("start");
  }

  get stopCalls(): number {
    return this.count("stop");
  }

  get disposeCalls(): number {
    return this.count("dispose");
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  count(method: FakeVisionCall["method"]): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  // ---- VisionSession ----

  start(): Promise<VisionStartResult> {
    this.calls.push({ method: "start" });
    if (this.disposed) return Promise.resolve(visionError("unknown", "session disposed"));
    if (this.status === "running") return Promise.resolve({ ok: true });

    const attempt: StartAttempt = this.nextHold ?? { loaded: false, settled: false, finish: null };
    const held = this.nextHold !== null;
    this.nextHold = null;
    this.current = attempt;
    this.setStatus("requesting-camera");

    return new Promise<VisionStartResult>((resolvePromise) => {
      attempt.finish = (result) => {
        if (attempt.settled) return;
        attempt.settled = true;
        if (this.current === attempt) this.current = null;
        if (result.ok) {
          if (!attempt.loaded) this.setStatus("loading-model");
          this.setStatus("running");
        } else if (!this.disposed && this.status !== "idle") {
          if (!attempt.loaded && MODEL_PHASE_ERRORS.has(result.error.code)) {
            this.setStatus("loading-model");
          }
          this.setStatus("error");
          this.deliver({ type: "error", error: result.error, timestamp: this.now });
        }
        resolvePromise(result);
      };
      if (!held) attempt.finish(this.startResults.shift() ?? { ok: true });
    });
  }

  stop(): Promise<void> {
    this.calls.push({ method: "stop" });
    this.halt();
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.calls.push({ method: "dispose" });
    this.halt();
    this.disposed = true;
    return Promise.resolve();
  }

  getStatus(): VisionStatus {
    return this.status;
  }

  subscribe(listener: Listener<VisionEvent>): Unsubscribe {
    return this.listeners.add(listener);
  }

  startCalibration(players: readonly PlayerId[] = PLAYER_IDS): void {
    this.calls.push({ method: "startCalibration", players: [...players] });
    if (this.status !== "running") {
      this.deliver({
        type: "calibration-failed",
        playerId: null,
        reason: "not-running",
        timestamp: this.now,
      });
      return;
    }
    this.calibrating = [...players];
  }

  cancelCalibration(): void {
    this.calls.push({ method: "cancelCalibration" });
    if (this.calibrating === null) return;
    this.calibrating = null;
    this.emit({
      type: "calibration-failed",
      playerId: null,
      reason: "cancelled",
      timestamp: this.now,
    });
  }

  useDefaultCalibration(players: readonly PlayerId[] = PLAYER_IDS): void {
    this.calls.push({ method: "useDefaultCalibration", players: [...players] });
    if (this.status !== "running") return;
    for (const playerId of players) this.completeCalibration(playerId, "default");
  }

  swapPlayers(): void {
    this.calls.push({ method: "swapPlayers" });
    if (this.status !== "running") return;
    const { players } = this.diagnostics;
    this.diagnostics = {
      ...this.diagnostics,
      players: { 1: { ...players[2], playerId: 1 }, 2: { ...players[1], playerId: 2 } },
    };
    this.emit({ type: "players-assigned", reason: "swapped", timestamp: this.now });
  }

  resetAssignment(): void {
    this.calls.push({ method: "resetAssignment" });
  }

  getDiagnostics(): VisionDiagnostics {
    return this.diagnostics;
  }

  // ---- Scripting helpers (not part of VisionSession) ----

  /** Results for the next start() calls, in order. Default: `{ ok: true }`. */
  queueStartResult(...results: VisionStartResult[]): void {
    this.startResults.push(...results);
  }

  /** The next start() stays in requesting-camera until the returned handle resolves it. */
  holdNextStart(): PendingStart {
    const attempt: StartAttempt = { loaded: false, settled: false, finish: null };
    this.nextHold = attempt;
    return {
      loadModel: () => {
        if (!attempt.finish || attempt.settled || attempt.loaded) return;
        attempt.loaded = true;
        this.setStatus("loading-model");
      },
      resolve: (result = { ok: true }) => {
        if (!attempt.finish) throw new Error("start() has not been called yet");
        attempt.finish(result);
      },
      get settled() {
        return attempt.settled;
      },
    };
  }

  /** Deliver an event as the real session would. Dropped (returns false) while idle or disposed. */
  emit(event: VisionEvent): boolean {
    if (this.disposed || this.status === "idle") return false;
    this.listeners.emit(event);
    return true;
  }

  gesture(playerId: PlayerId, gesture?: GestureKind, timestamp: TimestampMs = this.now): boolean {
    const gestures = this.options?.playerGestures ?? DEFAULT_PLAYER_GESTURES;
    this.setPlayer(playerId, {
      gesture: { ...this.diagnostics.players[playerId].gesture, lastGestureAt: timestamp },
    });
    return this.emit({
      type: "gesture",
      playerId,
      gesture: gesture ?? gestures[playerId],
      timestamp,
    });
  }

  facesChanged(count: number): boolean {
    this.diagnostics = { ...this.diagnostics, facesDetected: count };
    return this.emit({ type: "faces-changed", count, timestamp: this.now });
  }

  assignPlayers(reason: AssignmentReason = "calibration"): boolean {
    for (const playerId of PLAYER_IDS) this.setPlayer(playerId, { tracking: "tracked" });
    return this.emit({ type: "players-assigned", reason, timestamp: this.now });
  }

  faceLost(playerId: PlayerId): boolean {
    this.setPlayer(playerId, { tracking: "lost", faceRect: null });
    return this.emit({ type: "face-lost", playerId, timestamp: this.now });
  }

  faceFound(playerId: PlayerId): boolean {
    this.setPlayer(playerId, { tracking: "tracked" });
    return this.emit({ type: "face-found", playerId, timestamp: this.now });
  }

  progressCalibration(playerId: PlayerId | null, step: CalibrationStep, progress: number): boolean {
    return this.emit({
      type: "calibration-progress",
      playerId,
      step,
      progress,
      timestamp: this.now,
    });
  }

  completeCalibration(playerId: PlayerId, mode: CalibrationMode = "calibrated"): boolean {
    const gesture = this.diagnostics.players[playerId].gesture;
    this.setPlayer(playerId, {
      tracking: "tracked",
      gesture: { ...gesture, calibration: mode, state: "disarmed" },
    });
    if (this.calibrating) {
      const remaining = this.calibrating.filter((id) => id !== playerId);
      this.calibrating = remaining.length > 0 ? remaining : null;
    }
    return this.emit({ type: "calibration-complete", playerId, mode, timestamp: this.now });
  }

  failCalibration(playerId: PlayerId | null, reason: CalibrationFailureReason): boolean {
    this.calibrating = null;
    return this.emit({ type: "calibration-failed", playerId, reason, timestamp: this.now });
  }

  /** Simulate a runtime failure, e.g. the camera track ended (the default). */
  fail(code: VisionErrorCode = "camera-disconnected"): void {
    this.calibrating = null;
    this.setStatus("error");
    this.deliver({ type: "error", error: { code, message: `fake ${code}` }, timestamp: this.now });
  }

  setDiagnostics(overrides: Partial<VisionDiagnostics>): void {
    this.diagnostics = { ...this.diagnostics, ...overrides };
  }

  setPlayer(
    playerId: PlayerId,
    overrides: Partial<Omit<PlayerVisionDiagnostics, "playerId">>,
  ): void {
    const players = this.diagnostics.players;
    const updated = { ...players[playerId], ...overrides, playerId };
    this.diagnostics = {
      ...this.diagnostics,
      players: playerId === 1 ? { 1: updated, 2: players[2] } : { 1: players[1], 2: updated },
    };
  }

  private halt(): void {
    this.calibrating = null;
    const current = this.current;
    if (current?.finish) {
      // Resolve after leaving the running states so no error event is emitted.
      this.current = null;
      if (this.status !== "idle") this.setStatus("idle");
      current.finish(visionError("unknown", "stopped while starting"));
    }
    if (this.status !== "idle") this.setStatus("idle");
  }

  private setStatus(status: VisionStatus): void {
    const previous = this.status;
    if (previous === status) return;
    this.status = status;
    this.diagnostics = { ...this.diagnostics, status };
    this.deliver({ type: "status-changed", status, previous, timestamp: this.now });
  }

  /** Deliver regardless of status; used for the session's own lifecycle events. */
  private deliver(event: VisionEvent): void {
    if (this.disposed) return;
    this.listeners.emit(event);
  }
}

export interface FakeVisionFactory {
  readonly factory: VisionSessionFactory;
  readonly sessions: FakeVisionSession[];
  /** The most recently created session; throws when the factory has not been called. */
  readonly session: FakeVisionSession;
}

/** A VisionSessionFactory that records every session it creates. */
export function createFakeVisionFactory(
  configure?: (session: FakeVisionSession) => void,
): FakeVisionFactory {
  const sessions: FakeVisionSession[] = [];
  return {
    factory: (options) => {
      const session = new FakeVisionSession(options);
      configure?.(session);
      sessions.push(session);
      return session;
    },
    sessions,
    get session() {
      const last = sessions.at(-1);
      if (!last) throw new Error("createVisionSession has not been called");
      return last;
    },
  };
}
