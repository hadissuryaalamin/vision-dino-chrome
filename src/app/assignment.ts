import { PLAYER_IDS } from "../shared";
import type { PlayerId, VisionDiagnostics } from "../shared";

/**
 * Which player the single visible face will control when continuing with one player on the
 * camera (docs/architecture.md §9, "One face only"): an already tracked player if there is
 * one, otherwise by side in display space (centre left of the middle → Player 1). Defaults to
 * Player 1 when no face is visible.
 */
export function pickSingleCameraPlayer(diagnostics: VisionDiagnostics): PlayerId {
  for (const playerId of PLAYER_IDS) {
    if (diagnostics.players[playerId].tracking === "tracked") return playerId;
  }
  const face = diagnostics.unassignedFaces[0];
  if (!face) return 1;
  return face.x + face.width / 2 < 0.5 ? 1 : 2;
}
