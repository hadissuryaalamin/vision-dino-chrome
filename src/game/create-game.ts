import type { GameController } from "../shared";
import { createGameEngine, type GameEngineOptions } from "./engine/engine";
import { createAnimationFrameScheduler, type FrameScheduler } from "./loop/scheduler";
import { renderGame, type RenderOptions, type RenderViewport } from "./render/renderer";

export interface CreateGameOptions extends GameEngineOptions {
  /**
   * The canvas to draw on. Size it with CSS (for example `width: 100%; aspect-ratio: 16 / 10`);
   * createGame sets the backing-store size from the CSS size × devicePixelRatio. A canvas
   * without CSS size keeps its initial `width`/`height` attributes as its CSS size.
   */
  canvas: HTMLCanvasElement;
  /** Default: requestAnimationFrame-based. Tests pass a manual scheduler. */
  scheduler?: FrameScheduler;
  /** Default: `globalThis.devicePixelRatio`, or 1. Re-read every frame. */
  getPixelRatio?: () => number;
  /** Renderer options, e.g. hiding the built-in status text when the UI shows its own. */
  render?: RenderOptions;
}

export interface GameHandle extends GameController {
  /** Stop the loop and remove every listener or observer created by createGame. Idempotent. */
  destroy(): void;
}

function defaultPixelRatio(): number {
  const ratio = (globalThis as { devicePixelRatio?: unknown }).devicePixelRatio;
  return typeof ratio === "number" ? ratio : 1;
}

/**
 * Compose the engine, the fixed-step loop and the renderer on `canvas`. The loop runs
 * (and draws) every frame until destroy(); the simulation advances only while "running".
 * Throws if the canvas has no 2D context.
 */
export function createGame(options: CreateGameOptions): GameHandle {
  const { canvas } = options;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("createGame: canvas.getContext('2d') returned null");

  const engine = createGameEngine(options);
  const scheduler = options.scheduler ?? createAnimationFrameScheduler();
  const getPixelRatio = options.getPixelRatio ?? defaultPixelRatio;
  const fallbackSize = { width: canvas.width || 300, height: canvas.height || 150 };

  let viewport: RenderViewport = { width: 0, height: 0, pixelRatio: 0 };
  let handle: number | null = null;
  let lastTimestamp: number | null = null;
  let destroyed = false;

  /** Update the backing store if the CSS size or pixel ratio changed. True if it did. */
  const measure = (): boolean => {
    const rawRatio = getPixelRatio();
    const pixelRatio = Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : 1;
    const width = canvas.clientWidth > 0 ? canvas.clientWidth : fallbackSize.width;
    const height = canvas.clientHeight > 0 ? canvas.clientHeight : fallbackSize.height;
    if (
      width === viewport.width &&
      height === viewport.height &&
      pixelRatio === viewport.pixelRatio
    ) {
      return false;
    }
    viewport = { width, height, pixelRatio };
    const bitmapWidth = Math.max(1, Math.round(width * pixelRatio));
    const bitmapHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== bitmapWidth) canvas.width = bitmapWidth;
    if (canvas.height !== bitmapHeight) canvas.height = bitmapHeight;
    return true;
  };

  const draw = (): void => {
    renderGame(context, engine.getState(), engine.config, viewport, options.render);
  };

  const frame = (timestamp: number): void => {
    handle = null;
    if (destroyed) return;
    const dt = lastTimestamp === null ? 0 : timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    engine.advance(dt);
    measure();
    draw();
    // A GameEvent listener may have called destroy() during advance().
    if (!destroyed) handle = scheduler.request(frame);
  };

  const Observer = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const observer =
    typeof Observer === "function"
      ? new Observer(() => {
          if (!destroyed && measure()) draw();
        })
      : null;
  observer?.observe(canvas);

  measure();
  draw();
  handle = scheduler.request(frame);

  return {
    jumpPlayer: (playerId) => engine.jumpPlayer(playerId),
    start: () => engine.start(),
    pause: () => engine.pause(),
    resume: () => engine.resume(),
    restart: () => engine.restart(),
    getSnapshot: () => engine.getSnapshot(),
    subscribe: (listener) => engine.subscribe(listener),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
      observer?.disconnect();
    },
  };
}
