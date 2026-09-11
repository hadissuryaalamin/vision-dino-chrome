import { DEFAULT_PLAYER_GESTURES, assertNever } from "../shared";
import type {
  GameController,
  GestureKind,
  PerPlayer,
  PlayerInputSource,
  Unsubscribe,
  VisionSession,
  VisionSessionFactory,
  VisionStartResult,
} from "../shared";
import { createAppView, describeGameEvent, describeVisionEvent } from "../ui";
import type { UiIntent } from "../ui";
import { pickSingleCameraPlayer } from "./assignment";
import { connectInputs } from "./input-router";
import { appKeyCommand } from "./keys";
import { createInitialAppState, transition } from "./state";
import type { AppEffect, AppEvent } from "./state";
import { parseAppUrlOptions } from "./url-options";
import { createVisionInputSource } from "./vision-input";
import { toViewModel } from "./view-model";

/**
 * The game handle the app needs: the shared GameController plus `destroy()`. Structurally
 * identical to src/game's planned `GameHandle`.
 */
export interface AppGame extends GameController {
  destroy(): void;
}

/** requestAnimationFrame-like scheduler; structurally compatible with src/game's FrameScheduler. */
export interface AppFrameScheduler {
  request(callback: (timestampMs: number) => void): number;
  cancel(handle: number): void;
}

export type KeyboardTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Everything createApp needs, injected so tests can pass fakes. In production (Phase 3)
 * `src/main.ts` passes src/game's `createGame`, `createKeyboardInputSource` and
 * `DEFAULT_KEY_BINDINGS`, and src/vision's `createVisionSession` and `isCameraSupported`.
 */
export interface AppDependencies {
  readonly createGame: (options: { readonly canvas: HTMLCanvasElement }) => AppGame;
  readonly createKeyboardInputSource: (options: {
    readonly target: KeyboardTarget;
  }) => PlayerInputSource;
  /** Called lazily, on the first "Play with camera" click; never in keyboard-only play. */
  readonly createVisionSession: VisionSessionFactory;
  readonly isCameraSupported: () => boolean;
  /** KeyboardEvent.code values per player, for the on-screen legend (DEFAULT_KEY_BINDINGS). */
  readonly keyBindings: PerPlayer<readonly string[]>;
  /** Default DEFAULT_PLAYER_GESTURES. */
  readonly playerGestures?: PerPlayer<GestureKind>;
  /** Default: window.requestAnimationFrame. */
  readonly frameScheduler?: AppFrameScheduler;
  /** URL query string for `?debug=1`. Default: window.location.search. */
  readonly search?: string;
}

export interface AppHandle {
  /** Stop the camera, remove every listener, destroy the game and clear the DOM. Idempotent. */
  destroy(): Promise<void>;
}

/** The preview is mirrored (selfie view); vision reports display-space rectangles (D-12). */
const MIRRORED = true;
const DEBUG_REFRESH_MS = 100;

function safeIsCameraSupported(isCameraSupported: () => boolean): boolean {
  try {
    return isCameraSupported();
  } catch {
    return false;
  }
}

/**
 * Compose the application inside `root`: UI, game, keyboard input (always active) and, only
 * after an explicit click on "Play with camera", the vision session.
 */
