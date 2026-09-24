// Where the art goes on the wallpaper. Pure math, no DOM: the export and the preview both call it
// with their own pixel size, so the preview is the export scaled.
//
// The canvas is exactly width x height. A uniform margin (a share of the shorter side) is kept as
// paper. Inside it the grid keeps its cell aspect and is either
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

export interface LayoutIn {
  width: number;
  height: number;
  /** Margin on every side as a percentage of the shorter side, 0..MARGIN_MAX. */
  marginPct: number;
  placement: Placement;
}

export interface Layout {
  cellW: number;
  cellH: number;
  /** Top-left of the grid (integer px). Negative or past the margin in fill mode. */
  x: number;
  y: number;
  artW: number;
  artH: number;
  /** The rectangle inside the margin. */
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

export function innerRect(o: Pick<LayoutIn, 'width' | 'height' | 'marginPct'>): Rect {
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
