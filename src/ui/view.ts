import "./styles.css";
import { PLAYER_IDS } from "../shared";
import type {
  GameSnapshot,
  GameStatus,
  GestureKind,
  PerPlayer,
  PlayerId,
  VisionDiagnostics,
} from "../shared";
import {
  LOCAL_PROCESSING_NOTICE,
  announcementText,
  gestureDetectedLabel,
  gestureLabel,
  noticeText,
  playerName,
  points,
  trackingLabel,
} from "./copy";
import { createDebugOverlay } from "./debug-overlay";
import { createElementFactory, setAttributeIfChanged, setText } from "./dom";
import { drawFaceOverlay } from "./face-overlay";
import { controlSummary, createButton, renderKeyLegend, renderScreen } from "./screens";
import type { ScreenContext } from "./screens";
import type {
  Announcement,
  CameraPanelView,
  HudView,
  NoticeView,
  ScreenView,
  UiIntent,
  ViewModel,
} from "./view-model";

export interface AppViewOptions {
  /** KeyboardEvent.code values per player, for the legend and HUD (src/game's DEFAULT_KEY_BINDINGS). */
  readonly keyBindings: PerPlayer<readonly string[]>;
  readonly playerGestures: PerPlayer<GestureKind>;
  /** Whether the preview is mirrored (selfie view). Must match the vision session's option. */
  readonly mirrored: boolean;
  readonly onIntent: (intent: UiIntent) => void;
}

export interface AppView {
  /** Canvas for the game renderer. */
  readonly gameCanvas: HTMLCanvasElement;
  /** Camera preview element, owned by the UI and passed to the vision session (decision D-11). */
  readonly video: HTMLVideoElement;
  /** Render a new view model. Moves focus to the heading when the screen changes. */
  render(model: ViewModel): void;
  /** Per frame: scores and the canvas text alternative. Writes the DOM only on change. */
  updateGame(snapshot: GameSnapshot, now: number): void;
  /** Per frame: face rectangles and P1/P2 labels over the preview. */
  drawFaces(diagnostics: VisionDiagnostics | null): void;
  /** Refresh the debug overlay (no-op while hidden). */
  updateDebug(diagnostics: VisionDiagnostics | null): void;
  /** Add one line to the debug event log. */
  logEvent(entry: string): void;
  announce(announcement: Announcement): void;
  /** Clear timers and remove the view's DOM. */
  destroy(): void;
}

const PULSE_MS = 700;
const CANVAS_LABEL_INTERVAL_MS = 1000;
const STATUS_TEXT: Readonly<Record<GameStatus, string>> = {
  ready: "ready to start",
  running: "running",
  paused: "paused",
  "game-over": "round over",
};

interface HudParts {
  readonly item: HTMLLIElement;
  readonly score: HTMLElement;
  readonly control: HTMLElement;
  readonly camera: HTMLElement;
  readonly crashed: HTMLElement;
  readonly pulse: HTMLElement;
  lastCount: number | null;
  lastScore: number | null;
  pulseTimer: number | null;
}

function perPlayer<T>(make: (playerId: PlayerId) => T): PerPlayer<T> {
  return { 1: make(1), 2: make(2) };
}

/**
 * Build the application's DOM inside `root` and return an object that renders view models.
 * The view never talks to the game or the camera; it reports user actions as UiIntents.
 */
