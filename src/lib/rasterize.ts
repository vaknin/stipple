// A Grid drawn into a pixel buffer in plain JS, then put on a canvas with one putImageData.
//
// Why not Typist's raster.js drawGrid: every canvas call is slow in WebKitGTK (measured in this
// webview: ~7.5 us per fillText, ~150 us per drawImage, ~5 us per arc, and one path of 50,000
// arcs, a 1080p Braille wallpaper, took 20 s to fill). Plain JS writes the same frame in a few ms.
//
// Geometry is Typist's, so the art looks the same: Braille dot centres and radius from raster.js
// brailleGeometry, block edges snapped to whole pixels as drawBlocks does, letters with
// raster.js's font fitting (advance = cell width, em box centred). What differs is only the
// anti-aliasing: dots are supersampled stamps and glyphs are masks rendered once per cell size,
// both placed at quarter-pixel positions.
//
// Mono art accumulates ink coverage (0..255, "over" compositing) and is coloured at the end
// through a 256-entry table, so ink and paper are exact wherever coverage is 0 or 255.

import type { Grid } from '$typist/convert.js';
import { BLOCK_MASK, brailleGeometry } from '$typist/raster.js';
import type { Layout } from './layout';
import type { Colours } from './render';

/** Sub-pixel positions per axis for dot stamps and glyph masks. */
const PH = 4;
/** Supersamples per axis when building a dot stamp. */
const SS = 8;

export class Surface {
  readonly width: number;
  readonly height: number;
  readonly image: ImageData;
  /** RGBA pixels as little-endian 0xAABBGGRR words. */
  readonly px: Uint32Array;
  /** Ink coverage for mono art, kept zeroed between frames. */
  readonly cov: Uint8Array;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.image = new ImageData(this.width, this.height);
    this.px = new Uint32Array(this.image.data.buffer);
    this.cov = new Uint8Array(this.width * this.height);
  }
}

/** A surface of this size, reused while the size stays the same. */
export function surfaceCache() {
  let s: Surface | null = null;
  return (w: number, h: number) => {
    if (!s || s.width !== Math.round(w) || s.height !== Math.round(h)) s = new Surface(w, h);
    return s;
  };
}

// ------------------------------------------------------------------------------------ colours

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const word = (r: number, g: number, b: number) => (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
/** 0xRRGGBB (Grid fg / bg) as a pixel word. */
const word24 = (v: number) => word((v >> 16) & 255, (v >> 8) & 255, v & 255);

function inkTable(ink: string, paper: string): Uint32Array {
  const [ir, ig, ib] = rgb(ink), [pr, pg, pb] = rgb(paper);
  const lut = new Uint32Array(256);
  for (let a = 0; a < 256; a++) {
    const t = a / 255;
    lut[a] = word(
      Math.round(pr + (ir - pr) * t),
      Math.round(pg + (ig - pg) * t),
      Math.round(pb + (ib - pb) * t),
    );
  }
  return lut;
}

// ------------------------------------------------------------------------------------- stamps

/** Coverage (0..255) of a small box, placed at (ix + ox, iy + oy) for an anchor pixel (ix, iy). */
interface Stamp { ox: number; oy: number; w: number; h: number; a: Uint8Array }

const EMPTY: Stamp = { ox: 0, oy: 0, w: 0, h: 0, a: new Uint8Array(0) };

/** Crop a coverage box to its non-zero pixels. */
function tight(a: Uint8Array, w: number, h: number, ox: number, oy: number): Stamp {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return EMPTY;
  const tw = x1 - x0 + 1, th = y1 - y0 + 1;
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) out.set(a.subarray((y + y0) * w + x0, (y + y0) * w + x0 + tw), y * tw);
  return { ox: ox + x0, oy: oy + y0, w: tw, h: th, a: out };
}

const dotCache = new Map<number, Stamp[]>();

