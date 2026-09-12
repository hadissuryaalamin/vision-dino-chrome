/**
 * Dev-only simulated VisionSession for `?vision=simulated`.
 *
 * src/main.ts loads this module with a dynamic import behind `import.meta.env.DEV`, so it is
 * absent from the production bundle. It never touches the camera: it drives the whole vision
 * event path (status changes, faces, assignment, calibration, gestures, errors) from timers and
 * keys, so every UI flow can be exercised by hand without a webcam.
 *
 * Keys (ignored on auto-repeat, with Ctrl/Alt/Meta, and in editable fields):
 * - `1`: Player 1 gesture (blink), `2`: Player 2 gesture (mouth opening). Like the real
 *   session, gestures fire only for a calibrated player whose face is tracked.
 * - `3` / `4`: Player 1 / Player 2 face lost ⇄ found.
 * - `5`: one ⇄ two faces in view.
 * - `6`: simulate the camera being disconnected.
 */
import { DEFAULT_PLAYER_GESTURES, PLAYER_IDS } from "../../shared";
import type {
  CalibrationMode,
  CalibrationStep,
  Listener,
  NormalizedRect,
  PerPlayer,
  PlayerId,
  PlayerTrackingState,
  PlayerVisionDiagnostics,
  VisionDiagnostics,
  VisionErrorCode,
  VisionEvent,
  VisionSession,
  VisionSessionFactory,
  VisionSessionOptions,
  VisionStartResult,
  VisionStatus,
} from "../../shared";

export interface SimulatedVisionEnvironment {
  /** Where the simulation listens for keydown events (the window in the browser). */
  readonly keyTarget: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  readonly now: () => number;
  /** Run `callback` after `ms`; returns a function that cancels it. */
  readonly schedule: (callback: () => void, ms: number) => () => void;
  /** Duration of each simulated start-up and calibration step. Default 400 ms. */
  readonly stepMs?: number;
}

/** Face positions in display space: Player 1 on the left, Player 2 on the right. */
const FACE_RECTS: PerPlayer<NormalizedRect> = {
  1: { x: 0.14, y: 0.25, width: 0.22, height: 0.4 },
  2: { x: 0.62, y: 0.25, width: 0.22, height: 0.4 },
};
const THRESHOLDS = {
  blink: { enter: 0.6, exit: 0.35 },
  "mouth-open": { enter: 0.55, exit: 0.3 },
} as const;
const EDITABLE_TAGS: ReadonlySet<string> = new Set(["INPUT", "SELECT", "TEXTAREA"]);

function isEditable(target: EventTarget | null): boolean {
  const element = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  const tag = typeof element?.tagName === "string" ? element.tagName.toUpperCase() : "";
  return EDITABLE_TAGS.has(tag) || element?.isContentEditable === true;
}

