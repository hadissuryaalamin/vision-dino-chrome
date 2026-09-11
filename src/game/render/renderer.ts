import { PLAYER_IDS, type PerPlayer, type PlayerId } from "../../shared";
import type { GameConfig } from "../config";
import type { GameState, ObstacleState, PlayerState } from "../engine/state";

/** The subset of CanvasRenderingContext2D the renderer uses (lets tests pass a fake). */
export type GameRenderContext = Pick<
  CanvasRenderingContext2D,
  | "setTransform"
  | "fillRect"
  | "beginPath"
  | "rect"
  | "clip"
  | "moveTo"
  | "lineTo"
  | "stroke"
  | "fillText"
  | "save"
  | "restore"
  | "translate"
  | "scale"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
  | "font"
  | "textAlign"
  | "textBaseline"
  | "globalAlpha"
>;

/** Canvas size in CSS pixels and the device pixel ratio of its backing store. */
export interface RenderViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface RenderOptions {
  /** Draw "READY", "PAUSED" and "GAME OVER" text over the lanes. Default: true. */
  readonly showStatusOverlay?: boolean;
  /** Lane labels. Default: DEFAULT_LANE_LABELS. */
  readonly laneLabels?: PerPlayer<string>;
}

/** Text shown on each lane, so players are never told apart by colour alone. */
export const DEFAULT_LANE_LABELS: PerPlayer<string> = Object.freeze({
  1: "P1 · blink",
  2: "P2 · mouth",
});

/** How long the "just jumped" cue stays visible, ms of simulated time. */
export const JUMP_CUE_MS = 180;

const COLORS = Object.freeze({
  background: "#f7f7f7",
  divider: "#bdbdbd",
  ground: "#535353",
  obstacle: "#535353",
  text: "#303030",
  crashedText: "#5f5f5f",
  crashedDino: "#8f8f8f",
  crashedVeil: "rgba(160, 160, 160, 0.45)",
  panel: "rgba(247, 247, 247, 0.9)",
  players: Object.freeze({ 1: "#1f5fa8", 2: "#b3471d" }),
});

const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

function drawObstacle(
  ctx: GameRenderContext,
  obstacle: ObstacleState,
  left: number,
  groundY: number,
): void {
  const count = Math.max(1, Math.round(obstacle.width / 26));
  const cell = obstacle.width / count;
  const top = groundY - obstacle.height;
  ctx.fillStyle = COLORS.obstacle;
  for (let i = 0; i < count; i += 1) {
    const x = left + i * cell;
    const trunk = cell * 0.4;
    ctx.fillRect(x + (cell - trunk) / 2, top, trunk, obstacle.height);
    const arm = cell * 0.22;
    ctx.fillRect(x + cell * 0.06, top + obstacle.height * 0.3, arm, obstacle.height * 0.28);
    ctx.fillRect(
      x + cell - cell * 0.06 - arm,
      top + obstacle.height * 0.2,
      arm,
      obstacle.height * 0.3,
    );
    ctx.fillRect(x + cell * 0.06, top + obstacle.height * 0.55, cell * 0.88, arm * 0.6);
  }
}

