import {
  PLAYER_IDS,
  type GameEvent,
  type GameResult,
  type PerPlayer,
  type PlayerId,
} from "../../shared";
import type { GameConfig } from "../config";
import { dinoHitsObstacle } from "./collision";
import { generateObstacle } from "./obstacles";
import type { MutableGameState, MutablePlayerState } from "./state";

/** One player's standing when the round ends. */
export interface ResultEntry {
  readonly score: number;
  /** `elapsedMs` of the crash step, or null if the player had not crashed. */
  readonly crashedAtMs: number | null;
}

/**
 * The higher score wins. On equal scores the player who crashed later (or did not crash)
 * wins; `winner` is null only when both crashed in the same step with equal scores (ICR 1).
 * Crashes in the same step have identical `crashedAtMs` (it is derived from the step count).
 */
export function buildResult(players: PerPlayer<ResultEntry>): GameResult {
  const p1 = players[1];
  const p2 = players[2];
  let winner: PlayerId | null;
  if (p1.score !== p2.score) {
    winner = p1.score > p2.score ? 1 : 2;
  } else {
    const survived1 = p1.crashedAtMs ?? Number.POSITIVE_INFINITY;
    const survived2 = p2.crashedAtMs ?? Number.POSITIVE_INFINITY;
    winner = survived1 === survived2 ? null : survived1 > survived2 ? 1 : 2;
  }
  return Object.freeze({ winner, scores: Object.freeze({ 1: p1.score, 2: p2.score }) });
}

function resultEntry(state: MutableGameState, playerId: PlayerId): ResultEntry {
  const player = state.players[playerId];
  return { score: player.score, crashedAtMs: player.crash?.elapsedMs ?? null };
}

function takeOff(
  player: MutablePlayerState,
  config: GameConfig,
  nowMs: number,
  events: GameEvent[],
): void {
  player.vy = config.jumpVelocity;
  player.grounded = false;
  player.bufferedJumpAtMs = null;
  player.lastJumpAtMs = nowMs;
  player.jumps += 1;
  events.push({ type: "player-jumped", playerId: player.playerId, elapsedMs: nowMs });
}

function spawnAndCull(state: MutableGameState, config: GameConfig): void {
  const horizon = state.distance + config.laneWidth + config.spawnMargin;
  while (state.nextObstacleX < horizon) {
    const generated = generateObstacle(config, {
      x: state.nextObstacleX,
      id: state.nextObstacleId,
      speed: state.speed,
      rngState: state.rngState,
    });
    state.obstacles.push(generated.obstacle);
    state.nextObstacleX = generated.nextX;
    state.nextObstacleId += 1;
    state.rngState = generated.rngState;
  }
  // Obstacles are sorted by x; drop those whose right edge has left the screen.
  let removable = 0;
  for (const obstacle of state.obstacles) {
    if (obstacle.x + obstacle.width >= state.distance) break;
    removable += 1;
  }
  if (removable > 0) state.obstacles.splice(0, removable);
}

/**
 * @internal Advance the round by one fixed step of `stepUs` microseconds and append the
 * resulting events, in order: jumps, crashes, then status change and game over.
 *
 * Order within a step: queued jumps take off → vertical motion and landing (a buffered
 * jump fires on landing) → the world scrolls and speeds up → obstacles spawn and are
 * culled → collisions → scores of surviving players → round-end check.
 */
export function simulateStep(
  state: MutableGameState,
  config: GameConfig,
  stepUs: number,
  events: GameEvent[],
): void {
  const dt = stepUs / 1_000_000;
  state.stepCount += 1;
  state.elapsedMs = (state.stepCount * stepUs) / 1000;
  const now = state.elapsedMs;

  for (const id of PLAYER_IDS) {
    const player = state.players[id];
    if (player.crashed) continue;
    if (player.jumpQueued && player.grounded) takeOff(player, config, now, events);
    player.jumpQueued = false;

    if (!player.grounded) {
      player.y += player.vy * dt - 0.5 * config.gravity * dt * dt;
      player.vy -= config.gravity * dt;
      if (player.y <= 0) {
        player.y = 0;
        player.vy = 0;
        player.grounded = true;
        const requestedAt = player.bufferedJumpAtMs;
        player.bufferedJumpAtMs = null;
        if (requestedAt !== null && now - requestedAt <= config.jumpBufferMs) {
          takeOff(player, config, now, events);
        }
      }
    }
  }

  state.distance += state.speed * dt;
  state.speed = Math.min(config.maxSpeed, state.speed + config.acceleration * dt);
  spawnAndCull(state, config);

  for (const id of PLAYER_IDS) {
    const player = state.players[id];
    if (player.crashed) continue;
    const hit = state.obstacles.some((obstacle) =>
      dinoHitsObstacle(config, state.distance, player.y, obstacle),
    );
    if (hit) {
      player.crashed = true;
      player.jumpQueued = false;
      player.bufferedJumpAtMs = null;
      player.crash = Object.freeze({
        distance: state.distance,
        y: player.y,
        elapsedMs: now,
        obstacles: Object.freeze([...state.obstacles]),
      });
      events.push({ type: "player-crashed", playerId: id, score: player.score, elapsedMs: now });
    } else {
      player.score = Math.floor(state.distance * config.scorePerUnit);
    }
  }

  const crashed = PLAYER_IDS.filter((id) => state.players[id].crashed).length;
  const ended = config.roundEnd === "first-crash" ? crashed > 0 : crashed === PLAYER_IDS.length;
  if (ended) {
    state.status = "game-over";
    state.result = buildResult({ 1: resultEntry(state, 1), 2: resultEntry(state, 2) });
    events.push({
      type: "status-changed",
      status: "game-over",
      previous: "running",
      elapsedMs: now,
    });
    events.push({ type: "game-over", result: state.result, elapsedMs: now });
  }
}