export function createSimulatedVisionSession(
  options: VisionSessionOptions,
  env: SimulatedVisionEnvironment,
): VisionSession {
  const gestures = options.playerGestures ?? DEFAULT_PLAYER_GESTURES;
  const stepMs = env.stepMs ?? 400;
  let entries: { readonly listener: Listener<VisionEvent>; active: boolean }[] = [];
  let cancels: (() => void)[] = [];
  let status: VisionStatus = "idle";
  let disposed = false;
  let pendingStart: {
    readonly promise: Promise<VisionStartResult>;
    readonly resolve: (result: VisionStartResult) => void;
  } | null = null;
  let faceCount = 2;
  let assigned = false;
  let tracking: Record<PlayerId, PlayerTrackingState> = { 1: "unassigned", 2: "unassigned" };
  let calibration: Record<PlayerId, CalibrationMode | "none"> = { 1: "none", 2: "none" };
  let lastGestureAt: Record<PlayerId, number | null> = { 1: null, 2: null };
  let calibrating: PlayerId[] = [];
  let calibrationRun = 0;
  let keysAttached = false;

  const emit = (event: VisionEvent): void => {
    for (const entry of [...entries]) if (entry.active) entry.listener(event);
  };
  const later = (ms: number, callback: () => void): void => {
    cancels.push(env.schedule(callback, ms));
  };
  const clearTimers = (): void => {
    for (const cancel of cancels) cancel();
    cancels = [];
  };
  const setStatus = (next: VisionStatus): void => {
    const previous = status;
    if (previous === next) return;
    status = next;
    emit({ type: "status-changed", status: next, previous, timestamp: env.now() });
  };

  const assign = (reason: "calibration" | "reset"): void => {
    assigned = true;
    tracking = {
      1: faceCount >= 1 ? "tracked" : "unassigned",
      2: faceCount >= 2 ? "tracked" : "unassigned",
    };
    emit({ type: "players-assigned", reason, timestamp: env.now() });
  };

  const progress = (playerId: PlayerId | null, step: CalibrationStep, value: number): void => {
    emit({ type: "calibration-progress", playerId, step, progress: value, timestamp: env.now() });
  };

  function fail(code: VisionErrorCode): void {
    if (status !== "running") return;
    const timestamp = env.now();
    clearTimers();
    detachKeys();
    if (calibrating.length > 0) {
      calibrating = [];
      calibrationRun += 1;
      emit({ type: "calibration-failed", playerId: null, reason: "not-running", timestamp });
    }
    const previous = status;
    status = "error";
    emit({ type: "error", error: { code, message: `simulated ${code}` }, timestamp });
    emit({ type: "status-changed", status: "error", previous, timestamp });
  }

  const toggleFace = (playerId: PlayerId): void => {
    if (!assigned) return;
    const lost = tracking[playerId] !== "lost";
    tracking = { ...tracking, [playerId]: lost ? "lost" : "tracked" };
    emit({ type: lost ? "face-lost" : "face-found", playerId, timestamp: env.now() });
  };

  const onKeyDown = (event: Event): void => {
    const key = event as Partial<KeyboardEvent>;
    if (key.repeat || key.ctrlKey || key.altKey || key.metaKey || isEditable(event.target)) return;
    if (status !== "running") return;
    switch (key.key) {
      case "1":
      case "2": {
        const playerId: PlayerId = key.key === "1" ? 1 : 2;
        if (calibration[playerId] === "none" || tracking[playerId] !== "tracked") return;
        const timestamp = env.now();
        lastGestureAt = { ...lastGestureAt, [playerId]: timestamp };
        emit({ type: "gesture", playerId, gesture: gestures[playerId], timestamp });
        return;
      }
      case "3":
        toggleFace(1);
        return;
      case "4":
        toggleFace(2);
        return;
      case "5":
        faceCount = faceCount === 2 ? 1 : 2;
        if (!assigned) tracking = { 1: "unassigned", 2: "unassigned" };
        emit({ type: "faces-changed", count: faceCount, timestamp: env.now() });
        return;
      case "6":
        fail("camera-disconnected");
        return;
      default:
        return;
    }
  };

  function attachKeys(): void {
    if (keysAttached) return;
    keysAttached = true;
    env.keyTarget.addEventListener("keydown", onKeyDown);
  }

  function detachKeys(): void {
    if (!keysAttached) return;
    keysAttached = false;
    env.keyTarget.removeEventListener("keydown", onKeyDown);
  }

  function start(): Promise<VisionStartResult> {
    if (disposed) {
      return Promise.resolve({ ok: false, error: { code: "unknown", message: "disposed" } });
    }
    if (status === "running") return Promise.resolve({ ok: true });
    if (pendingStart) return pendingStart.promise;

    let resolve: (result: VisionStartResult) => void = () => undefined;
    const promise = new Promise<VisionStartResult>((done) => {
      resolve = done;
    });
    pendingStart = { promise, resolve };
    setStatus("requesting-camera");
    later(stepMs, () => {
      setStatus("loading-model");
      later(stepMs, () => {
        const current = pendingStart;
        pendingStart = null;
        setStatus("running");
        attachKeys();
        current?.resolve({ ok: true });
        later(stepMs, () => {
          emit({ type: "faces-changed", count: faceCount, timestamp: env.now() });
        });
      });
    });
    return promise;
  }

  function stop(): Promise<void> {
    const timestamp = env.now();
    clearTimers();
    detachKeys();
    if (pendingStart) {
      const current = pendingStart;
      pendingStart = null;
      current.resolve({ ok: false, error: { code: "unknown", message: "stopped" } });
    }
    if (calibrating.length > 0) {
      calibrating = [];
      calibrationRun += 1;
      emit({ type: "calibration-failed", playerId: null, reason: "cancelled", timestamp });
    }
    assigned = false;
    tracking = { 1: "unassigned", 2: "unassigned" };
    calibration = { 1: "none", 2: "none" };
    setStatus("idle");
    return Promise.resolve();
  }

  function startCalibration(players: readonly PlayerId[] = PLAYER_IDS): void {
    if (disposed) return;
    if (status !== "running") {
      emit({
        type: "calibration-failed",
        playerId: null,
        reason: "not-running",
        timestamp: env.now(),
      });
      return;
    }
    const requested = [...new Set(players)];
    if (requested.length === 0) return;
    calibrationRun += 1;
    const run = calibrationRun;
    calibrating = requested;
    const inRun = (callback: () => void) => () => {
      if (run === calibrationRun) callback();
    };

    progress(null, "assign-players", 0);
    let delay = stepMs;
    later(
      delay,
      inRun(() => {
        if (faceCount < requested.length) {
          calibrating = [];
          emit({
            type: "calibration-failed",
            playerId: null,
            reason: "not-enough-faces",
            timestamp: env.now(),
          });
          calibrationRun += 1;
          return;
        }
        if (!assigned) assign("calibration");
      }),
    );
    for (const step of ["neutral", "gesture"] as const) {
      for (const value of [0, 0.5, 1]) {
        delay += stepMs;
        later(
          delay,
          inRun(() => {
            for (const playerId of calibrating) progress(playerId, step, value);
          }),
        );
      }
    }
    delay += stepMs;
    later(
      delay,
      inRun(() => {
        const done = calibrating;
        calibrating = [];
        for (const playerId of done) {
          calibration = { ...calibration, [playerId]: "calibrated" };
          emit({
            type: "calibration-complete",
            playerId,
            mode: "calibrated",
            timestamp: env.now(),
          });
        }
      }),
    );
  }

  function diagnosticsFor(playerId: PlayerId): PlayerVisionDiagnostics {
    const gesture = gestures[playerId];
    const tracked = status === "running" && tracking[playerId] === "tracked";
    return {
      playerId,
      tracking: tracking[playerId],
      faceRect: tracked ? FACE_RECTS[playerId] : null,
      lastSeenAt: tracked ? env.now() : null,
      gesture: {
        gesture,
        rawMetric: null,
        score: tracked ? 0 : null,
        enterThreshold: THRESHOLDS[gesture].enter,
        exitThreshold: THRESHOLDS[gesture].exit,
        state: calibration[playerId] === "none" ? "disarmed" : "idle",
        cooldownRemainingMs: 0,
        lastGestureAt: lastGestureAt[playerId],
        calibration: calibration[playerId],
      },
    };
  }

  return {
    start,
    stop,
    async dispose() {
      await stop();
      disposed = true;
    },
    getStatus: () => status,
    subscribe(listener) {
      const entry = { listener, active: true };
      entries.push(entry);
      return () => {
        if (!entry.active) return;
        entry.active = false;
        entries = entries.filter((candidate) => candidate !== entry);
      };
    },
    startCalibration,
    cancelCalibration() {
      if (calibrating.length === 0) return;
      calibrating = [];
      calibrationRun += 1;
      emit({
        type: "calibration-failed",
        playerId: null,
        reason: "cancelled",
        timestamp: env.now(),
      });
    },
    useDefaultCalibration(players: readonly PlayerId[] = PLAYER_IDS) {
      if (disposed) return;
      for (const playerId of new Set(players)) {
        calibrating = calibrating.filter((id) => id !== playerId);
        calibration = { ...calibration, [playerId]: "default" };
        emit({ type: "calibration-complete", playerId, mode: "default", timestamp: env.now() });
      }
      if (calibrating.length === 0) calibrationRun += 1;
    },
    swapPlayers() {
      if (status !== "running") return;
      tracking = { 1: tracking[2], 2: tracking[1] };
      emit({ type: "players-assigned", reason: "swapped", timestamp: env.now() });
    },
    resetAssignment() {
      if (status !== "running") return;
      assigned = false;
      tracking = { 1: "unassigned", 2: "unassigned" };
      later(stepMs, () => assign("reset"));
    },
    getDiagnostics(): VisionDiagnostics {
      const running = status === "running";
      const unassigned: NormalizedRect[] = [];
      if (running && !assigned) {
        if (faceCount >= 1) unassigned.push(FACE_RECTS[1]);
        if (faceCount >= 2) unassigned.push(FACE_RECTS[2]);
      }
      return {
        status,
        mirrored: options.mirrored,
        facesDetected: running ? faceCount : 0,
        players: { 1: diagnosticsFor(1), 2: diagnosticsFor(2) },
        unassignedFaces: unassigned,
        processingFps: running ? 30 : null,
        inferenceMs: running ? 12 : null,
        frameTimestamp: running ? env.now() : null,
      };
    },
  };
}

/** A VisionSessionFactory that creates simulated sessions (dev only). */
export function createSimulatedVisionFactory(
  env: SimulatedVisionEnvironment,
): VisionSessionFactory {
  return (options) => createSimulatedVisionSession(options, env);
}

/** The browser environment: keys from the window, real timers, performance.now(). */
export function browserSimulatedEnvironment(win: Window): SimulatedVisionEnvironment {
  return {
    keyTarget: win,
    now: () => win.performance.now(),
    schedule: (callback, ms) => {
      const handle = win.setTimeout(callback, ms);
      return () => win.clearTimeout(handle);
    },
  };
}
