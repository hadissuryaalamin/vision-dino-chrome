/**
 * Player identity. Player 1 jumps by blinking and Player 2 by opening their mouth
 * (see DEFAULT_PLAYER_GESTURES). At calibration time, Player 1 is the face on the
 * left of the camera preview as the players see it (docs/architecture.md, "Player assignment").
 */
export type PlayerId = 1 | 2;

export const PLAYER_IDS: readonly [1, 2] = [1, 2];

/** One value per player, keyed by PlayerId. */
export type PerPlayer<T> = { readonly [K in PlayerId]: T };

export function isPlayerId(value: unknown): value is PlayerId {
  return value === 1 || value === 2;
}

export function otherPlayer(playerId: PlayerId): PlayerId {
  return playerId === 1 ? 2 : 1;
}
