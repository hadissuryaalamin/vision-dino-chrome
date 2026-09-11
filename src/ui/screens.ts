import { PLAYER_IDS } from "../shared";
import type { GestureKind, PerPlayer, PlayerId } from "../shared";
import {
  LOCAL_PROCESSING_NOTICE,
  VISION_ERROR_COPY,
  calibrationFailureText,
  calibrationStepInstruction,
  facesDetectedText,
  gestureCommand,
  gestureLabel,
  gesturePhrase,
  keyName,
  playerName,
  resultText,
} from "./copy";
import type { ElementFactory } from "./dom";
import type { CalibrationPlayerView, PlayerControl, ScreenView, UiIntent } from "./view-model";

export interface ScreenContext {
  readonly h: ElementFactory;
  readonly keyBindings: PerPlayer<readonly string[]>;
  readonly playerGestures: PerPlayer<GestureKind>;
  readonly onIntent: (intent: UiIntent) => void;
}

export interface ButtonOptions {
  /** Stable key used to restore focus when a screen re-renders. */
  readonly focusKey?: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly describedBy?: string;
}

export function createButton(
  ctx: Pick<ScreenContext, "h" | "onIntent">,
  label: string,
  intent: UiIntent,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const button = ctx.h(
    "button",
    {
      type: "button",
      class: options.primary ? "vd-button vd-button--primary" : "vd-button",
      "data-focus-key": options.focusKey ?? intent.type,
      "aria-describedby": options.describedBy,
    },
    label,
  );
  button.disabled = options.disabled ?? false;
  button.addEventListener("click", () => ctx.onIntent(intent));
  return button;
}

/** Keys as `<kbd>` elements with a spoken name for screen readers, joined with "or". */
export function renderKeys(h: ElementFactory, codes: readonly string[]): (Node | string)[] {
  const nodes: (Node | string)[] = [];
  codes.forEach((code, index) => {
    if (index > 0) nodes.push(" or ");
    const { label, spoken } = keyName(code);
    nodes.push(
      label === spoken
        ? h("kbd", null, label)
        : h(
            "kbd",
            null,
            h("span", { "aria-hidden": "true" }, label),
            h("span", { class: "vd-sr-only" }, spoken),
          ),
    );
  });
  return nodes;
}

function keysText(codes: readonly string[]): string {
  return codes.map((code) => keyName(code).label).join(" or ");
}

/**
 * Build the card for a screen, or null for screens without one (playing). The card's heading
 * carries `data-screen-heading` and `tabindex="-1"` so focus can move to it.
 */
export function renderScreen(ctx: ScreenContext, screen: ScreenView): HTMLElement | null {
  switch (screen.id) {
    case "welcome":
      return welcome(ctx, screen.cameraSupported);
    case "camera-starting":
      return cameraStarting(ctx, screen.phase);
    case "camera-error":
      return cameraError(ctx, screen);
    case "positioning":
      return positioning(ctx, screen.facesDetected);
    case "calibrating":
      return calibrating(ctx, screen);
    case "ready":
      return ready(ctx, screen.controls, screen.canUseCamera);
    case "playing":
      return null;
    case "paused":
      return card(
        ctx,
        "paused",
        "Paused",
        ctx.h("p", null, "Press P, Esc or Enter, or choose Resume, to continue."),
        actions(
          ctx,
          createButton(ctx, "Resume", { type: "resume" }, { primary: true }),
          createButton(ctx, "Restart", { type: "restart" }),
        ),
      );
    case "game-over":
      return card(
        ctx,
        "game-over",
        "Game over",
        ctx.h("p", { class: "vd-result" }, resultText(screen.result)),
        ctx.h("p", null, "Press Enter or choose Play again."),
        actions(
          ctx,
          createButton(ctx, "Play again", { type: "start" }, { primary: true }),
          screen.canUseCamera &&
            createButton(ctx, "Play with camera", { type: "play-with-camera" }),
        ),
      );
  }
}

function card(
  ctx: ScreenContext,
  id: ScreenView["id"],
  title: string,
  ...content: (Node | false | null)[]
): HTMLElement {
  const { h } = ctx;
  return h(
    "div",
    { class: `vd-card vd-card--${id}`, "data-screen": id },
    h("h2", { class: "vd-card-title", tabindex: "-1", "data-screen-heading": true }, title),
    ...content,
  );
}

function actions(
  ctx: ScreenContext,
  ...buttons: (HTMLButtonElement | false | null)[]
): HTMLElement {
  return ctx.h("div", { class: "vd-actions" }, ...buttons);
}

function keyboardOnlyButton(ctx: ScreenContext, primary = false): HTMLButtonElement {
  return createButton(ctx, "Keyboard only", { type: "keyboard-only" }, { primary });
}

