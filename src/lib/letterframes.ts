// Columns motion for Letters: what the shell plugin needs to draw any keyframe itself.
//
//   frames.png  every keyframe's cells, one texel per cell, R = 1 + the glyph's index in the
//               glyph table (0 = blank). Keyframes sit side by side in shelves. G is the same for
//               the night's keyframes (drawn the other way round, for an hour whose colours have
//               crossed over; 0 without): the same cells, one glyph table.
//   glyphs.png  each glyph of the table drawn once per level (a cell height), fitted as the PNG's
//               letters are (rasterize.ts fitFont) with room around the cell for overhangs. Glyph
//               g is in channel g % 3 of slot g / 3, so three glyphs share one texel; a level's
//               slots run in rows of `perRow`.
//
// wall.frag (mode 2) finds a pixel's cell in the current keyframe and samples the glyph of that
// cell and of the 8 around it (glyphs overhang), blending the two levels nearest the cell height.

import type { Grid } from '$typist/convert.js';
import type { Layout } from './layout';
import { fitFont } from './rasterize';

/** Room around the cell in a glyph tile, as a share of the cell (the plugin's shader too). */
export const OVER_X = 0.5, OVER_Y = 0.35;
/** Largest cell height drawn into the atlas: bigger cells scale this level up. */
export const LEVEL_MAX = 256;
const LEVEL_MIN = 4;

export interface FrameInfo {
  cols: number;
  rows: number;
  /** The keyframe's layout on the wallpaper (px). */
  x: number;
  y: number;
  cellW: number;
  cellH: number;
  /** Its cells' top-left in frames.png. */
  ax: number;
  ay: number;
}

export interface PackedFrames {
  frames: FrameInfo[];
  /** Code point of each glyph index. */
  glyphs: number[];
  width: number;
  height: number;
  /** frames.png, RGB. */
  rgb: Uint8Array;
}

const blank = (v: number) => v === 0x20 || v === 0;

/**
 * Pack the keyframes' cells (grids with their layouts) into one texture, shelves at most `maxW`
 * wide; `night`, the same keyframes drawn the other way round, into its G channel.
 */
export function packFrames(grids: Grid[], layouts: Layout[], maxW = 4096, night?: Grid[] | null): PackedFrames {
  if (night && (night.length !== grids.length || night.some((g, k) => g.cols !== grids[k]!.cols || g.rows !== grids[k]!.rows))) {
    throw new Error('the night keyframes are not the day’s');
  }
  const pos: [number, number][] = [];
  let x = 0, y = 0, shelf = 0, W = 1;
  for (const g of grids) {
    if (x > 0 && x + g.cols > maxW) { y += shelf; x = 0; shelf = 0; }
    pos.push([x, y]);
    x += g.cols;
    shelf = Math.max(shelf, g.rows);
    W = Math.max(W, x);
  }
  const H = Math.max(1, y + shelf);
  const rgb = new Uint8Array(W * H * 3);
  const glyphs: number[] = [];
  const index = new Map<number, number>();
  const put = (g: Grid, k: number, ch: number) => {
    const [ax, ay] = pos[k]!;
    for (let r = 0; r < g.rows; r++) {
      for (let c = 0; c < g.cols; c++) {
        const v = g.cp[r * g.cols + c]!;
        if (blank(v)) continue;
        let i = index.get(v);
        if (i === undefined) {
          i = glyphs.length;
          if (i >= 255) throw new Error('the keyframes use more than 255 different letters');
          glyphs.push(v);
          index.set(v, i);
        }
        rgb[((ay + r) * W + ax + c) * 3 + ch] = i + 1;
      }
    }
  };
  grids.forEach((g, k) => put(g, k, 0));
  night?.forEach((g, k) => put(g, k, 1));
  const frames = grids.map((g, k) => {
    const l = layouts[k]!;
    return { cols: g.cols, rows: g.rows, x: l.x, y: l.y, cellW: l.cellW, cellH: l.cellH, ax: pos[k]![0], ay: pos[k]![1] };
  });
  return { frames, glyphs, width: W, height: H, rgb };
}

/** The atlas levels (cell heights) for keyframes with these cell heights: powers of two, capped. */
export function atlasLevels(cellHs: number[]): number[] {
  const lo = Math.max(LEVEL_MIN, 2 ** Math.floor(Math.log2(Math.max(1, Math.min(...cellHs)))));
  const hi = Math.min(LEVEL_MAX, Math.max(lo, 2 ** Math.ceil(Math.log2(Math.max(...cellHs)))));
  const out: number[] = [];
  for (let h = lo; h <= hi; h *= 2) out.push(h);
  return out;
}

export interface AtlasLevel {
  cellW: number;
  cellH: number;
  tileW: number;
  tileH: number;
  /** Top of this level's band in glyphs.png. */
  y: number;
  /** Slots per row of the band. */
  perRow: number;
}

export interface GlyphAtlas { levels: AtlasLevel[]; width: number; height: number; rgb: Uint8Array }

/** A level's tile: the cell plus OVER_X / OVER_Y around it, and a pixel of padding. */
export function levelGeometry(cellH: number, cellAspect: number): Omit<AtlasLevel, 'y' | 'perRow'> {
  const cellW = cellH * cellAspect;
  return { cellW, cellH, tileW: Math.ceil(cellW * (1 + 2 * OVER_X)) + 2, tileH: Math.ceil(cellH * (1 + 2 * OVER_Y)) + 2 };
}

/** Draw glyphs.png: every glyph at every level, white coverage in its channel. */
export function glyphAtlas(glyphs: number[], cellAspect: number, heights: number[], font: string, maxW = 8192): GlyphAtlas {
  const slots = Math.max(1, Math.ceil(glyphs.length / 3));
  let y = 0, W = 1;
  const levels = heights.map(h => {
    const g = levelGeometry(h, cellAspect);
    const perRow = Math.max(1, Math.min(slots, Math.floor(maxW / g.tileW)));
    const l = { ...g, y, perRow };
    y += Math.ceil(slots / perRow) * g.tileH;
    W = Math.max(W, perRow * g.tileW);
    return l;
  });
  const H = Math.max(1, y);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2D canvas');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  // each channel adds on its own: three glyphs overlap in one slot without touching each other
  ctx.globalCompositeOperation = 'lighter';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const CH = ['#ff0000', '#00ff00', '#0000ff'];
  for (const l of levels) {
    const fit = fitFont(font, l.cellW, l.cellH);
    ctx.font = fit.css;
    glyphs.forEach((v, g) => {
      const slot = Math.floor(g / 3);
      const tx = (slot % l.perRow) * l.tileW, ty = l.y + Math.floor(slot / l.perRow) * l.tileH;
      ctx.fillStyle = CH[g % 3]!;
      // the cell's top-left sits at 1 + OVER * cell inside the tile
      const cx = tx + 1 + l.cellW * (OVER_X + 0.5);
      const cy = ty + 1 + l.cellH * OVER_Y;
      ctx.save();
      ctx.beginPath();
      ctx.rect(tx, ty, l.tileW, l.tileH);
      ctx.clip();
      ctx.fillText(String.fromCodePoint(v), cx, cy + fit.base);
      ctx.restore();
    });
  }
  const data = ctx.getImageData(0, 0, W, H).data;
  canvas.width = canvas.height = 0;
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i]!;
    rgb[j + 1] = data[i + 1]!;
    rgb[j + 2] = data[i + 2]!;
  }
  return { levels, width: W, height: H, rgb };
}
