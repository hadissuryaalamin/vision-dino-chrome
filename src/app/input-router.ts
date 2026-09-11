import { assertNever } from "../shared";
import type { GameController, PlayerAction, PlayerInputSource, Unsubscribe } from "../shared";

/**
 * Subscribes to every source and forwards each jump action to `game.jumpPlayer`.
 *
 * The router does not start or stop the sources; their lifecycle belongs to the caller.
 * It also does not filter by source: keyboard, vision and simulated actions all take the same
 * path, so they work at the same time. The returned function unsubscribes from every source;
 * calling it more than once is a no-op, and no action is forwarded after it has been called.
 */
export function connectInputs(
  sources: readonly PlayerInputSource[],
  game: Pick<GameController, "jumpPlayer">,
): Unsubscribe {
  let connected = true;

  const forward = (action: PlayerAction): void => {
    if (!connected) return;
    switch (action.type) {
      case "jump":
        game.jumpPlayer(action.playerId);
        break;
      default:
        assertNever(action.type, "Unknown player action");
    }
  };

  const unsubscribers = sources.map((source) => source.subscribe(forward));

  return () => {
    if (!connected) return;
    connected = false;
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
