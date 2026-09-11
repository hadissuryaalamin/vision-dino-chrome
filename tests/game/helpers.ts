import {
  createGameEngine,
  jumpAirtimeMs,
  type GameConfig,
  type GameEngine,
  type GameEngineOptions,
  type GameRenderContext,
  type GameState,
} from "../../src/game";
import { PLAYER_IDS, type GameEvent, type PlayerId } from "../../src/shared";

/** Pushes the first obstacle so far away that it never appears. */
export const NO_OBSTACLES: Partial<GameConfig> = { firstObstacleX: 1e12 };

/** Exactly one fixed step, in ms (the engine rounds the step to whole microseconds). */
export function stepMsOf(engine: GameEngine): number {
  return Math.round(engine.config.fixedStepMs * 1000) / 1000;
}

export function runSteps(engine: GameEngine, steps: number, beforeStep?: () => void): void {
  const stepMs = stepMsOf(engine);
  for (let i = 0; i < steps; i += 1) {
    beforeStep?.();
    engine.advance(stepMs);
  }
}

export function startedEngine(options: GameEngineOptions = {}): GameEngine {
  const engine = createGameEngine({ seed: 1, ...options });
  engine.start();
  return engine;
}

export function collectEvents(engine: Pick<GameEngine, "subscribe">): GameEvent[] {
  const events: GameEvent[] = [];
  engine.subscribe((event) => events.push(event));
  return events;
}

export function cloneState(state: Readonly<GameState>): GameState {
  return structuredClone(state);
}

/**
 * A perfect player: jumps so that the middle of the airborne window lines up with the
 * middle of the horizontal overlap with the next obstacle.
 */
export function perfectJumps(engine: GameEngine, players: readonly PlayerId[] = PLAYER_IDS): void {
  const config = engine.config;
  const state = engine.getState();
  if (state.status !== "running") return;
  const inset = config.collisionInset;
  const dinoLeft = state.distance + config.dinoX + inset;
  const dinoRight = state.distance + config.dinoX + config.dinoWidth - inset;
  const next = state.obstacles.find((o) => o.x + o.width - inset > dinoLeft);
  if (!next) return;
  const airtime = jumpAirtimeMs(config) / 1000;
  const overlap = (dinoRight - dinoLeft + next.width - 2 * inset) / state.speed;
  const lead = (next.x + inset - dinoRight) / state.speed;
  if (lead > (airtime - overlap) / 2) return;
  for (const id of players) {
    const player = state.players[id];
    if (player.grounded && !player.crashed) engine.jumpPlayer(id);
  }
}

/** Run steps until the round is over or `maxSteps` have passed. Returns the step count. */
export function runUntilGameOver(
  engine: GameEngine,
  maxSteps = 100_000,
  beforeStep?: () => void,
): number {
  const stepMs = stepMsOf(engine);
  let steps = 0;
  while (engine.getState().status === "running" && steps < maxSteps) {
    beforeStep?.();
    engine.advance(stepMs);
    steps += 1;
  }
  return steps;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

/** A fake 2D context that records every call and every drawn text. */
export function createRecordingContext(): {
  ctx: GameRenderContext;
  calls: RecordedCall[];
  texts: string[];
} {
  const calls: RecordedCall[] = [];
  const texts: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args });
    };
  const ctx = {
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    setTransform: record("setTransform"),
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    rect: record("rect"),
    clip: record("clip"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    save: record("save"),
    restore: record("restore"),
    translate: record("translate"),
    scale: record("scale"),
    fillText: (text: string, ...rest: unknown[]) => {
      texts.push(text);
      calls.push({ name: "fillText", args: [text, ...rest] });
    },
  };
  return { ctx: ctx as unknown as GameRenderContext, calls, texts };
}
