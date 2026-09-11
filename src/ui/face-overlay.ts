import { PLAYER_IDS } from "../shared";
import type { NormalizedRect, PerPlayer, VisionDiagnostics } from "../shared";

export interface PixelBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where media of `mediaWidth × mediaHeight` appears inside a box with `object-fit: contain`
 * (letterboxed and centred). Unknown media size (0) fills the box.
 */
export function containRect(
  boxWidth: number,
  boxHeight: number,
  mediaWidth: number,
  mediaHeight: number,
): PixelBox {
  if (boxWidth <= 0 || boxHeight <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  if (mediaWidth <= 0 || mediaHeight <= 0) {
    return { x: 0, y: 0, width: boxWidth, height: boxHeight };
  }
  const scale = Math.min(boxWidth / mediaWidth, boxHeight / mediaHeight);
  const width = mediaWidth * scale;
  const height = mediaHeight * scale;
  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height };
}

/**
 * Map a display-space rectangle (0..1, mirroring already applied by the vision module) into
 * the content box in CSS pixels. The overlay canvas itself is never mirrored, so labels stay
 * readable (docs/architecture.md §8).
 */
export function toPixelBox(rect: NormalizedRect, content: PixelBox): PixelBox {
  return {
    x: content.x + rect.x * content.width,
    y: content.y + rect.y * content.height,
    width: rect.width * content.width,
    height: rect.height * content.height,
  };
}

/** Player accents. Labels ("P1", "P2") carry the meaning; colour is only a secondary cue. */
export const PLAYER_ACCENTS: PerPlayer<string> = { 1: "#ffb000", 2: "#4db3ff" };
const UNASSIGNED_ACCENT = "#e0e0e0";
const LABEL_HEIGHT = 22;

export interface OverlaySize {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

/**
 * Draw face rectangles with "P1"/"P2" labels (and "?" for unassigned faces) over the preview.
 * `media` is the intrinsic video size, used to follow `object-fit: contain` letterboxing.
 */
export function drawFaceOverlay(
  ctx: CanvasRenderingContext2D,
  size: OverlaySize,
  media: { readonly width: number; readonly height: number },
  diagnostics: VisionDiagnostics | null,
): void {
  ctx.setTransform(size.pixelRatio, 0, 0, size.pixelRatio, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  if (!diagnostics) return;

  const content = containRect(size.width, size.height, media.width, media.height);
  ctx.lineWidth = 3;
  ctx.font = "bold 14px system-ui, sans-serif";
  ctx.textBaseline = "middle";

  ctx.setLineDash([6, 4]);
  for (const face of diagnostics.unassignedFaces) {
    drawBox(ctx, toPixelBox(face, content), UNASSIGNED_ACCENT, "?");
  }
  ctx.setLineDash([]);
  for (const playerId of PLAYER_IDS) {
    const rect = diagnostics.players[playerId].faceRect;
    if (rect) drawBox(ctx, toPixelBox(rect, content), PLAYER_ACCENTS[playerId], `P${playerId}`);
  }
}

function drawBox(ctx: CanvasRenderingContext2D, box: PixelBox, accent: string, label: string) {
  ctx.strokeStyle = accent;
  ctx.strokeRect(box.x, box.y, box.width, box.height);

  const labelWidth = ctx.measureText(label).width + 16;
  const labelY = box.y >= LABEL_HEIGHT ? box.y - LABEL_HEIGHT : box.y;
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(box.x, labelY, labelWidth, LABEL_HEIGHT);
  ctx.fillStyle = accent;
  ctx.fillRect(box.x, labelY, 4, LABEL_HEIGHT);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, box.x + 9, labelY + LABEL_HEIGHT / 2);
}
