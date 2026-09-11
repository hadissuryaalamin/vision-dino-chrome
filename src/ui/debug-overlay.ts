import { PLAYER_IDS } from "../shared";
import type {
  GameEvent,
  NormalizedRect,
  PlayerVisionDiagnostics,
  VisionDiagnostics,
  VisionEvent,
} from "../shared";
import { setText } from "./dom";
import type { ElementFactory } from "./dom";

const NONE = "—";
const MAX_LOG_ENTRIES = 15;

export function formatNumber(value: number | null, digits = 2): string {
  return value === null || !Number.isFinite(value) ? NONE : value.toFixed(digits);
}

export function formatRect(rect: NormalizedRect | null): string {
  if (!rect) return NONE;
  return [rect.x, rect.y, rect.width, rect.height].map((value) => value.toFixed(2)).join(", ");
}

type PlayerField = readonly [label: string, read: (player: PlayerVisionDiagnostics) => string];
type GlobalField = readonly [label: string, read: (diagnostics: VisionDiagnostics) => string];

/** Every PlayerVisionDiagnostics field (docs/architecture.md §10.9). */
const PLAYER_FIELDS: readonly PlayerField[] = [
  ["Tracking", (p) => p.tracking],
  ["Face rect (x, y, w, h)", (p) => formatRect(p.faceRect)],
  ["Last seen (ms)", (p) => formatNumber(p.lastSeenAt, 0)],
  ["Gesture", (p) => p.gesture.gesture],
  ["Raw metric", (p) => formatNumber(p.gesture.rawMetric, 3)],
  ["Score", (p) => formatNumber(p.gesture.score)],
  ["Enter threshold", (p) => formatNumber(p.gesture.enterThreshold)],
  ["Exit threshold", (p) => formatNumber(p.gesture.exitThreshold)],
  ["Detector state", (p) => p.gesture.state],
  ["Cooldown left (ms)", (p) => formatNumber(p.gesture.cooldownRemainingMs, 0)],
  ["Last gesture (ms)", (p) => formatNumber(p.gesture.lastGestureAt, 0)],
  ["Calibration", (p) => p.gesture.calibration],
];

const GLOBAL_FIELDS: readonly GlobalField[] = [
  ["Status", (d) => d.status],
  ["Mirrored", (d) => (d.mirrored ? "yes" : "no")],
  ["Faces detected", (d) => String(d.facesDetected)],
  ["Unassigned faces", (d) => String(d.unassignedFaces.length)],
  ["Processing fps", (d) => formatNumber(d.processingFps, 1)],
  ["Inference (ms)", (d) => formatNumber(d.inferenceMs, 1)],
  ["Frame time (ms)", (d) => formatNumber(d.frameTimestamp, 0)],
];

/** One line for the debug event log, or null for events too frequent to log. */
export function describeVisionEvent(event: VisionEvent): string | null {
  const at = `${event.timestamp.toFixed(0)} ms`;
  switch (event.type) {
    case "status-changed":
      return `${at} · vision ${event.previous} → ${event.status}`;
    case "error":
      return `${at} · error ${event.error.code}`;
    case "faces-changed":
      return `${at} · faces ${event.count}`;
    case "players-assigned":
      return `${at} · players assigned (${event.reason})`;
    case "face-lost":
      return `${at} · P${event.playerId} face lost`;
    case "face-found":
      return `${at} · P${event.playerId} face found`;
    case "gesture":
      return `${at} · P${event.playerId} ${event.gesture}`;
    case "calibration-progress":
      return null;
    case "calibration-complete":
      return `${at} · P${event.playerId} calibration ${event.mode}`;
    case "calibration-failed":
      return `${at} · ${event.playerId === null ? "" : `P${event.playerId} `}calibration failed (${event.reason})`;
  }
}

export function describeGameEvent(event: GameEvent): string {
  const at = `game ${event.elapsedMs.toFixed(0)} ms`;
  switch (event.type) {
    case "status-changed":
      return `${at} · game ${event.previous} → ${event.status}`;
    case "player-jumped":
      return `${at} · P${event.playerId} jumped`;
    case "player-crashed":
      return `${at} · P${event.playerId} crashed (${event.score})`;
    case "game-over":
      return `${at} · game over, winner ${event.result.winner === null ? "tie" : `P${event.result.winner}`}`;
  }
}

export interface DebugOverlay {
  readonly element: HTMLElement;
  setVisible(visible: boolean): void;
  /** Cheap enough to call often: builds no elements and writes only changed text. */
  update(diagnostics: VisionDiagnostics | null): void;
  log(entry: string): void;
}

/** Diagnostics tables built once; `update` only rewrites cell text that changed. */
export function createDebugOverlay(h: ElementFactory): DebugOverlay {
  const globalCells = GLOBAL_FIELDS.map(() => h("td", null, NONE));
  const playerCells = PLAYER_FIELDS.map(() => PLAYER_IDS.map(() => h("td", null, NONE)));
  const logList = h("ol", { class: "vd-debug-log", reversed: true });
  const entries: string[] = [];
  let visible = false;
  let logDirty = false;

  const element = h(
    "section",
    { class: "vd-debug", "aria-labelledby": "vd-debug-heading", hidden: true },
    h("h2", { id: "vd-debug-heading" }, "Vision debug"),
    h("p", { class: "vd-debug-note" }, "Diagnostics stay in this page's memory. Press ` to hide."),
    h(
      "table",
      { class: "vd-debug-table" },
      h("caption", null, "Session"),
      h(
        "tbody",
        null,
        ...GLOBAL_FIELDS.map(([label], index) =>
          h("tr", null, h("th", { scope: "row" }, label), globalCells[index] ?? null),
        ),
      ),
    ),
    h(
      "table",
      { class: "vd-debug-table" },
      h("caption", null, "Players"),
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", { scope: "col" }, "Field"),
          ...PLAYER_IDS.map((playerId) => h("th", { scope: "col" }, `P${playerId}`)),
        ),
      ),
      h(
        "tbody",
        null,
        ...PLAYER_FIELDS.map(([label], index) =>
          h("tr", null, h("th", { scope: "row" }, label), ...(playerCells[index] ?? [])),
        ),
      ),
    ),
    h("h3", null, "Recent events"),
    logList,
  );

  const renderLog = () => {
    logDirty = false;
    logList.replaceChildren(...entries.map((entry) => h("li", null, entry)));
  };

  return {
    element,
    setVisible(next) {
      if (visible === next) return;
      visible = next;
      element.hidden = !next;
      if (next && logDirty) renderLog();
    },
    update(diagnostics) {
      if (!visible) return;
      GLOBAL_FIELDS.forEach(([, read], index) => {
        const cell = globalCells[index];
        if (cell)
          setText(cell, diagnostics ? read(diagnostics) : index === 0 ? "not running" : NONE);
      });
      PLAYER_FIELDS.forEach(([, read], index) => {
        PLAYER_IDS.forEach((playerId, column) => {
          const cell = playerCells[index]?.[column];
          if (cell) setText(cell, diagnostics ? read(diagnostics.players[playerId]) : NONE);
        });
      });
    },
    log(entry) {
      entries.unshift(entry);
      if (entries.length > MAX_LOG_ENTRIES) entries.length = MAX_LOG_ENTRIES;
      if (visible) renderLog();
      else logDirty = true;
    },
  };
}
