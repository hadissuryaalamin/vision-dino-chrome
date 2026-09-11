/** Application-level keyboard commands (decision D-17). Player jump keys belong to src/game. */
export type AppKeyCommand = "start-or-restart" | "toggle-pause" | "toggle-debug";

/** The fields of a KeyboardEvent the app key handler reads. */
export interface AppKeyEvent {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly target: EventTarget | null;
}

/** Elements that act on Enter by themselves; Enter there must not also start the game. */
const ACTIVATING_TAGS: ReadonlySet<string> = new Set([
  "A",
  "BUTTON",
  "INPUT",
  "SELECT",
  "SUMMARY",
  "TEXTAREA",
]);
const ACTIVATING_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "checkbox",
  "menuitem",
  "option",
  "radio",
  "switch",
  "tab",
]);
const EDITABLE_TAGS: ReadonlySet<string> = new Set(["INPUT", "SELECT", "TEXTAREA"]);

interface TargetInfo {
  readonly activates: boolean;
  readonly editable: boolean;
}

function describeTarget(target: EventTarget | null): TargetInfo {
  // Duck-typed so the module stays DOM-free and testable in Node.
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  } | null;
  const tag = typeof element?.tagName === "string" ? element.tagName.toUpperCase() : "";
  const role = typeof element?.getAttribute === "function" ? element.getAttribute("role") : null;
  const editable = EDITABLE_TAGS.has(tag) || element?.isContentEditable === true;
  const activates =
    editable || ACTIVATING_TAGS.has(tag) || (role !== null && ACTIVATING_ROLES.has(role));
  return { activates, editable };
}

/**
 * Map a keydown to an app command, or null when the app should leave the key alone.
 *
 * - Enter: start or restart (and resume when paused). Ignored on buttons, links and form
 *   controls, whose own activation handles it, so a focused button never double-triggers.
 * - P or Escape: pause and resume.
 * - Backquote: toggle the debug overlay.
 *
 * Auto-repeat, keys with Ctrl, Alt or Meta held, and keys typed into editable elements are
 * ignored.
 */
export function appKeyCommand(event: AppKeyEvent): AppKeyCommand | null {
  if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return null;
  const target = describeTarget(event.target);
  if (target.editable) return null;
  if (event.key === "Enter") return target.activates ? null : "start-or-restart";
  if (event.key === "Escape" || event.code === "KeyP" || event.key === "p" || event.key === "P") {
    return "toggle-pause";
  }
  if (event.code === "Backquote" || event.key === "`") return "toggle-debug";
  return null;
}
