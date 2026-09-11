// Vision Lab: a development-only diagnostic page (decision O-09), served by `npm run dev` at
// http://localhost:5173/src/vision/lab/. It is not a build input, so it never ships.
//
// Everything stays in this tab: frames, landmarks and calibration data are drawn and then
// discarded. Nothing is stored or sent anywhere.
import { PLAYER_IDS, type PlayerId, type VisionEvent } from "../../shared";
import {
  DEFAULT_VISION_CONFIG,
  mergeVisionConfig,
  type MetricSource,
  type VisionConfig,
} from "../config";
import { createBrowserVisionDeps } from "../defaults";
import { describeError } from "../errors";
import { toDisplayX } from "../geometry/geometry";
import { METRIC_LANDMARK_INDICES } from "../gestures/landmark-indices";
import { createVisionSessionWith, type InternalVisionSession } from "../session";

const PLAYER_COLORS: Readonly<Record<PlayerId, string>> = { 1: "#1e88e5", 2: "#e53935" };
const HISTORY_MS = 5000;
const MAX_LOG_ENTRIES = 200;

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`Vision Lab: missing #${id}`);
  return found;
}

const video = byId("video", HTMLVideoElement);
const overlay = byId("overlay", HTMLCanvasElement);
const preview = byId("preview", HTMLDivElement);
const logList = byId("log", HTMLOListElement);
const mirroredInput = byId("mirrored", HTMLInputElement);
const landmarksInput = byId("show-landmarks", HTMLInputElement);
const metricPointsInput = byId("show-metric-points", HTMLInputElement);

let config: VisionConfig = DEFAULT_VISION_CONFIG;
let mirrored = mirroredInput.checked;
let session = createSession();
let unsubscribe = session.subscribe(onEvent);
const history: Record<PlayerId, { t: number; score: number | null }[]> = { 1: [], 2: [] };
const gestureTimes: Record<PlayerId, number[]> = { 1: [], 2: [] };

function createSession(): InternalVisionSession {
  video.classList.toggle("mirrored", mirrored);
  return createVisionSessionWith(createBrowserVisionDeps(config), { video, mirrored }, config);
}

function log(text: string, className = ""): void {
  const item = document.createElement("li");
  item.textContent = `${performance.now().toFixed(0).padStart(7)}  ${text}`;
  if (className) item.className = className;
  logList.prepend(item);
  while (logList.childElementCount > MAX_LOG_ENTRIES) logList.lastElementChild?.remove();
}

function describeEvent(event: VisionEvent): string {
  const { type, timestamp, ...rest } = event;
  return `${type.padEnd(21)} ${JSON.stringify(rest)}  @${timestamp.toFixed(0)}`;
}

function onEvent(event: VisionEvent): void {
  if (event.type === "gesture") gestureTimes[event.playerId].push(event.timestamp);
  const className = event.type === "gesture" ? "gesture" : event.type === "error" ? "error" : "";
  log(describeEvent(event), className);
}

async function start(): Promise<void> {
  log("start()");
  const result = await session.start();
  if (!result.ok) log(`start failed: ${result.error.code}: ${result.error.message}`, "error");
}

async function recreate(): Promise<void> {
  const wasActive = session.getStatus() !== "idle" && session.getStatus() !== "error";
  unsubscribe();
  await session.dispose();
  session = createSession();
  unsubscribe = session.subscribe(onEvent);
  for (const playerId of PLAYER_IDS) {
    history[playerId] = [];
    gestureTimes[playerId] = [];
  }
  log(`new session (mirrored: ${String(mirrored)})`);
  if (wasActive) await start();
}

function onClick(id: string, action: () => void | Promise<void>): void {
  byId(id, HTMLButtonElement).addEventListener("click", () => {
    Promise.resolve(action()).catch((error: unknown) => {
      log(`error: ${describeError(error)}`, "error");
    });
  });
}

onClick("start", start);
onClick("stop", () => session.stop());
onClick("calibrate", () => {
  session.startCalibration();
});
onClick("defaults", () => {
  session.useDefaultCalibration();
});
onClick("cancel", () => {
  session.cancelCalibration();
});
onClick("swap", () => {
  session.swapPlayers();
});
onClick("reset", () => {
  session.resetAssignment();
});
onClick("clear-log", () => {
  logList.replaceChildren();
});
mirroredInput.addEventListener("change", () => {
  mirrored = mirroredInput.checked;
  void recreate();
});
window.addEventListener("pagehide", () => {
  void session.stop();
});

// ---------------------------------------------------------------------------------------------
// Tuning form

