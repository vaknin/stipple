// Where the art goes on the wallpaper. Pure math, no DOM: the export and the preview both call it
// with their own pixel size, so the preview is the export scaled.
//
// The canvas is exactly width x height. The art gets an inner rectangle: the canvas minus a
// uniform margin (a share of the shorter side), or a box the user placed (fractions of the canvas,
// so it scales with the preview). Outside that rectangle is the surround colour. Inside it the
// grid keeps its cell aspect and is either
//   fit   whole and centred: the empty sides are paper
//   fill  covering the inner rectangle, centred and clipped to it

export type Placement = 'fit' | 'fill';

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
  /** Margin on every side as a percentage of the shorter side, 0..MARGIN_MAX (ignored with a box). */
  marginPct: number;
  placement: Placement;
  /** The art's box; null or missing = the whole canvas inside the margin. */
  box?: Box | null;
}

export interface Layout {
  cellW: number;
  cellH: number;
  /** Top-left of the grid (integer px). Negative or past the margin in fill mode. */
  x: number;
  y: number;
  artW: number;
  artH: number;
  /** The art's rectangle: inside the margin, or the box. Paper inside, surround outside. */
  inner: Rect;
  /** Clip for fill mode (the inner rectangle); null when the art is whole. */
  clip: Rect | null;
}

export const MARGIN_MAX = 30;
export const COLS_MIN = 4;
export const COLS_MAX = 200;
/** Auto columns aim for cells about this tall in output pixels. */
export const AUTO_CELL_PX = 15;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function marginPx(width: number, height: number, marginPct: number): number {
  const pct = Number.isFinite(marginPct) ? clamp(marginPct, 0, MARGIN_MAX) : 0;
  return Math.round((Math.min(width, height) * pct) / 100);
}

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

export function innerRect(o: Pick<LayoutIn, 'width' | 'height' | 'marginPct' | 'box'>): Rect {
  if (o.box) return boxPx(o.box, o.width, o.height);
  const m = marginPx(o.width, o.height, o.marginPct);
  return { x: m, y: m, w: Math.max(1, o.width - 2 * m), h: Math.max(1, o.height - 2 * m) };
}

export function layoutArt(g: GridShape, o: LayoutIn): Layout {
  const inner = innerRect(o);
  const cols = Math.max(1, g.cols), rows = Math.max(1, g.rows);
  // cell height when the rows fill the inner height, and when the columns fill its width
  const byRows = inner.h / rows;
  const byCols = inner.w / (cols * g.cellAspect);
  const cellH = o.placement === 'fill' ? Math.max(byRows, byCols) : Math.min(byRows, byCols);
  const cellW = cellH * g.cellAspect;
  const artW = cols * cellW, artH = rows * cellH;
  // integer offsets: blocks snap their edges to whole pixels from here, and centring stays within
  // 1 px. In fit, round(d / 2) stays in [0, d], so the art never leaves the inner rectangle.
  const x = inner.x + Math.round((inner.w - artW) / 2);
  const y = inner.y + Math.round((inner.h - artH) / 2);
  return { cellW, cellH, x, y, artW, artH, inner, clip: o.placement === 'fill' ? inner : null };
}

/**
 * Auto columns: the column count whose cells come out about AUTO_CELL_PX tall at the output size.
 * `aspect` is the crop's (art width / height, 1 = square). The art's height is the inner
 * rectangle's height or its width / aspect, whichever is smaller (fit) or larger (fill);
 * rows = height / AUTO_CELL_PX, cols = rows * aspect / cellAspect. 1080 px square Braille gives 125.
 */
export function autoColumns(cellAspect: number, o: LayoutIn, aspect = 1): number {
  const inner = innerRect(o);
  const byW = inner.w / aspect;
  const artH = o.placement === 'fill' ? Math.max(inner.h, byW) : Math.min(inner.h, byW);
  const rows = artH / AUTO_CELL_PX;
  return clamp(Math.round((rows * aspect) / cellAspect), COLS_MIN, COLS_MAX);
}
