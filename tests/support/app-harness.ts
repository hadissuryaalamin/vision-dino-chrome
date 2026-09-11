import { createApp } from "../../src/app/create-app";
import type { AppHandle } from "../../src/app/create-app";
import type { PerPlayer } from "../../src/shared";
import { FakeGameController } from "./fake-game";
import { FakeInputSource } from "./fake-input";
import { createFakeVisionFactory } from "./fake-vision";
import type { FakeVisionFactory, FakeVisionSession } from "./fake-vision";
import { ManualFrameScheduler } from "./frame-scheduler";

/** Same values as src/game's planned DEFAULT_KEY_BINDINGS. */
export const TEST_KEY_BINDINGS: PerPlayer<readonly string[]> = { 1: ["KeyW"], 2: ["ArrowUp"] };

export interface HarnessOptions {
  readonly cameraSupported?: boolean;
  readonly search?: string;
  /** Runs on every vision session the fake factory creates (e.g. queue start results). */
  readonly configureSession?: (session: FakeVisionSession) => void;
}

const KEY_CODES: Readonly<Record<string, string>> = {
  Enter: "Enter",
  Escape: "Escape",
  p: "KeyP",
  P: "KeyP",
  "`": "Backquote",
  w: "KeyW",
  ArrowUp: "ArrowUp",
};

export interface AppHarness {
  readonly root: HTMLElement;
  readonly app: AppHandle;
  readonly game: FakeGameController;
  /** The keyboard source createApp created (options.target is what it listens on). */
  readonly keyboard: FakeInputSource;
  readonly vision: FakeVisionFactory;
  readonly scheduler: ManualFrameScheduler;
  readonly gameCanvases: readonly HTMLCanvasElement[];
  /** The latest vision session; throws if the app never created one. */
  readonly session: FakeVisionSession;
  queryButton(name: string): HTMLButtonElement | null;
  button(name: string): HTMLButtonElement;
  click(name: string): void;
  /** Dispatch a keydown at the focused element (or `target`), bubbling to window. */
  press(
    key: string,
    init?: { code?: string; target?: EventTarget; repeat?: boolean },
  ): KeyboardEvent;
  /** data-screen of the current card, or null when no card is shown (playing). */
  screen(): string | null;
  heading(): HTMLElement | null;
  text(selector: string): string;
  liveText(): string;
  alertText(): string;
  /** Let pending promises (e.g. VisionSession.start) settle. */
  flush(): Promise<void>;
  dispose(): Promise<void>;
}

/** Mount createApp in jsdom with fakes for every dependency. */
export function createAppHarness(options: HarnessOptions = {}): AppHarness {
  const root = document.createElement("main");
  root.id = "app";
  document.body.append(root);

  const game = new FakeGameController();
  const keyboards: FakeInputSource[] = [];
  const gameCanvases: HTMLCanvasElement[] = [];
  const vision = createFakeVisionFactory(options.configureSession);
  const scheduler = new ManualFrameScheduler();

  const app = createApp(root, {
    createGame: ({ canvas }) => {
      gameCanvases.push(canvas);
      return game;
    },
    createKeyboardInputSource: (keyboardOptions) => {
      const source = new FakeInputSource(keyboardOptions);
      keyboards.push(source);
      return source;
    },
    createVisionSession: vision.factory,
    isCameraSupported: () => options.cameraSupported ?? true,
    keyBindings: TEST_KEY_BINDINGS,
    frameScheduler: scheduler,
    search: options.search ?? "",
  });

  const keyboard = keyboards[0];
  if (!keyboard) throw new Error("createApp did not create a keyboard input source");

  const visibleButtons = (): HTMLButtonElement[] =>
    [...root.querySelectorAll("button")].filter((button) => button.closest("[hidden]") === null);

  const queryButton = (name: string): HTMLButtonElement | null =>
    visibleButtons().find((button) => button.textContent.trim() === name) ?? null;

  const button = (name: string): HTMLButtonElement => {
    const found = queryButton(name);
    if (!found) {
      const names = visibleButtons().map((candidate) => candidate.textContent.trim());
      throw new Error(`No visible button "${name}". Visible: ${names.join(", ")}`);
    }
    return found;
  };

  const text = (selector: string): string => root.querySelector(selector)?.textContent.trim() ?? "";

  return {
    root,
    app,
    game,
    keyboard,
    vision,
    scheduler,
    gameCanvases,
    get session() {
      return vision.session;
    },
    queryButton,
    button,
    click: (name) => button(name).click(),
    press: (key, init = {}) => {
      const event = new KeyboardEvent("keydown", {
        key,
        code: init.code ?? KEY_CODES[key] ?? key,
        repeat: init.repeat ?? false,
        bubbles: true,
        cancelable: true,
      });
      (init.target ?? document.activeElement ?? document.body).dispatchEvent(event);
      return event;
    },
    screen: () => root.querySelector("[data-screen]")?.getAttribute("data-screen") ?? null,
    heading: () => root.querySelector<HTMLElement>("[data-screen-heading]"),
    text,
    liveText: () => text('[role="status"]'),
    alertText: () => text('[role="alert"]'),
    flush: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
    dispose: async () => {
      await app.destroy();
      root.remove();
    },
  };
}