function playerControlsList(ctx: ScreenContext, controls?: PerPlayer<PlayerControl>): HTMLElement {
  const { h } = ctx;
  return h(
    "ul",
    { class: "vd-player-controls" },
    ...PLAYER_IDS.map((playerId) => {
      const side = playerId === 1 ? "left" : "right";
      const keys = renderKeys(h, ctx.keyBindings[playerId]);
      const gesture = ctx.playerGestures[playerId];
      if (controls?.[playerId] === "keyboard") {
        return h("li", null, `${playerName(playerId)} presses `, ...keys, ".");
      }
      if (controls) {
        return h(
          "li",
          null,
          `${playerName(playerId)}: ${gestureCommand(gesture)} or press `,
          ...keys,
          ".",
        );
      }
      return h(
        "li",
        null,
        `${playerName(playerId)} (on the ${side}) jumps by ${gesturePhrase(gesture)}, or with `,
        ...keys,
        ".",
      );
    }),
  );
}

function welcome(ctx: ScreenContext, cameraSupported: boolean): HTMLElement {
  const { h } = ctx;
  return card(
    ctx,
    "welcome",
    "Two players, one webcam",
    h(
      "p",
      null,
      "Race side by side over the same obstacles. The last dino still running wins. The keyboard always works too.",
    ),
    playerControlsList(ctx),
    h(
      "div",
      { class: "vd-privacy", id: "vd-privacy-notice" },
      h("p", null, h("strong", null, "Your camera stays private. "), LOCAL_PROCESSING_NOTICE),
      h(
        "p",
        null,
        "Your browser asks for camera permission only after you choose Play with camera. You can turn the camera off at any time.",
      ),
    ),
    !cameraSupported &&
      h(
        "p",
        { class: "vd-unavailable", id: "vd-camera-unavailable" },
        "Camera play is not available in this browser or on this page: it needs camera support and a secure (https:// or localhost) address. You can still play with the keyboard.",
      ),
    actions(
      ctx,
      createButton(
        ctx,
        "Play with camera",
        { type: "play-with-camera" },
        {
          primary: cameraSupported,
          disabled: !cameraSupported,
          describedBy: cameraSupported ? "vd-privacy-notice" : "vd-camera-unavailable",
        },
      ),
      keyboardOnlyButton(ctx, !cameraSupported),
    ),
  );
}

function cameraStarting(
  ctx: ScreenContext,
  phase: "requesting-camera" | "loading-model",
): HTMLElement {
  const { h } = ctx;
  const requesting = phase === "requesting-camera";
  return card(
    ctx,
    "camera-starting",
    requesting ? "Waiting for camera permission" : "Loading face tracking",
    h(
      "p",
      null,
      requesting
        ? "Allow camera access in your browser's prompt. If no prompt appears, check the camera icon in the address bar."
        : "This can take a few seconds the first time.",
    ),
    h("progress", { class: "vd-progress", "aria-label": "Starting the camera" }),
    h("p", { class: "vd-privacy-inline" }, LOCAL_PROCESSING_NOTICE),
    actions(ctx, keyboardOnlyButton(ctx)),
  );
}

function cameraError(
  ctx: ScreenContext,
  screen: Extract<ScreenView, { id: "camera-error" }>,
): HTMLElement {
  const { h } = ctx;
  const copy = VISION_ERROR_COPY[screen.code];
  const canRetry = copy.canRetry && screen.cameraSupported;
  return card(
    ctx,
    "camera-error",
    copy.title,
    h("p", null, copy.body),
    h("ol", { class: "vd-steps" }, ...copy.steps.map((step) => h("li", null, step))),
    actions(
      ctx,
      canRetry &&
        createButton(
          ctx,
          "Try again",
          { type: "play-with-camera" },
          { primary: true, focusKey: "retry" },
        ),
      keyboardOnlyButton(ctx, !canRetry),
    ),
  );
}

function positioning(ctx: ScreenContext, facesDetected: number): HTMLElement {
  const { h } = ctx;
  return card(
    ctx,
    "positioning",
    "Get into position",
    h(
      "p",
      null,
      h("strong", null, "Player 1 on the left, Player 2 on the right. "),
      "Sit side by side facing the camera, close enough that both faces are clearly visible in the preview.",
    ),
    h(
      "p",
      { class: "vd-face-status", "data-faces": String(Math.min(facesDetected, 3)) },
      facesDetectedText(facesDetected),
    ),
    facesDetected === 1 &&
      h(
        "p",
        { class: "vd-hint", id: "vd-one-player-hint" },
        "With one player, the face's side of the preview decides the player (left: Player 1, right: Player 2). The other player uses the keyboard.",
      ),
    actions(
      ctx,
      createButton(
        ctx,
        "Continue",
        { type: "continue-two-players" },
        { primary: true, disabled: facesDetected < 2 },
      ),
      facesDetected === 1 &&
        createButton(
          ctx,
          "Continue with one player",
          { type: "continue-one-player" },
          { describedBy: "vd-one-player-hint" },
        ),
      keyboardOnlyButton(ctx),
    ),
  );
}

