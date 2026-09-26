// Where the art goes on the wallpaper. Pure math, no DOM: the export and the preview both call it
// with their own pixel size, so the preview is the export scaled.
//
// The canvas is exactly width x height. The art gets an inner rectangle: the whole canvas (Fill),
// or a box the user placed (Custom; fractions of the canvas, so it scales with the preview).
// Outside that rectangle is the surround colour. Inside it the grid keeps its cell aspect and
// covers the rectangle, centred and clipped to it (the crop has the rectangle's aspect, so only
// the rounding of the rows is cut off).

export interface Rect { x: number; y: number; w: number; h: number }

export interface GridShape {
  cols: number;
  rows: number;
  /** Cell width / cell height. */
  cellAspect: number;
}

/** Part of the canvas for the art, as fractions of its width and height (top-left and size). */
export interface Box { x: number; y: number; w: number; h: number }

export interface LayoutIn {
  width: number;
  height: number;
  /** The art's box; null or missing = the whole canvas. */
  box?: Box | null;
}

export interface Layout {
  cellW: number;
  cellH: number;
  /** Top-left of the grid (integer px), at or before the inner rectangle's. */
  x: number;
  y: number;
  artW: number;
  artH: number;
  /** The art's rectangle: the canvas, or the box. Paper inside, surround outside. */
  inner: Rect;
  /** The clip (the inner rectangle). */
  clip: Rect;
}

export const COLS_MIN = 4;
/** The keyframes texture (frames.png) is 4096 px wide, one texel per cell. */
export const COLS_MAX = 4096;
/** Auto columns aim for cells about this tall in output pixels. */
export const AUTO_CELL_PX = 15;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** A box kept on the canvas: size at least `min` (a fraction) and at most the canvas. */
export function clampBox(b: Box, min = 0.01): Box {
  const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  const w = clamp(fin(b.w, 0.5), min, 1), h = clamp(fin(b.h, 0.5), min, 1);
  return { x: clamp(fin(b.x, (1 - w) / 2), 0, 1 - w), y: clamp(fin(b.y, (1 - h) / 2), 0, 1 - h), w, h };
}

/** A box in whole pixels of a width x height canvas (edges rounded, so neighbours share them). */
export function boxPx(b: Box, width: number, height: number): Rect {
  const c = clampBox(b, 0);
  const x0 = Math.round(c.x * width), y0 = Math.round(c.y * height);
  const x1 = Math.round((c.x + c.w) * width), y1 = Math.round((c.y + c.h) * height);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

export function innerRect(o: LayoutIn): Rect {
  if (o.box) return boxPx(o.box, o.width, o.height);
  return { x: 0, y: 0, w: Math.max(1, o.width), h: Math.max(1, o.height) };
}

export function layoutArt(g: GridShape, o: LayoutIn): Layout {
  const inner = innerRect(o);
  const cols = Math.max(1, g.cols), rows = Math.max(1, g.rows);
  // cell height when the rows fill the inner height, and when the columns fill its width
  const byRows = inner.h / rows;
  const byCols = inner.w / (cols * g.cellAspect);
  const cellH = Math.max(byRows, byCols);
  const cellW = cellH * g.cellAspect;
  const artW = cols * cellW, artH = rows * cellH;
  // integer offsets: centring stays within 1 px
  const x = inner.x + Math.round((inner.w - artW) / 2);
  const y = inner.y + Math.round((inner.h - artH) / 2);
  return { cellW, cellH, x, y, artW, artH, inner, clip: inner };
}

/**
 * Auto columns: the column count whose cells come out about AUTO_CELL_PX tall at the output size.
 * `aspect` is the crop's (art width / height, 1 = square). The art's height is the larger of the
 * inner rectangle's height and its width / aspect (the art covers it);
 * rows = height / AUTO_CELL_PX, cols = rows * aspect / cellAspect. 1080 px square Letters gives 156.
 */
export function autoColumns(cellAspect: number, o: LayoutIn, aspect = 1): number {
  const inner = innerRect(o);
  const byW = inner.w / aspect;
  const artH = Math.max(inner.h, byW);
  const rows = artH / AUTO_CELL_PX;
  return clamp(Math.round((rows * aspect) / cellAspect), COLS_MIN, COLS_MAX);
}