function drawDino(
  ctx: GameRenderContext,
  config: GameConfig,
  player: PlayerState,
  top: number,
  legPhase: number,
  airborne: boolean,
): void {
  // Drawn on a 60 × 64 grid, scaled to the configured size.
  const sx = config.dinoWidth / 60;
  const sy = config.dinoHeight / 64;
  const x0 = config.dinoX;
  const box = (x: number, y: number, w: number, h: number): void => {
    ctx.fillRect(x0 + x * sx, top + y * sy, w * sx, h * sy);
  };

  ctx.fillStyle = player.crashed ? COLORS.crashedDino : COLORS.players[player.playerId];
  box(30, 0, 30, 20); // head
  box(44, 20, 14, 5); // jaw
  box(12, 18, 34, 26); // body
  box(0, 22, 14, 10); // tail
  box(46, 28, 8, 4); // arm
  const back = airborne ? 16 : legPhase === 0 ? 20 : 14;
  const front = airborne ? 16 : legPhase === 0 ? 14 : 20;
  box(18, 44, 8, back);
  box(34, 44, 8, front);

  // Eye: a hole while running, an X after a crash.
  if (player.crashed) {
    ctx.strokeStyle = COLORS.background;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 35 * sx, top + 4 * sy);
    ctx.lineTo(x0 + 43 * sx, top + 12 * sy);
    ctx.moveTo(x0 + 43 * sx, top + 4 * sy);
    ctx.lineTo(x0 + 35 * sx, top + 12 * sy);
    ctx.stroke();
  } else {
    ctx.fillStyle = COLORS.background;
    box(37, 5, 5, 5);
  }

  // Player number on the body: identity is never shown by colour alone.
  ctx.fillStyle = COLORS.background;
  ctx.font = `bold ${Math.round(18 * sy)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(player.playerId), x0 + 29 * sx, top + 32 * sy);
}

function drawJumpCue(ctx: GameRenderContext, config: GameConfig, ageMs: number): void {
  const alpha = Math.max(0, 1 - ageMs / JUMP_CUE_MS);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.ground;
  const y = config.groundY - 4;
  const spread = 6 + (ageMs / JUMP_CUE_MS) * 18;
  ctx.fillRect(config.dinoX + 10 - spread, y, 8, 3);
  ctx.fillRect(config.dinoX + config.dinoWidth / 2 - 4, y - 2, 8, 3);
  ctx.fillRect(config.dinoX + config.dinoWidth - 18 + spread, y, 8, 3);
  ctx.globalAlpha = 1;
}

function drawLane(
  ctx: GameRenderContext,
  state: GameState,
  config: GameConfig,
  playerId: PlayerId,
  label: string,
): void {
  const player = state.players[playerId];
  const crash = player.crash;
  const view = crash ? crash.distance : state.distance;
  const obstacles = crash ? crash.obstacles : state.obstacles;
  const y = crash ? crash.y : player.y;
  const airborne = y > 0;
  const { laneWidth, laneHeight, groundY } = config;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, laneWidth, laneHeight);
  ctx.clip();

  // Ground line and scrolling pebbles.
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, groundY, laneWidth, 2);
  const spacing = 70;
  const offset = view % spacing;
  for (let x = -offset; x < laneWidth; x += spacing) {
    const index = Math.floor((x + view) / spacing);
    const dy = ((index % 3) + 3) % 3;
    ctx.fillRect(x + 12, groundY + 8 + dy * 7, 10 + dy * 4, 2);
  }

  for (const obstacle of obstacles) {
    const left = obstacle.x - view;
    if (left > laneWidth || left + obstacle.width < 0) continue;
    drawObstacle(ctx, obstacle, left, groundY);
  }

  const legPhase = Math.floor(view / 45) % 2;
  drawDino(ctx, config, player, groundY - y - config.dinoHeight, legPhase, airborne);

  if (!player.crashed && player.lastJumpAtMs !== null) {
    const age = state.elapsedMs - player.lastJumpAtMs;
    if (age >= 0 && age < JUMP_CUE_MS) drawJumpCue(ctx, config, age);
  }

  if (player.crashed) {
    ctx.fillStyle = COLORS.crashedVeil;
    ctx.fillRect(0, 0, laneWidth, laneHeight);
  }

  ctx.textBaseline = "top";
  ctx.font = `bold 22px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillStyle = player.crashed ? COLORS.crashedText : COLORS.players[playerId];
  ctx.fillText(label, 14, 12);
  ctx.textAlign = "right";
  ctx.fillStyle = player.crashed ? COLORS.crashedText : COLORS.text;
  ctx.fillText(`P${playerId} ${String(player.score).padStart(5, "0")}`, laneWidth - 14, 12);

  if (player.crashed) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = COLORS.crashedText;
    ctx.font = `bold 30px ${FONT}`;
    ctx.fillText(`P${playerId} CRASHED`, laneWidth / 2, laneHeight * 0.42);
  }

  ctx.restore();
}

function statusLines(state: GameState): readonly string[] {
  switch (state.status) {
    case "ready":
      return ["READY"];
    case "paused":
      return ["PAUSED"];
    case "game-over": {
      const winner = state.result?.winner ?? null;
      return ["GAME OVER", winner === null ? "Tie" : `Player ${winner} wins`];
    }
    case "running":
      return [];
  }
}

function drawStatusOverlay(
  ctx: GameRenderContext,
  state: GameState,
  width: number,
  height: number,
): void {
  const lines = statusLines(state);
  if (lines.length === 0) return;
  const size = Math.max(12, Math.round(Math.min(width, height) * 0.07));
  const panelHeight = size * (lines.length * 1.4 + 0.8);
  const panelWidth = Math.min(width * 0.8, size * 12);
  ctx.fillStyle = COLORS.panel;
  ctx.fillRect((width - panelWidth) / 2, (height - panelHeight) / 2, panelWidth, panelHeight);
  ctx.fillStyle = COLORS.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, index) => {
    ctx.font = `bold ${index === 0 ? size : Math.round(size * 0.7)}px ${FONT}`;
    const y = height / 2 + (index - (lines.length - 1) / 2) * size * 1.4;
    ctx.fillText(line, width / 2, y);
  });
}

/**
 * Draw the game: two stacked lanes (Player 1 on top), each scaled uniformly to fit half the
 * canvas and centred. A pure function of its inputs; it never mutates `state`.
 * A crashed player's lane freezes at the moment of the crash and is greyed out.
 */
export function renderGame(
  ctx: GameRenderContext,
  state: Readonly<GameState>,
  config: Readonly<GameConfig>,
  viewport: RenderViewport,
  options: RenderOptions = {},
): void {
  const { width, height } = viewport;
  const pixelRatio = viewport.pixelRatio > 0 ? viewport.pixelRatio : 1;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);

  const laneSlot = height / 2;
  const scale = Math.min(width / config.laneWidth, laneSlot / config.laneHeight);
  if (!(scale > 0) || !Number.isFinite(scale)) return;
  const offsetX = (width - config.laneWidth * scale) / 2;
  const labels = options.laneLabels ?? DEFAULT_LANE_LABELS;

  for (const playerId of PLAYER_IDS) {
    const slotTop = (playerId - 1) * laneSlot;
    ctx.save();
    ctx.translate(offsetX, slotTop + (laneSlot - config.laneHeight * scale) / 2);
    ctx.scale(scale, scale);
    drawLane(ctx, state, config, playerId, labels[playerId]);
    ctx.restore();
  }

  ctx.fillStyle = COLORS.divider;
  ctx.fillRect(0, laneSlot - 1, width, 2);

  if (options.showStatusOverlay ?? true) drawStatusOverlay(ctx, state, width, height);
}