function calibrationPlayerItem(ctx: ScreenContext, player: CalibrationPlayerView): HTMLElement {
  const { h } = ctx;
  const gesture = ctx.playerGestures[player.playerId];
  const name = `${playerName(player.playerId)} · ${gestureLabel(gesture)}`;
  if (player.control === "keyboard") {
    return h(
      "li",
      { class: "vd-calibration-player", "data-status": "keyboard" },
      h("strong", null, playerName(player.playerId)),
      " uses the keyboard.",
    );
  }
  let status: string;
  switch (player.status) {
    case "waiting":
      status = "Waiting to start…";
      break;
    case "in-progress":
      status = player.step ? calibrationStepInstruction(player.step, gesture) : "Measuring…";
      break;
    case "complete":
      status = player.mode === "default" ? "Using the default settings." : "Calibrated.";
      break;
    case "failed":
      status = "Not calibrated.";
      break;
  }
  const progress = h("progress", {
    class: "vd-progress",
    max: "1",
    "aria-label": `${playerName(player.playerId)} calibration progress`,
  });
  progress.value = player.progress;
  return h(
    "li",
    { class: "vd-calibration-player", "data-status": player.status },
    h("strong", null, name),
    h("span", { class: "vd-calibration-status" }, status),
    progress,
  );
}

function calibrating(
  ctx: ScreenContext,
  screen: Extract<ScreenView, { id: "calibrating" }>,
): HTMLElement {
  const { h } = ctx;
  const failure = screen.failure
    ? calibrationFailureText(screen.failure.playerId, screen.failure.reason)
    : null;
  return card(
    ctx,
    "calibrating",
    "Calibration",
    h(
      "p",
      null,
      screen.assigning
        ? "Hold still and face the camera: Player 1 on the left, Player 2 on the right."
        : "Follow the step for your player. First look at the screen with your eyes open and your mouth closed; then Player 1 blinks firmly three times and Player 2 opens their mouth wide three times.",
    ),
    h(
      "ul",
      { class: "vd-calibration-players" },
      ...PLAYER_IDS.map((playerId: PlayerId) =>
        calibrationPlayerItem(ctx, screen.players[playerId]),
      ),
    ),
    failure &&
      h(
        "div",
        { class: "vd-failure" },
        h("p", null, h("strong", null, failure.title)),
        h("p", null, failure.body),
      ),
    h(
      "p",
      { class: "vd-privacy-inline" },
      "Calibration is measured in this browser and forgotten when you leave the page.",
    ),
    actions(
      ctx,
      createButton(
        ctx,
        failure ? "Retry calibration" : "Restart calibration",
        { type: "calibration-retry" },
        { primary: failure !== null, focusKey: "retry" },
      ),
      createButton(ctx, "Use default settings", { type: "calibration-use-defaults" }),
      keyboardOnlyButton(ctx),
    ),
  );
}

function ready(
  ctx: ScreenContext,
  controls: PerPlayer<PlayerControl>,
  canUseCamera: boolean,
): HTMLElement {
  const { h } = ctx;
  return card(
    ctx,
    "ready",
    "Ready",
    playerControlsList(ctx, controls),
    h("p", null, "Press Enter or choose Start. Pause at any time with P or Esc."),
    actions(
      ctx,
      createButton(ctx, "Start", { type: "start" }, { primary: true }),
      canUseCamera && createButton(ctx, "Play with camera", { type: "play-with-camera" }),
    ),
  );
}

/** The always-visible controls legend, built from the key bindings and gesture mapping. */
export function renderKeyLegend(ctx: ScreenContext): HTMLElement {
  const { h } = ctx;
  const row = (term: string, ...description: (Node | string)[]) =>
    h("div", { class: "vd-legend-row" }, h("dt", null, term), h("dd", null, ...description));
  return h(
    "section",
    { class: "vd-legend", "aria-labelledby": "vd-legend-heading" },
    h("h2", { id: "vd-legend-heading" }, "Controls"),
    h(
      "dl",
      null,
      ...PLAYER_IDS.map((playerId) =>
        row(
          `${playerName(playerId)} jump`,
          ...renderKeys(h, ctx.keyBindings[playerId]),
          `, or ${gestureLabel(ctx.playerGestures[playerId])} (camera)`,
        ),
      ),
      row("Start or restart", ...renderKeys(h, ["Enter"])),
      row("Pause or resume", ...renderKeys(h, ["KeyP", "Escape"])),
      row("Debug overlay", ...renderKeys(h, ["Backquote"])),
    ),
  );
}

/** Short text for the HUD: "Blink or W" or "W". */
export function controlSummary(
  gesture: GestureKind,
  keys: readonly string[],
  control: PlayerControl,
): string {
  const keyText = keysText(keys);
  if (control === "keyboard") return keyText;
  const label = gestureLabel(gesture);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} or ${keyText}`;
}