const numberInput = (id: string): HTMLInputElement => byId(id, HTMLInputElement);
const fields = {
  blinkEnter: numberInput("blink-enter"),
  blinkExit: numberInput("blink-exit"),
  blinkMinActive: numberInput("blink-min-active"),
  blinkCooldown: numberInput("blink-cooldown"),
  mouthEnter: numberInput("mouth-enter"),
  mouthExit: numberInput("mouth-exit"),
  mouthMinActive: numberInput("mouth-min-active"),
  mouthCooldown: numberInput("mouth-cooldown"),
  tau: numberInput("tau"),
  minFace: numberInput("min-face"),
  headPose: byId("head-pose", HTMLInputElement),
  metricSource: byId("metric-source", HTMLSelectElement),
  delegate: byId("delegate", HTMLSelectElement),
};

function fillForm(current: VisionConfig): void {
  const { blink } = current.gestures;
  const mouth = current.gestures["mouth-open"];
  fields.blinkEnter.value = String(blink.enterThreshold);
  fields.blinkExit.value = String(blink.exitThreshold);
  fields.blinkMinActive.value = String(blink.minActiveMs);
  fields.blinkCooldown.value = String(blink.cooldownMs);
  fields.mouthEnter.value = String(mouth.enterThreshold);
  fields.mouthExit.value = String(mouth.exitThreshold);
  fields.mouthMinActive.value = String(mouth.minActiveMs);
  fields.mouthCooldown.value = String(mouth.cooldownMs);
  fields.tau.value = String(current.smoothingTauMs);
  fields.minFace.value = String(current.quality.minFaceWidthPx);
  fields.headPose.checked = current.quality.useHeadPose;
  fields.metricSource.value = current.metricSource;
  fields.delegate.value = current.detector.delegate;
}

byId("tuning", HTMLFormElement).addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    config = mergeVisionConfig(DEFAULT_VISION_CONFIG, {
      gestures: {
        blink: {
          enterThreshold: Number(fields.blinkEnter.value),
          exitThreshold: Number(fields.blinkExit.value),
          minActiveMs: Number(fields.blinkMinActive.value),
          cooldownMs: Number(fields.blinkCooldown.value),
        },
        "mouth-open": {
          enterThreshold: Number(fields.mouthEnter.value),
          exitThreshold: Number(fields.mouthExit.value),
          minActiveMs: Number(fields.mouthMinActive.value),
          cooldownMs: Number(fields.mouthCooldown.value),
        },
      },
      smoothingTauMs: Number(fields.tau.value),
      quality: {
        minFaceWidthPx: Number(fields.minFace.value),
        useHeadPose: fields.headPose.checked,
      },
      metricSource:
        fields.metricSource.value === "blendshapes"
          ? "blendshapes"
          : ("geometry" satisfies MetricSource),
      detector: { delegate: fields.delegate.value === "CPU" ? "CPU" : "GPU" },
    });
  } catch (error) {
    log(`invalid configuration: ${describeError(error)}`, "error");
    return;
  }
  log("configuration applied");
  void recreate();
});

fillForm(config);

// ---------------------------------------------------------------------------------------------
// Rendering (polls diagnostics once per animation frame)

function formatNumber(value: number | null | undefined, digits = 3): string {
  return value === null || value === undefined ? "–" : value.toFixed(digits);
}

function setText(id: string, text: string): void {
  const target = document.getElementById(id);
  if (target) target.textContent = text;
}

function drawOverlay(): void {
  const debug = session.getDebugSnapshot();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(overlay.clientWidth * dpr);
  const height = Math.round(overlay.clientHeight * dpr);
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
  if (debug.frame) preview.style.aspectRatio = `${debug.frame.width} / ${debug.frame.height}`;
  const context = overlay.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  context.font = `${Math.round(14 * dpr)}px system-ui, sans-serif`;
  context.lineWidth = 2 * dpr;

  for (const { face, observation, playerId } of debug.faces) {
    const color = playerId === null ? "#aaa" : PLAYER_COLORS[playerId];
    const { rect } = observation;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.strokeRect(rect.x * width, rect.y * height, rect.width * width, rect.height * height);
    context.fillText(
      playerId === null ? "unassigned" : `P${playerId}`,
      rect.x * width,
      rect.y * height - 6 * dpr,
    );
    if (landmarksInput.checked) {
      for (const point of face.landmarks) {
        const x = toDisplayX(point.x, debug.mirrored) * width;
        context.fillRect(x - dpr / 2, point.y * height - dpr / 2, dpr, dpr);
      }
    }
    if (metricPointsInput.checked) {
      context.fillStyle = "#ffeb3b";
      for (const index of METRIC_LANDMARK_INDICES) {
        const point = face.landmarks[index];
        if (!point) continue;
        const x = toDisplayX(point.x, debug.mirrored) * width;
        const y = point.y * height;
        context.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr);
        context.fillText(String(index), x + 3 * dpr, y - 3 * dpr);
      }
    }
  }
}