/** A dot of radius r at the 16 quarter-pixel phases (index qy * PH + qx), supersampled. */
function dotStamps(r: number): Stamp[] {
  const key = Math.round(r * 1e4) / 1e4;
  let stamps = dotCache.get(key);
  if (stamps) return stamps;
  const R = Math.ceil(r) + 1, n = 2 * R + 1, r2 = r * r;
  stamps = [];
  for (let qy = 0; qy < PH; qy++) {
    for (let qx = 0; qx < PH; qx++) {
      // the centre sits at (qx / PH, qy / PH) from the anchor pixel's top-left corner
      const cx = R + qx / PH, cy = R + qy / PH;
      const a = new Uint8Array(n * n);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let hit = 0;
          for (let sy = 0; sy < SS; sy++) {
            const dy = y + (sy + 0.5) / SS - cy;
            for (let sx = 0; sx < SS; sx++) {
              const dx = x + (sx + 0.5) / SS - cx;
              if (dx * dx + dy * dy <= r2) hit++;
            }
          }
          a[y * n + x] = Math.round((hit * 255) / (SS * SS));
        }
      }
      stamps.push(tight(a, n, n, -R, -R));
    }
  }
  if (dotCache.size > 16) dotCache.clear();
  dotCache.set(key, stamps);
  return stamps;
}

/** Split a position into its anchor pixel and quarter-pixel phase. */
function place(v: number): [number, number] {
  let i = Math.floor(v);
  let q = Math.round((v - i) * PH);
  if (q === PH) { i++; q = 0; }
  return [i, q];
}

interface Region { x0: number; y0: number; x1: number; y1: number }

/** Accumulate a stamp into the coverage buffer ("over"), clipped to the region. */
function blend(s: Surface, st: Stamp, ax: number, ay: number, rg: Region) {
  if (!st.w) return;
  const W = s.width, cov = s.cov, a = st.a;
  const bx = ax + st.ox, by = ay + st.oy;
  const x0 = Math.max(bx, rg.x0), x1 = Math.min(bx + st.w, rg.x1);
  const y0 = Math.max(by, rg.y0), y1 = Math.min(by + st.h, rg.y1);
  for (let y = y0; y < y1; y++) {
    let i = y * W + x0, j = (y - by) * st.w + (x0 - bx);
    for (let x = x0; x < x1; x++, i++, j++) {
      const v = a[j]!;
      if (!v) continue;
      const c = cov[i]!;
      cov[i] = v === 255 ? 255 : c + v - ((c * v + 127) / 255 | 0);
    }
  }
}

// --------------------------------------------------------------------------------------- text

interface GlyphSet {
  css: string;
  base: number;
  ovX: number;
  ovY: number;
  bw: number;
  bh: number;
  masks: Map<number, Stamp[]>;
}

const glyphSets = new Map<string, GlyphSet>();
let scratch: HTMLCanvasElement | null = null;

function scratchCtx(w: number, h: number): CanvasRenderingContext2D {
  scratch ??= document.createElement('canvas');
  if (scratch.width < w || scratch.height < h) {
    scratch.width = Math.max(scratch.width, w);
    scratch.height = Math.max(scratch.height, h);
  }
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2D canvas');
  return ctx;
}

/**
 * raster.js fitFont: the font size whose advance is the cell width, the em box centred. `base` is
 * the baseline below the cell's top (letterframes.ts draws its glyph atlas with the same fit).
 */
export function fitFont(family: string, cellW: number, cellH: number): { css: string; base: number } {
  const ctx = scratchCtx(8, 8);
  ctx.font = `100px ${family}`;
  const adv = ctx.measureText('M').width / 100 || 0.6;
  const px = Math.min(cellW / adv, cellH / 1.05);
  ctx.font = `${px}px ${family}`;
  const mm = ctx.measureText('Mg');
  const asc = mm.fontBoundingBoxAscent ?? px * 0.8, desc = mm.fontBoundingBoxDescent ?? px * 0.2;
  return { css: `${px}px ${family}`, base: (cellH + asc - desc) / 2 };
}

function glyphSet(family: string, cellW: number, cellH: number): GlyphSet {
  const key = `${family}|${cellW}|${cellH}`;
  let set = glyphSets.get(key);
  if (set) return set;
  const fit = fitFont(family, cellW, cellH);
  // room for glyphs that overhang their cell (@, W, descenders)
  const ovX = Math.ceil(cellW * 0.5) + 2, ovY = Math.ceil(cellH * 0.35) + 2;
  set = {
    css: fit.css,
    base: fit.base,
    ovX, ovY,
    bw: Math.ceil(cellW) + 2 * ovX + 1,
    bh: Math.ceil(cellH) + 2 * ovY + 1,
    masks: new Map(),
  };
  // the Columns preview cycles through a cell size per keyframe
  if (glyphSets.size > 160) glyphSets.clear();
  glyphSets.set(key, set);
  return set;
}

