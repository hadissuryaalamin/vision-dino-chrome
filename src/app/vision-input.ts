import { DEFAULT_PLAYER_GESTURES } from "../shared";
import type {
  GestureKind,
  Listener,
  PerPlayer,
  PlayerAction,
  PlayerInputSource,
  Unsubscribe,
  VisionEvent,
  VisionSession,
} from "../shared";

/**
 * Adapts semantic vision events into game-facing actions.
 *
 * Each `{ type: "gesture", playerId, gesture }` event whose gesture equals
 * `playerGestures[playerId]` becomes exactly one
 * `{ type: "jump", playerId, source: "vision", timestamp: event.timestamp }`. Every other
 * event, and a gesture that is not the one configured for that player, produces nothing.
 *
 * `start()` only begins forwarding: it subscribes to the session and never opens the camera
 * (that is `VisionSession.start()`, called from an explicit user action). `start()` and
 * `stop()` are idempotent, and the source can be started again after `stop()`.
 */
export function createVisionInputSource(
  session: VisionSession,
  playerGestures: PerPlayer<GestureKind> = DEFAULT_PLAYER_GESTURES,
): PlayerInputSource {
  let entries: { readonly listener: Listener<PlayerAction>; active: boolean }[] = [];
  let unsubscribeSession: Unsubscribe | null = null;

  const emit = (action: PlayerAction): void => {
    for (const entry of [...entries]) {
      if (entry.active) entry.listener(action);
    }
  };

  const onVisionEvent = (event: VisionEvent): void => {
    if (event.type !== "gesture") return;
    if (event.gesture !== playerGestures[event.playerId]) return;
    emit({ type: "jump", playerId: event.playerId, source: "vision", timestamp: event.timestamp });
  };

  return {
    start() {
      if (unsubscribeSession) return;
      unsubscribeSession = session.subscribe(onVisionEvent);
    },
    stop() {
      if (!unsubscribeSession) return;
      const unsubscribe = unsubscribeSession;
      unsubscribeSession = null;
      unsubscribe();
    },
    subscribe(listener) {
      const entry = { listener, active: true };
      entries.push(entry);
      return () => {
        if (!entry.active) return;
        entry.active = false;
        entries = entries.filter((candidate) => candidate !== entry);
      };
    },
  };
}