function drawSparkline(canvas: HTMLCanvasElement, playerId: PlayerId, now: number): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  const gesture = session.getDiagnostics().players[playerId].gesture;
  const toX = (t: number): number => width - ((now - t) / HISTORY_MS) * width;
  const toY = (score: number): number => height - score * (height - 4) - 2;
  context.clearRect(0, 0, width, height);
  context.lineWidth = 1;
  for (const [threshold, color] of [
    [gesture.enterThreshold, "#43a047"],
    [gesture.exitThreshold, "#fb8c00"],
  ] as const) {
    context.strokeStyle = color;
    context.beginPath();
    context.moveTo(0, toY(threshold));
    context.lineTo(width, toY(threshold));
    context.stroke();
  }
  context.strokeStyle = PLAYER_COLORS[playerId];
  context.lineWidth = 2;
  context.beginPath();
  let drawing = false;
  for (const sample of history[playerId]) {
    if (sample.score === null) {
      drawing = false;
      continue;
    }
    if (drawing) context.lineTo(toX(sample.t), toY(sample.score));
    else context.moveTo(toX(sample.t), toY(sample.score));
    drawing = true;
  }
  context.stroke();
  context.fillStyle = "#43a047";
  for (const t of gestureTimes[playerId]) {
    if (now - t <= HISTORY_MS) context.fillRect(toX(t) - 2, 0, 4, height);
  }
}

function renderPlayers(): void {
  const diagnostics = session.getDiagnostics();
  const debug = session.getDebugSnapshot();
  const now = diagnostics.frameTimestamp;
  for (const playerId of PLAYER_IDS) {
    const player = diagnostics.players[playerId];
    const internals = debug.players[playerId];
    const gesture = player.gesture;
    if (now !== null) {
      const samples = history[playerId];
      if (samples.at(-1)?.t !== now) samples.push({ t: now, score: gesture.score });
      while ((samples[0]?.t ?? now) < now - HISTORY_MS) samples.shift();
    }
    const article = document.querySelector(`.player[data-player="${playerId}"]`);
    const list = article?.querySelector("[data-fields]");
    const canvas = article?.querySelector("canvas");
    const calibrating = internals.calibrating;
    const rows: [string, string][] = [
      ["Tracking", player.tracking],
      [
        "Face",
        player.faceRect
          ? `x ${formatNumber(player.faceRect.x, 2)} w ${formatNumber(player.faceRect.width, 2)}`
          : "–",
      ],
      ["Quality gate", internals.gate],
      ["Raw metric", formatNumber(gesture.rawMetric)],
      ["Smoothed metric", formatNumber(internals.smoothedMetric)],
      ["Score", formatNumber(gesture.score, 2)],
      ["Enter / exit", `${gesture.enterThreshold} / ${gesture.exitThreshold}`],
      ["State", gesture.state],
      ["Cooldown ms", gesture.cooldownRemainingMs.toFixed(0)],
      ["Last gesture", formatNumber(gesture.lastGestureAt, 0)],
      ["Calibration", gesture.calibration],
      [
        "Levels (neutral → active)",
        `${formatNumber(internals.levels.neutral)} → ${formatNumber(internals.levels.active)}`,
      ],
      [
        "Calibrating",
        calibrating
          ? `${calibrating.step}; peaks ${calibrating.peaks.length}; threshold ${formatNumber(calibrating.peakThreshold)}; noise ${formatNumber(calibrating.noise, 4)}`
          : "no",
      ],
    ];
    if (list) {
      list.replaceChildren(
        ...rows.flatMap(([label, value]) => {
          const term = document.createElement("dt");
          term.textContent = label;
          const detail = document.createElement("dd");
          detail.textContent = value;
          return [term, detail];
        }),
      );
    }
    if (canvas && now !== null) drawSparkline(canvas, playerId, now);
  }
}

function render(): void {
  const diagnostics = session.getDiagnostics();
  const debug = session.getDebugSnapshot();
  setText("status", diagnostics.status);
  setText("faces", String(diagnostics.facesDetected));
  setText(
    "lock",
    debug.locked ? "locked" : `unlocked (${Math.round(debug.lockProgress * 100)}% to lock)`,
  );
  setText("fps", formatNumber(diagnostics.processingFps, 1));
  setText("inference", formatNumber(diagnostics.inferenceMs, 1));
  setText("frame-size", debug.frame ? `${debug.frame.width}×${debug.frame.height}` : "–");
  drawOverlay();
  renderPlayers();
  requestAnimationFrame(render);
}

requestAnimationFrame(render);
log("Vision Lab ready. Click Start camera.");