export function createAppView(root: HTMLElement, options: AppViewOptions): AppView {
  const doc = root.ownerDocument;
  const defaultView = doc.defaultView;
  if (!defaultView) {
    throw new Error("createAppView needs a root element in a document with a window");
  }
  // A non-null const, so hoisted helper functions see it as non-null too.
  const win = defaultView;
  const h = createElementFactory(doc);
  const ctx: ScreenContext = {
    h,
    keyBindings: options.keyBindings,
    playerGestures: options.playerGestures,
    onIntent: options.onIntent,
  };
  const timers = new Set<number>();

  // ---- Structure ----

  const live = h("div", {
    class: "vd-sr-only",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  const alert = h("div", {
    class: "vd-sr-only",
    role: "alert",
    "aria-live": "assertive",
    "aria-atomic": "true",
  });
  const notice = h("div", { class: "vd-notice", hidden: true });

  const stageHeading = h(
    "h2",
    { id: "vd-stage-heading", class: "vd-sr-only", tabindex: "-1" },
    "Game",
  );
  const cardSlot = h("div", { class: "vd-card-slot" });
  const overlaySlot = h("div", { class: "vd-overlay-slot" });
  const gameCanvas = h("canvas", { class: "vd-canvas", role: "img", "aria-label": "Game area" });

  const hudParts = perPlayer((playerId): HudParts => {
    const score = h("span", { class: "vd-hud-score" }, "0");
    const control = h("span", { class: "vd-hud-control" });
    const camera = h("span", { class: "vd-hud-camera", hidden: true });
    const crashed = h("span", { class: "vd-hud-crashed", hidden: true }, "Crashed");
    const pulse = h("span", { class: "vd-hud-pulse", "aria-hidden": "true" });
    const item = h(
      "li",
      { class: "vd-hud-player", "data-player": String(playerId) },
      h(
        "span",
        { class: "vd-hud-name" },
        h("span", { "aria-hidden": "true" }, `P${playerId}`),
        h("span", { class: "vd-sr-only" }, `${playerName(playerId)} score`),
      ),
      score,
      crashed,
      control,
      camera,
      pulse,
    );
    return {
      item,
      score,
      control,
      camera,
      crashed,
      pulse,
      lastCount: null,
      lastScore: null,
      pulseTimer: null,
    };
  });
  const pauseButton = createButton(ctx, "Pause", { type: "pause" }, { focusKey: "hud-pause" });
  const hud = h(
    "div",
    { class: "vd-hud", hidden: true },
    h(
      "ul",
      { class: "vd-hud-players", "aria-label": "Scores" },
      hudParts[1].item,
      hudParts[2].item,
    ),
    pauseButton,
  );

  const stage = h(
    "section",
    { class: "vd-stage", "aria-labelledby": "vd-stage-heading", "data-phase": "setup" },
    stageHeading,
    cardSlot,
    h(
      "div",
      { class: "vd-game" },
      hud,
      h("div", { class: "vd-canvas-wrap" }, gameCanvas, overlaySlot),
    ),
  );

  const video = h("video", {
    class: "vd-video",
    playsinline: true,
    muted: true,
    autoplay: true,
    "aria-label": options.mirrored ? "Camera preview, mirrored" : "Camera preview",
  });
  video.muted = true;
  const faceOverlay = h("canvas", { class: "vd-face-overlay", "aria-hidden": "true" });
  const previewStatus = h("p", { class: "vd-preview-status" }, "Starting the camera…");
  const faceItems = perPlayer((playerId) => h("li", { "data-player": String(playerId) }));
  const faceCount = h("p", { class: "vd-face-count" });
  const swapButton = createButton(ctx, "Swap players", { type: "swap-players" });
  const resetButton = createButton(ctx, "Reset assignment", { type: "reset-assignment" });
  const cameraOffButton = createButton(ctx, "Turn camera off", { type: "camera-off" });
  const cameraPanel = h(
    "aside",
    { class: "vd-camera", "aria-labelledby": "vd-camera-heading", hidden: true },
    h("h2", { id: "vd-camera-heading" }, "Camera"),
    h("p", { class: "vd-privacy-inline" }, LOCAL_PROCESSING_NOTICE),
    h(
      "div",
      { class: options.mirrored ? "vd-preview is-mirrored" : "vd-preview" },
      video,
      faceOverlay,
      previewStatus,
    ),
    h(
      "p",
      { class: "vd-side-hint" },
      h("span", null, "P1 on the left"),
      h("span", null, "P2 on the right"),
    ),
    h("ul", { class: "vd-face-list", "aria-label": "Face tracking" }, faceItems[1], faceItems[2]),
    faceCount,
    h("div", { class: "vd-actions" }, swapButton, resetButton, cameraOffButton),
  );

  const layout = h("div", { class: "vd-layout", "data-camera": "off" }, stage, cameraPanel);
  const debug = createDebugOverlay(h);
  const app = h(
    "div",
    { class: "vd-app" },
    h(
      "header",
      { class: "vd-header" },
      h("h1", null, "Vision Dino"),
      h("p", { class: "vd-tagline" }, "Two players, one webcam: blink or open your mouth to jump."),
    ),
    live,
    alert,
    notice,
    layout,
    renderKeyLegend(ctx),
    debug.element,
  );
  root.replaceChildren(app);

  // ---- Rendering ----

  let rendered = false;
  let screenId: ScreenView["id"] | null = null;
  let screenSignature = "";
  let card: HTMLElement | null = null;
  let noticeSignature = "null";

  const isUsable = (element: Element): boolean =>
    element.isConnected &&
    element.closest("[hidden]") === null &&
    !element.hasAttribute("disabled");

  const focusHeading = (): void => {
    const heading = card?.querySelector<HTMLElement>("[data-screen-heading]") ?? stageHeading;
    heading.focus();
  };

  function renderScreenCard(screen: ScreenView, gamePhase: boolean): void {
    const signature = JSON.stringify(screen);
    if (signature === screenSignature) return;
    const changed = screen.id !== screenId;
    const active = doc.activeElement;
    const focusWasInCard = active !== null && card !== null && card.contains(active);
    const focusKey = focusWasInCard ? active.getAttribute("data-focus-key") : null;

    card?.remove();
    card = renderScreen(ctx, screen);
    if (card) (gamePhase ? overlaySlot : cardSlot).append(card);
    screenId = screen.id;
    screenSignature = signature;

    if (!rendered) return;
    if (changed) {
      focusHeading();
    } else if (focusWasInCard) {
      const target = focusKey
        ? card?.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)
        : null;
      if (target && isUsable(target)) target.focus();
      else focusHeading();
    }
  }

  function renderHud(view: HudView): void {
    hud.hidden = !view.visible;
    pauseButton.hidden = !view.canPause;
    for (const playerId of PLAYER_IDS) {
      const parts = hudParts[playerId];
      const player = view.players[playerId];
      setText(
        parts.control,
        controlSummary(player.gesture, options.keyBindings[playerId], player.control),
      );
      parts.camera.hidden = player.tracking === null;
      setText(parts.camera, trackingLabel(player.tracking));
      parts.item.dataset.tracking = player.tracking ?? "keyboard";
      if (parts.lastCount !== null && player.gestureCount > parts.lastCount) {
        pulse(parts, player.gesture);
      }
      parts.lastCount = player.gestureCount;
    }
  }

  function pulse(parts: HudParts, gesture: GestureKind): void {
    setText(parts.pulse, gestureDetectedLabel(gesture));
    parts.pulse.classList.add("is-active");
    if (parts.pulseTimer !== null) {
      win.clearTimeout(parts.pulseTimer);
      timers.delete(parts.pulseTimer);
    }
    const timer = win.setTimeout(() => {
      parts.pulse.classList.remove("is-active");
      timers.delete(timer);
      parts.pulseTimer = null;
    }, PULSE_MS);
    timers.add(timer);
    parts.pulseTimer = timer;
  }

  function renderCamera(view: CameraPanelView | null): void {
    cameraPanel.hidden = view === null;
    layout.dataset.camera = view ? "on" : "off";
    if (!view) {
      clearFaceOverlay();
      return;
    }
    previewStatus.hidden = !view.starting;
    for (const playerId of PLAYER_IDS) {
      const onCamera = view.controls[playerId] === "camera";
      const tracking = onCamera ? view.tracking[playerId] : null;
      setText(
        faceItems[playerId],
        `P${playerId} · ${gestureLabel(options.playerGestures[playerId])}: ${trackingLabel(tracking)}`,
      );
      faceItems[playerId].dataset.tracking = tracking ?? "keyboard";
    }
    setText(faceCount, `Faces detected: ${view.facesDetected}`);
    swapButton.disabled = !view.canAdjustAssignment;
    resetButton.disabled = !view.canAdjustAssignment;
  }

  function renderNotice(view: NoticeView | null): void {
    const signature = JSON.stringify(view);
    if (signature === noticeSignature) return;
    noticeSignature = signature;
    notice.hidden = view === null;
    if (!view) {
      notice.replaceChildren();
      delete notice.dataset.kind;
      return;
    }
    notice.dataset.kind = view.kind;
    const canRetry = view.kind !== "players-reassigned" && view.canRetry;
    notice.replaceChildren(
      h("p", { class: "vd-notice-text" }, noticeText(view)),
      h(
        "div",
        { class: "vd-actions" },
        canRetry &&
          createButton(
            ctx,
            "Try the camera again",
            { type: "play-with-camera" },
            {
              focusKey: "notice-retry",
            },
          ),
        createButton(ctx, "Dismiss", { type: "dismiss-notice" }, { focusKey: "notice-dismiss" }),
      ),
    );
  }

  // ---- Per-frame updates ----

  let lastStatus: GameStatus | null = null;
  let lastLabelAt = Number.NEGATIVE_INFINITY;
  let overlayCtx: CanvasRenderingContext2D | null = null;
  let overlayDrawn = false;
  let lastOverlay = { frame: null as number | null, width: 0, height: 0 };

  function canvasLabel(snapshot: GameSnapshot): string {
    const players = PLAYER_IDS.map((playerId) => {
      const player = snapshot.players[playerId];
      return `${playerName(playerId)}: ${points(player.score)}${player.crashed ? ", crashed" : ""}.`;
    });
    return `Game area, ${STATUS_TEXT[snapshot.status]}. ${players.join(" ")}`;
  }

  function clearFaceOverlay(): void {
    if (!overlayDrawn || !overlayCtx) return;
    overlayCtx.setTransform(1, 0, 0, 1, 0, 0);
    overlayCtx.clearRect(0, 0, faceOverlay.width, faceOverlay.height);
    overlayDrawn = false;
    lastOverlay = { frame: null, width: 0, height: 0 };
  }

  return {
    gameCanvas,
    video,

    render(model) {
      const before = doc.activeElement;
      const focusWasInApp = before !== null && before !== doc.body && app.contains(before);

      renderScreenCard(model.screen, model.hud.visible);
      stage.dataset.phase = model.hud.visible ? "game" : "setup";
      renderHud(model.hud);
      renderCamera(model.camera);
      renderNotice(model.notice);
      debug.setVisible(model.debugVisible);

      // If the focused control disappeared or became unusable, keep focus in the app.
      if (rendered && focusWasInApp) {
        const now = doc.activeElement;
        if (now === null || now === doc.body || !isUsable(now)) focusHeading();
      }
      rendered = true;
    },

    updateGame(snapshot, now) {
      for (const playerId of PLAYER_IDS) {
        const parts = hudParts[playerId];
        const player = snapshot.players[playerId];
        if (parts.lastScore !== player.score) {
          parts.lastScore = player.score;
          setText(parts.score, String(player.score));
        }
        if (parts.crashed.hidden === player.crashed) parts.crashed.hidden = !player.crashed;
      }
      if (snapshot.status !== lastStatus || now - lastLabelAt >= CANVAS_LABEL_INTERVAL_MS) {
        lastStatus = snapshot.status;
        lastLabelAt = now;
        setAttributeIfChanged(gameCanvas, "aria-label", canvasLabel(snapshot));
      }
    },

    drawFaces(diagnostics) {
      if (cameraPanel.hidden || !diagnostics) {
        clearFaceOverlay();
        return;
      }
      const width = faceOverlay.clientWidth;
      const height = faceOverlay.clientHeight;
      if (width === 0 || height === 0) return;
      if (
        overlayDrawn &&
        diagnostics.frameTimestamp === lastOverlay.frame &&
        width === lastOverlay.width &&
        height === lastOverlay.height
      ) {
        return;
      }
      const ratio = win.devicePixelRatio || 1;
      const backingWidth = Math.round(width * ratio);
      const backingHeight = Math.round(height * ratio);
      if (faceOverlay.width !== backingWidth) faceOverlay.width = backingWidth;
      if (faceOverlay.height !== backingHeight) faceOverlay.height = backingHeight;
      overlayCtx ??= faceOverlay.getContext("2d");
      if (!overlayCtx) return;
      drawFaceOverlay(
        overlayCtx,
        { width, height, pixelRatio: ratio },
        { width: video.videoWidth, height: video.videoHeight },
        diagnostics,
      );
      overlayDrawn = true;
      lastOverlay = { frame: diagnostics.frameTimestamp, width, height };
    },

    updateDebug(diagnostics) {
      debug.update(diagnostics);
    },

    logEvent(entry) {
      debug.log(entry);
    },

    announce(announcement) {
      const { text, politeness } = announcementText(announcement);
      const region = politeness === "assertive" ? alert : live;
      // Re-announce identical text by making it differ invisibly (a trailing no-break space).
      region.textContent =
        region.textContent === text ? `${text}${String.fromCharCode(0xa0)}` : text;
    },

    destroy() {
      for (const timer of timers) win.clearTimeout(timer);
      timers.clear();
      root.replaceChildren();
    },
  };
}
