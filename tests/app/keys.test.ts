import { describe, expect, it } from "vitest";
import { appKeyCommand } from "../../src/app/keys";
import type { AppKeyEvent } from "../../src/app/keys";

function key(overrides: Omit<Partial<AppKeyEvent>, "target"> & { target?: unknown }): AppKeyEvent {
  return {
    key: "",
    code: "",
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...overrides,
    target: (overrides.target ?? null) as EventTarget | null,
  };
}

const element = (
  tagName: string,
  attributes: Record<string, string> = {},
  contentEditable = false,
) => ({
  tagName,
  isContentEditable: contentEditable,
  getAttribute: (name: string) => attributes[name] ?? null,
});

describe("appKeyCommand", () => {
  it("maps Enter, P, Escape and Backquote", () => {
    expect(appKeyCommand(key({ key: "Enter", code: "Enter" }))).toBe("start-or-restart");
    expect(appKeyCommand(key({ key: "p", code: "KeyP" }))).toBe("toggle-pause");
    expect(appKeyCommand(key({ key: "P", code: "KeyP" }))).toBe("toggle-pause");
    expect(appKeyCommand(key({ key: "Escape", code: "Escape" }))).toBe("toggle-pause");
    expect(appKeyCommand(key({ key: "`", code: "Backquote" }))).toBe("toggle-debug");
  });

  it("leaves player keys and other keys alone", () => {
    expect(appKeyCommand(key({ key: "w", code: "KeyW" }))).toBeNull();
    expect(appKeyCommand(key({ key: "ArrowUp", code: "ArrowUp" }))).toBeNull();
    expect(appKeyCommand(key({ key: " ", code: "Space" }))).toBeNull();
  });

  it("ignores Enter on elements that activate themselves", () => {
    for (const target of [
      element("BUTTON"),
      element("a"),
      element("SUMMARY"),
      element("DIV", { role: "button" }),
    ]) {
      expect(appKeyCommand(key({ key: "Enter", target }))).toBeNull();
    }
    // A focused heading (focus target after a screen change) is not a control.
    expect(appKeyCommand(key({ key: "Enter", target: element("H2") }))).toBe("start-or-restart");
  });

  it("still pauses with P or Escape while a button has focus", () => {
    expect(appKeyCommand(key({ key: "p", code: "KeyP", target: element("BUTTON") }))).toBe(
      "toggle-pause",
    );
    expect(appKeyCommand(key({ key: "Escape", target: element("BUTTON") }))).toBe("toggle-pause");
  });

  it("ignores typing in editable elements", () => {
    for (const target of [element("INPUT"), element("TEXTAREA"), element("DIV", {}, true)]) {
      expect(appKeyCommand(key({ key: "p", code: "KeyP", target }))).toBeNull();
      expect(appKeyCommand(key({ key: "`", code: "Backquote", target }))).toBeNull();
    }
  });

  it("ignores auto-repeat and modifier chords", () => {
    expect(appKeyCommand(key({ key: "Enter", repeat: true }))).toBeNull();
    expect(appKeyCommand(key({ key: "p", code: "KeyP", ctrlKey: true }))).toBeNull();
    expect(appKeyCommand(key({ key: "p", code: "KeyP", altKey: true }))).toBeNull();
    expect(appKeyCommand(key({ key: "Enter", metaKey: true }))).toBeNull();
  });
});
