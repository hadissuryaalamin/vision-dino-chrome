// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_KEY_BINDINGS,
  createKeyboardInputSource,
  type KeyboardInputOptions,
} from "../../src/game";
import type { PlayerAction, PlayerInputSource } from "../../src/shared";

function keydown(code: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...init });
}

function setup(options: Partial<KeyboardInputOptions> = {}): {
  source: PlayerInputSource;
  actions: PlayerAction[];
} {
  const source = createKeyboardInputSource({ target: document, ...options });
  const actions: PlayerAction[] = [];
  source.subscribe((action) => actions.push(action));
  void source.start();
  return { source, actions };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("keyboard input source", () => {
  it("binds W to Player 1 and ArrowUp to Player 2 by default", () => {
    expect(DEFAULT_KEY_BINDINGS).toEqual({ 1: ["KeyW"], 2: ["ArrowUp"] });
    const { source, actions } = setup();
    const w = keydown("KeyW");
    document.dispatchEvent(w);
    document.dispatchEvent(keydown("ArrowUp"));
    document.dispatchEvent(keydown("KeyS"));
    expect(actions).toEqual([
      { type: "jump", playerId: 1, source: "keyboard", timestamp: w.timeStamp },
      expect.objectContaining({ type: "jump", playerId: 2, source: "keyboard" }),
    ]);
    void source.stop();
  });

  it("supports custom bindings; a code bound twice goes to Player 1", () => {
    const { actions } = setup({ bindings: { 1: ["Space", "KeyQ"], 2: ["KeyQ", "Numpad8"] } });
    for (const code of ["Space", "KeyQ", "Numpad8", "KeyW", "ArrowUp"]) {
      document.dispatchEvent(keydown(code));
    }
    expect(actions.map((a) => a.playerId)).toEqual([1, 1, 2]);
  });

  it("ignores auto-repeat, so holding a key is one jump", () => {
    const { actions } = setup();
    document.dispatchEvent(keydown("KeyW"));
    const repeats = [1, 2, 3].map(() => keydown("KeyW", { repeat: true }));
    for (const event of repeats) document.dispatchEvent(event);
    expect(actions).toHaveLength(1);
    // Repeats of a bound key still must not scroll the page.
    expect(repeats.every((e) => e.defaultPrevented)).toBe(true);
  });

  it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
    "ignores bound keys with a modifier held: %o",
    (modifier) => {
      const { actions } = setup();
      const event = keydown("ArrowUp", modifier);
      document.dispatchEvent(event);
      expect(actions).toHaveLength(0);
      expect(event.defaultPrevented).toBe(false);
    },
  );

  it("still accepts Shift", () => {
    const { actions } = setup();
    document.dispatchEvent(keydown("KeyW", { shiftKey: true }));
    expect(actions).toHaveLength(1);
  });

  it.each([
    ["input", '<input id="t" />'],
    ["textarea", '<textarea id="t"></textarea>'],
    ["select", '<select id="t"><option>a</option></select>'],
    ["contenteditable", '<div id="t" contenteditable="true"></div>'],
    ["contenteditable descendant", '<div contenteditable><span id="t">x</span></div>'],
  ])("ignores keys typed into an editable target: %s", (_name, html) => {
    document.body.innerHTML = html;
    const { actions } = setup();
    const event = keydown("KeyW");
    document.getElementById("t")!.dispatchEvent(event);
    expect(actions).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
  });

  it("accepts keys from non-editable elements", () => {
    document.body.innerHTML =
      '<button id="t">Start</button><div contenteditable="false"><span id="u"></span></div>';
    const { actions } = setup();
    document.getElementById("t")!.dispatchEvent(keydown("KeyW"));
    document.getElementById("u")!.dispatchEvent(keydown("ArrowUp"));
    expect(actions.map((a) => a.playerId)).toEqual([1, 2]);
  });

  it("calls preventDefault for bound keys only", () => {
    setup();
    const bound = keydown("ArrowUp");
    const unbound = keydown("ArrowDown");
    document.dispatchEvent(bound);
    document.dispatchEvent(unbound);
    expect(bound.defaultPrevented).toBe(true);
    expect(unbound.defaultPrevented).toBe(false);
  });

  it("emits nothing before start() and after stop(); stop() removes the listener", () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    const remove = vi.spyOn(target, "removeEventListener");
    const source = createKeyboardInputSource({ target });
    const actions: PlayerAction[] = [];
    source.subscribe((a) => actions.push(a));

    target.dispatchEvent(keydown("KeyW"));
    expect(actions).toHaveLength(0);

    void source.start();
    target.dispatchEvent(keydown("KeyW"));
    expect(actions).toHaveLength(1);

    void source.stop();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]);
    target.dispatchEvent(keydown("KeyW"));
    expect(actions).toHaveLength(1);
  });

  it("has idempotent start() and stop(), and can start again", () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, "addEventListener");
    const remove = vi.spyOn(target, "removeEventListener");
    const source = createKeyboardInputSource({ target });
    const actions: PlayerAction[] = [];
    source.subscribe((a) => actions.push(a));
    void source.start();
    void source.start();
    expect(add).toHaveBeenCalledTimes(1);
    target.dispatchEvent(keydown("KeyW"));
    expect(actions).toHaveLength(1);
    void source.stop();
    void source.stop();
    expect(remove).toHaveBeenCalledTimes(1);
    void source.start();
    target.dispatchEvent(keydown("KeyW"));
    expect(actions).toHaveLength(2);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("works with a plain Event carrying a code (no KeyboardEvent needed)", () => {
    const target = new EventTarget();
    const source = createKeyboardInputSource({ target });
    const actions: PlayerAction[] = [];
    source.subscribe((a) => actions.push(a));
    void source.start();
    const event = Object.assign(new Event("keydown", { cancelable: true }), { code: "ArrowUp" });
    target.dispatchEvent(event);
    target.dispatchEvent(new Event("keydown")); // no code: ignored
    expect(actions.map((a) => a.playerId)).toEqual([2]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("unsubscribes listeners idempotently", () => {
    const source = createKeyboardInputSource({ target: document });
    const listener = vi.fn();
    const unsubscribe = source.subscribe(listener);
    void source.start();
    unsubscribe();
    unsubscribe();
    document.dispatchEvent(keydown("KeyW"));
    expect(listener).not.toHaveBeenCalled();
    void source.stop();
  });
});