/** Render every glyph the grid needs and the set lacks: 16 phases each, one readback. */
function prepareGlyphs(set: GlyphSet, cp: Uint32Array, cellW: number) {
  const need: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < cp.length; i++) {
    const v = cp[i]!;
    if (v === 0x20 || v === 0x2800 || seen.has(v) || set.masks.has(v)) continue;
    seen.add(v);
    need.push(v);
  }
  if (!need.length) return;
  const { bw, bh } = set;
  const W = bw * PH * PH, H = bh * need.length;
  const ctx = scratchCtx(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.font = set.css;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  need.forEach((v, gi) => {
    const ch = String.fromCodePoint(v);
    for (let q = 0; q < PH * PH; q++) {
      const qx = q % PH, qy = (q / PH) | 0;
      ctx.fillText(ch, q * bw + set.ovX + qx / PH + 0.5 * cellW, gi * bh + set.ovY + qy / PH + set.base);
    }
  });
  const data = ctx.getImageData(0, 0, W, H).data;
  need.forEach((v, gi) => {
    const stamps: Stamp[] = [];
    for (let q = 0; q < PH * PH; q++) {
      const a = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) {
        let src = ((gi * bh + y) * W + q * bw) * 4 + 3;
        for (let x = 0; x < bw; x++, src += 4) a[y * bw + x] = data[src]!;
      }
      stamps.push(tight(a, bw, bh, -set.ovX, -set.ovY));
    }
    set.masks.set(v, stamps);
  });
}

// --------------------------------------------------------------------------------------- draw

export interface RasterOpts {
  /** CSS font family list for letters (Geist Mono first). */
  font: string;
  /** Braille dot radius relative to the column pitch. */
  dotR: number;
}

/**
 * Paper over the whole surface, then the grid at `layout` (clipped to layout.clip in fill mode).
 * Returns the surface's ImageData, ready for putImageData.
 */
