import {
  PLAYER_IDS,
  type PerPlayer,
  type PlayerAction,
  type PlayerId,
  type PlayerInputSource,
} from "../../shared";
import { createEmitter, rethrowAsync, type ListenerErrorHandler } from "../events";

/** KeyboardEvent.code values that make each player jump. */
export type KeyBindings = PerPlayer<readonly string[]>;

/** Player 1: `W`; Player 2: `↑` (decision D-17). Physical key codes, layout independent. */
export const DEFAULT_KEY_BINDINGS: KeyBindings = Object.freeze({
  1: Object.freeze(["KeyW"]),
  2: Object.freeze(["ArrowUp"]),
});

export interface KeyboardInputOptions {
  /** Usually `window` or `document`. */
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** Default: DEFAULT_KEY_BINDINGS. A code bound to both players goes to Player 1. */
  bindings?: KeyBindings;
  /** Called with errors thrown by action listeners. Default: rethrow asynchronously. */
  onListenerError?: ListenerErrorHandler;
}

/** The fields read from a keydown event; plain Events without them are ignored. */
interface KeyFields {
  readonly code?: unknown;
  readonly repeat?: unknown;
  readonly ctrlKey?: unknown;
  readonly altKey?: unknown;
  readonly metaKey?: unknown;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

interface ElementLike {
  readonly tagName?: unknown;
  readonly isContentEditable?: unknown;
  readonly closest?: unknown;
}

/** True for form fields and contenteditable content, where keys must type, not jump. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const element = target as ElementLike;
  if (element.isContentEditable === true) return true;
  if (typeof element.tagName === "string" && EDITABLE_TAGS.has(element.tagName.toUpperCase())) {
    return true;
  }
  // Fallback for environments without isContentEditable (e.g. jsdom).
  if (typeof element.closest === "function") {
    const closest = element.closest as (selector: string) => unknown;
    return closest.call(target, '[contenteditable]:not([contenteditable="false"])') != null;
  }
  return false;
}

/**
 * A PlayerInputSource driven by `keydown` events. It emits `{ type: "jump", source:
 * "keyboard", timestamp: event.timeStamp }` and never calls the game itself.
 *
 * - Auto-repeat (`event.repeat`) is ignored, so holding a key is one jump.
 * - Keys with Ctrl, Alt or Meta held are ignored (browser shortcuts keep working).
 * - Keys typed into `input`, `textarea`, `select` or contenteditable content are ignored.
 * - `preventDefault()` is called for bound keys, which stops `↑` from scrolling the page.
 * - `start()` and `stop()` are idempotent; `stop()` removes the listener.
 */
export function createKeyboardInputSource(options: KeyboardInputOptions): PlayerInputSource {
  const { target } = options;
  const bindings = options.bindings ?? DEFAULT_KEY_BINDINGS;
  const codeToPlayer = new Map<string, PlayerId>();
  for (const playerId of PLAYER_IDS) {
    for (const code of bindings[playerId]) {
      if (!codeToPlayer.has(code)) codeToPlayer.set(code, playerId);
    }
  }
  const emitter = createEmitter<PlayerAction>(options.onListenerError ?? rethrowAsync);
  let listening = false;

  const onKeyDown = (event: Event): void => {
    const key = event as Event & KeyFields;
    if (typeof key.code !== "string") return;
    const playerId = codeToPlayer.get(key.code);
    if (playerId === undefined) return;
    if (key.ctrlKey === true || key.altKey === true || key.metaKey === true) return;
    if (isEditableTarget(event.target)) return;
    event.preventDefault();
    if (key.repeat === true) return;
    emitter.emit({ type: "jump", playerId, source: "keyboard", timestamp: event.timeStamp });
  };

  return {
    start() {
      if (listening) return;
      listening = true;
      target.addEventListener("keydown", onKeyDown);
    },
    stop() {
      if (!listening) return;
      listening = false;
      target.removeEventListener("keydown", onKeyDown);
    },
    subscribe(listener) {
      return emitter.subscribe(listener);
    },
  };
}
