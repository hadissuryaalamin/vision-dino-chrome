import type { GameSnapshot, PlayerId, PlayerSnapshot } from "../../shared";
import type { GameState } from "./state";

function playerSnapshot(state: GameState, playerId: PlayerId): PlayerSnapshot {
  const player = state.players[playerId];
  return Object.freeze({
    playerId,
    score: player.score,
    crashed: player.crashed,
    airborne: !player.grounded,
  });
}

/** @internal Frozen, UI-facing view of the state. */
export function createSnapshot(state: GameState): GameSnapshot {
  return Object.freeze({
    status: state.status,
    elapsedMs: state.elapsedMs,
    players: Object.freeze({ 1: playerSnapshot(state, 1), 2: playerSnapshot(state, 2) }),
    result: state.result,
  });
}