export function rasterize(s: Surface, grid: Grid, layout: Layout, colours: Colours, o: RasterOpts): ImageData {
  const W = s.width, H = s.height;
  const paper = word(...rgb(colours.paper));
  const surround = colours.surround ? word(...rgb(colours.surround)) : paper;
  s.px.fill(surround);
  if (surround !== paper) {
    // paper only inside the art's rectangle (the margin or the box stays surround)
    const r = layout.inner;
    const ix0 = Math.max(0, Math.floor(r.x)), ix1 = Math.min(W, Math.ceil(r.x + r.w));
    for (let yy = Math.max(0, Math.floor(r.y)), y1 = Math.min(H, Math.ceil(r.y + r.h)); yy < y1; yy++) {
      if (ix1 > ix0) s.px.fill(paper, yy * W + ix0, yy * W + ix1);
    }
  }
  const c = layout.clip;
  const rg: Region = {
    x0: Math.max(0, c ? Math.floor(c.x) : 0),
    y0: Math.max(0, c ? Math.floor(c.y) : 0),
    x1: Math.min(W, c ? Math.ceil(c.x + c.w) : W),
    y1: Math.min(H, c ? Math.ceil(c.y + c.h) : H),
  };
  if (rg.x1 <= rg.x0 || rg.y1 <= rg.y0) return s.image;
  const { cols, rows, cp } = grid;
  const { x, y, cellW, cellH } = layout;

  if (grid.mode === 'blocks' && grid.fg && grid.bg) {
    drawColourBlocks(s, grid, layout, rg);
    return s.image;
  }

  // the art's own box (plus overhang) inside the region: the only pixels that can get ink
  let pad = 2;
  if (grid.mode === 'braille') {
    const { r, centers } = brailleGeometry(cellW, cellH, o.dotR);
    const stamps = dotStamps(r);
    for (let row = 0; row < rows; row++) {
      const oy = y + row * cellH;
      for (let col = 0; col < cols; col++) {
        const v = cp[row * cols + col]!;
        const bits = v >= 0x2800 && v <= 0x28ff ? v - 0x2800 : 0;
        if (!bits) continue;
        const ox = x + col * cellW;
        for (let k = 0; k < 8; k++) {
          if (!((bits >> k) & 1)) continue;
          const ctr = centers[k]!;
          const [ax, qx] = place(ox + ctr[0]);
          const [ay, qy] = place(oy + ctr[1]);
          blend(s, stamps[qy * PH + qx]!, ax, ay, rg);
        }
      }
    }
    pad = Math.ceil(r) + 2;
  } else if (grid.mode === 'blocks') {
    // raster.js drawBlocks: edges on whole pixels, shared by neighbours (no seams)
    const X = (i: number) => Math.round(x + (i * cellW) / 2), Y = (j: number) => Math.round(y + (j * cellH) / 2);
    const cov = s.cov;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const mask = BLOCK_MASK.get(cp[row * cols + col]!) ?? 0;
        for (let k = 0; k < 4; k++) {
          if (!((mask >> k) & 1)) continue;
          const qx = 2 * col + (k & 1), qy = 2 * row + (k >> 1);
          const x0 = Math.max(X(qx), rg.x0), x1 = Math.min(X(qx + 1), rg.x1);
          const y0 = Math.max(Y(qy), rg.y0), y1 = Math.min(Y(qy + 1), rg.y1);
          for (let yy = y0; yy < y1; yy++) cov.fill(255, yy * W + x0, yy * W + Math.max(x0, x1));
        }
      }
    }
  } else {
    const set = glyphSet(o.font, cellW, cellH);
    prepareGlyphs(set, cp, cellW);
    for (let row = 0; row < rows; row++) {
      const [ay, qy] = place(y + row * cellH);
      for (let col = 0; col < cols; col++) {
        const v = cp[row * cols + col]!;
        if (v === 0x20 || v === 0x2800) continue;
        const st = set.masks.get(v);
        if (!st) continue;
        const [ax, qx] = place(x + col * cellW);
        blend(s, st[qy * PH + qx]!, ax, ay, rg);
      }
    }
    pad = Math.max(set.ovX, set.ovY) + 2;
  }

  // colour the covered pixels and clear the coverage for the next frame
  const lut = inkTable(colours.ink, colours.paper);
  const bx0 = Math.max(rg.x0, Math.floor(x) - pad), bx1 = Math.min(rg.x1, Math.ceil(x + layout.artW) + pad);
  const by0 = Math.max(rg.y0, Math.floor(y) - pad), by1 = Math.min(rg.y1, Math.ceil(y + layout.artH) + pad);
  const px = s.px, cov = s.cov;
  for (let yy = by0; yy < by1; yy++) {
    for (let i = yy * W + bx0, end = yy * W + bx1; i < end; i++) {
      const v = cov[i]!;
      if (v) { px[i] = lut[v]!; cov[i] = 0; }
    }
  }
  return s.image;
}

/** Colour blocks: each cell's background, then its quadrants in the foreground colour. */
function drawColourBlocks(s: Surface, grid: Grid, layout: Layout, rg: Region) {
  const { cols, rows, cp } = grid;
  const fg = grid.fg!, bg = grid.bg!;
  const { x, y, cellW, cellH } = layout;
  const W = s.width, px = s.px;
  const X = (i: number) => Math.round(x + (i * cellW) / 2), Y = (j: number) => Math.round(y + (j * cellH) / 2);
  const rect = (a: number, b: number, c: number, d: number, colour: number) => {
    const x0 = Math.max(a, rg.x0), x1 = Math.min(b, rg.x1), y0 = Math.max(c, rg.y0), y1 = Math.min(d, rg.y1);
    if (x1 <= x0) return;
    for (let yy = y0; yy < y1; yy++) px.fill(colour, yy * W + x0, yy * W + x1);
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      rect(X(2 * col), X(2 * col + 2), Y(2 * row), Y(2 * row + 2), word24(bg[i]!));
      const mask = BLOCK_MASK.get(cp[i]!) ?? 0;
      if (!mask) continue;
      const f = word24(fg[i]!);
      if (mask === 15) { rect(X(2 * col), X(2 * col + 2), Y(2 * row), Y(2 * row + 2), f); continue; }
      for (let k = 0; k < 4; k++) {
        if (!((mask >> k) & 1)) continue;
        const qx = 2 * col + (k & 1), qy = 2 * row + (k >> 1);
        rect(X(qx), X(qx + 1), Y(qy), Y(qy + 1), f);
      }
    }
  }
}