export function createApp(root: HTMLElement, deps: AppDependencies): AppHandle {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!win) throw new Error("createApp needs a root element in a document with a window");

  const playerGestures = deps.playerGestures ?? DEFAULT_PLAYER_GESTURES;
  const scheduler: AppFrameScheduler = deps.frameScheduler ?? {
    request: (callback) => win.requestAnimationFrame(callback),
    cancel: (handle) => win.cancelAnimationFrame(handle),
  };
  const urlOptions = parseAppUrlOptions(deps.search ?? win.location.search);

  const cleanups: Unsubscribe[] = [];
  const pending = new Set<Promise<unknown>>();
  const queue: AppEvent[] = [];
  let draining = false;
  let destroyed = false;
  let session: VisionSession | null = null;
  let visionInput: PlayerInputSource | null = null;

  const view = createAppView(root, {
    keyBindings: deps.keyBindings,
    playerGestures,
    mirrored: MIRRORED,
    onIntent: (intent) => handleIntent(intent),
  });
  const game = deps.createGame({ canvas: view.gameCanvas });
  const keyboard = deps.createKeyboardInputSource({ target: win });
  const snapshot = game.getSnapshot();
  let state = createInitialAppState({
    cameraSupported: safeIsCameraSupported(deps.isCameraSupported),
    gameStatus: snapshot.status,
    gameResult: snapshot.result,
    debugVisible: urlOptions.debug,
  });

  /** Keep a promise from floating: swallow its rejection and let destroy() await it. */
  function track(result: Promise<unknown> | void): void {
    if (!result) return;
    const settled: Promise<unknown> = result
      .catch(() => undefined)
      .finally(() => pending.delete(settled));
    pending.add(settled);
  }

  // Events are queued so effects that emit events synchronously (a fake or real session
  // emitting status-changed inside start()) are handled in order, after the current one.
  // Effects run synchronously, so vision.start() stays inside the click's user activation.
  function dispatch(event: AppEvent): void {
    if (destroyed) return;
    queue.push(event);
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const result = transition(state, next);
        state = result.state;
        for (const effect of result.effects) runEffect(effect);
      }
    } finally {
      draining = false;
    }
    if (!destroyed) view.render(toViewModel(state, playerGestures));
  }

  function ensureSession(): VisionSession {
    if (session) return session;
    const created = deps.createVisionSession({
      video: view.video,
      mirrored: MIRRORED,
      playerGestures,
    });
    session = created;
    cleanups.push(
      created.subscribe((event) => {
        const entry = describeVisionEvent(event);
        if (entry) view.logEvent(entry);
        dispatch({ type: "vision-event", event });
      }),
    );
    const input = createVisionInputSource(created, playerGestures);
    visionInput = input;
    cleanups.push(connectInputs([input], game));
    track(input.start());
    return created;
  }

  function startVision(attempt: number): void {
    const current = ensureSession();
    const failed = (error: unknown): VisionStartResult => ({
      ok: false,
      error: {
        code: "unknown",
        message: error instanceof Error ? error.message : "VisionSession.start() rejected",
      },
    });
    track(
      current.start().then(
        (result) => dispatch({ type: "vision-start-result", attempt, result }),
        (error: unknown) =>
          dispatch({ type: "vision-start-result", attempt, result: failed(error) }),
      ),
    );
  }

  function runEffect(effect: AppEffect): void {
    switch (effect.type) {
      case "start-vision":
        startVision(effect.attempt);
        return;
      case "stop-vision":
        if (session) track(session.stop());
        return;
      case "start-calibration":
        session?.startCalibration(effect.players);
        return;
      case "use-default-calibration":
        session?.useDefaultCalibration(effect.players);
        return;
      case "swap-players":
        session?.swapPlayers();
        return;
      case "reset-assignment":
        session?.resetAssignment();
        return;
      case "game-start":
        game.start();
        return;
      case "game-pause":
        game.pause();
        return;
      case "game-resume":
        game.resume();
        return;
      case "game-restart":
        game.restart();
        return;
      case "announce":
        view.announce(effect.announcement);
        return;
      default:
        assertNever(effect, "Unknown app effect");
    }
  }

  function handleIntent(intent: UiIntent): void {
    switch (intent.type) {
      case "play-with-camera":
        dispatch({ type: "choose-camera" });
        return;
      case "keyboard-only":
        dispatch({ type: "choose-keyboard" });
        return;
      case "start":
        dispatch({ type: "start-or-restart" });
        return;
      case "continue-one-player":
        dispatch({
          type: "continue-one-player",
          cameraPlayer: session ? pickSingleCameraPlayer(session.getDiagnostics()) : 1,
        });
        return;
      case "continue-two-players":
      case "calibration-retry":
      case "calibration-use-defaults":
      case "swap-players":
      case "reset-assignment":
      case "camera-off":
      case "restart":
      case "pause":
      case "resume":
      case "toggle-debug":
      case "dismiss-notice":
        dispatch({ type: intent.type });
        return;
      default:
        assertNever(intent, "Unknown UI intent");
    }
  }

  // ---- Inputs and page lifecycle ----

  // Keyboard input is always active, in keyboard-only and camera mode alike.
  cleanups.push(connectInputs([keyboard], game));
  cleanups.push(
    game.subscribe((event) => {
      view.logEvent(describeGameEvent(event));
      dispatch({ type: "game-event", event });
    }),
  );
  track(keyboard.start());

  const onKeyDown = (event: KeyboardEvent): void => {
    const command = appKeyCommand(event);
    if (!command) return;
    event.preventDefault();
    dispatch({ type: command });
  };
  const onVisibilityChange = (): void => {
    if (doc.visibilityState === "hidden") dispatch({ type: "page-hidden" });
  };
  const onPageHide = (): void => dispatch({ type: "page-hide" });
  win.addEventListener("keydown", onKeyDown);
  doc.addEventListener("visibilitychange", onVisibilityChange);
  win.addEventListener("pagehide", onPageHide);
  cleanups.push(() => {
    win.removeEventListener("keydown", onKeyDown);
    doc.removeEventListener("visibilitychange", onVisibilityChange);
    win.removeEventListener("pagehide", onPageHide);
  });

  // ---- Per-frame UI updates (polling; nothing here changes game or vision state) ----

  let lastDebugAt = Number.NEGATIVE_INFINITY;
  const onFrame = (now: number): void => {
    if (destroyed) return;
    frameHandle = scheduler.request(onFrame);
    view.updateGame(game.getSnapshot(), now);
    view.drawFaces(session && state.mode === "camera" ? session.getDiagnostics() : null);
    if (state.debugVisible && now - lastDebugAt >= DEBUG_REFRESH_MS) {
      lastDebugAt = now;
      view.updateDebug(session ? session.getDiagnostics() : null);
    }
  };
  let frameHandle = scheduler.request(onFrame);

  view.render(toViewModel(state, playerGestures));

  // ---- Teardown ----

  async function teardown(): Promise<void> {
    destroyed = true;
    scheduler.cancel(frameHandle);
    // Stop the camera first: privacy matters more than tidy ordering.
    const current = session;
    const stopping = current ? current.stop() : Promise.resolve();
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    track(keyboard.stop());
    if (visionInput) track(visionInput.stop());
    game.destroy();
    view.destroy();
    await stopping;
    if (current) await current.dispose();
    await Promise.allSettled([...pending]);
  }

  let destroying: Promise<void> | null = null;
  return {
    destroy() {
      destroying ??= teardown();
      return destroying;
    },
  };
}
