import { describe, expect, it, vi } from "vitest";
import { createGame, createManualFrameScheduler, type CreateGameOptions } from "../../src/game";
import { createRecordingContext } from "./helpers";

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: unknown[] = [];
  disconnected = false;
  private readonly callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: unknown): void {
    this.observed.push(target);
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected = true;
  }
  trigger(): void {
    this.callback();
  }
}

interface FakeCanvas {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
  getContext: () => unknown;
}

function setup(overrides: Partial<CreateGameOptions> = {}, context: unknown = undefined) {
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  const recording = createRecordingContext();
  const canvas: FakeCanvas = {
    width: 300,
    height: 150,
    clientWidth: 600,
    clientHeight: 400,
    getContext: () => (context === undefined ? recording.ctx : context),
  };
  const scheduler = createManualFrameScheduler();
  const request = vi.spyOn(scheduler, "request");
  const cancel = vi.spyOn(scheduler, "cancel");
  const game = createGame({
    canvas: canvas as unknown as HTMLCanvasElement,
    scheduler,
    seed: 1,
    getPixelRatio: () => 1,
    ...overrides,
  });
  return { game, canvas, scheduler, request, cancel, recording };
}

describe("createGame", () => {
  it("draws immediately and keeps exactly one frame scheduled", () => {
    const { scheduler, recording } = setup();
    expect(recording.texts).toContain("READY");
    expect(scheduler.pendingCount).toBe(1);
    scheduler.tick(0);
    scheduler.tick(16);
    expect(scheduler.pendingCount).toBe(1);
  });

  it("advances the engine by scheduler time while running", () => {
    const { game, scheduler } = setup();
    scheduler.tick(1000); // first frame: no delta yet
    game.start();
    scheduler.tick(1100);
    expect(game.getSnapshot().elapsedMs).toBeCloseTo(12 * 8.333, 6);
    game.pause();
    scheduler.tick(1200);
    expect(game.getSnapshot().elapsedMs).toBeCloseTo(12 * 8.333, 6);
  });

  it("clamps a long gap between frames (e.g. a background tab)", () => {
    const { game, scheduler } = setup();
    game.start();
    scheduler.tick(0);
    scheduler.tick(60_000);
    expect(game.getSnapshot().elapsedMs).toBeLessThanOrEqual(100);
  });

  it("delegates the GameController commands to the engine", () => {
    const { game, scheduler } = setup({ config: { firstObstacleX: 1e12 } });
    const events: string[] = [];
    const unsubscribe = game.subscribe((e) => events.push(e.type));
    game.start();
    game.jumpPlayer(1);
    scheduler.tick(0);
    scheduler.tick(20);
    expect(game.getSnapshot().players[1].airborne).toBe(true);
    game.pause();
    game.resume();
    game.restart();
    unsubscribe();
    game.pause();
    expect(events).toEqual([
      "status-changed",
      "player-jumped",
      "status-changed",
      "status-changed",
      "status-changed",
    ]);
  });

  it("sizes the backing store to the CSS size × devicePixelRatio", () => {
    let ratio = 2;
    const { canvas, scheduler } = setup({ getPixelRatio: () => ratio });
    expect([canvas.width, canvas.height]).toEqual([1200, 800]);
    ratio = 1.5;
    scheduler.tick(0);
    expect([canvas.width, canvas.height]).toEqual([900, 600]);
  });

  it("follows ResizeObserver notifications", () => {
    const { canvas, recording } = setup();
    const observer = FakeResizeObserver.instances[0]!;
    expect(observer.observed).toEqual([canvas]);
    const drawsBefore = recording.calls.length;
    canvas.clientWidth = 800;
    canvas.clientHeight = 500;
    observer.trigger();
    expect([canvas.width, canvas.height]).toEqual([800, 500]);
    expect(recording.calls.length).toBeGreaterThan(drawsBefore);
  });

  it("falls back to the canvas attributes when it has no CSS size", () => {
    const { canvas, scheduler } = setup({ getPixelRatio: () => 2 });
    canvas.clientWidth = 0;
    canvas.clientHeight = 0;
    scheduler.tick(0);
    scheduler.tick(16);
    // Initial attributes (300 × 150) are used as the CSS size; no runaway growth.
    expect([canvas.width, canvas.height]).toEqual([600, 300]);
  });

  it("destroy() cancels the scheduled frame and disconnects the observer", () => {
    const { game, scheduler, request, cancel } = setup();
    scheduler.tick(0);
    const handle = request.mock.results.at(-1)!.value as number;
    game.destroy();
    expect(cancel).toHaveBeenCalledWith(handle);
    expect(scheduler.pendingCount).toBe(0);
    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
    const requests = request.mock.calls.length;
    scheduler.tick(16);
    expect(request.mock.calls.length).toBe(requests);
    expect(() => {
      game.destroy();
      game.start();
      game.jumpPlayer(1);
    }).not.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("does not schedule another frame when a listener destroys the game mid-frame", () => {
    const { game, scheduler } = setup();
    game.start();
    game.subscribe((event) => {
      if (event.type === "player-crashed") game.destroy();
    });
    let t = 0;
    while (scheduler.pendingCount > 0 && t < 20_000) {
      t += 16;
      scheduler.tick(t);
    }
    expect(scheduler.pendingCount).toBe(0);
    expect(game.getSnapshot().players[1].crashed).toBe(true);
  });

  it("works without ResizeObserver", () => {
    FakeResizeObserver.instances = [];
    const recording = createRecordingContext();
    vi.stubGlobal("ResizeObserver", undefined);
    const scheduler = createManualFrameScheduler();
    const canvas = {
      width: 300,
      height: 150,
      clientWidth: 0,
      clientHeight: 0,
      getContext: () => recording.ctx,
    };
    const game = createGame({ canvas: canvas as unknown as HTMLCanvasElement, scheduler, seed: 1 });
    scheduler.tick(0);
    game.destroy();
    expect(scheduler.pendingCount).toBe(0);
  });

  it("throws when the canvas has no 2D context", () => {
    expect(() => setup({}, null)).toThrow(/2d/);
  });
});
