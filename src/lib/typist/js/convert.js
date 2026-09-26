// Converter: photo + crop + options -> Grid. Memoised in layers so each control redoes only what it
// affects: the sample depends on crop + grid size, the tone on the sample + tone controls, and the
// glyph match runs on top of the cached tone.
// Stipple patch: Letters only. Upstream's Braille dots (dither.js) and blocks (blocks.js) are cut.

import { sampleImage, decodeSource, toneGrid, normalizeTone, TONE_DEFAULTS, CROP_DEFAULTS, LOOKS } from './tone.js';

export { TONE_DEFAULTS, CROP_DEFAULTS, LOOKS };

// Stipple patch: a static import. Upstream loaded ascii.js with a top-level
// `await import()` so the app kept working while ascii.js was being written; that top-level await
// made every importer's module graph async, which broke SvelteKit's page loading in WebKitGTK.
// ascii.js always ships here, so the fallback is not needed.
import * as asciiModule from './ascii.js';
const ascii = asciiModule;
const asciiError = null;

/** Mean ink coverage the auto tone aims for. */
export const INK_TARGET = 0.4;

export const OPTS_DEFAULTS = Object.freeze({ mode: 'ascii', cols: 40, rows: 0, ascii: 'shape' });

// Fallback cell aspect when the caller gives no rows (the app's rowsFor is the real source).
const ASPECT = 0.46;

// ASCII: the glyph matcher reads an SX x SY raster per cell (8 x 17): 228k samples at 60 x 28, and
// toning that many dominated a fresh crop (~400 ms at 4x CPU throttling). The photo is sampled and
// toned at most ASCII_SAMPLE per cell (4x fewer) and asciiCells area-resamples that to its raster,
// so each sub-circle still integrates the photo (every coarse sample is an area average itself).
export const ASCII_SAMPLE = [4, 8];

/** Sample grid size for a set of options. */
export function sampleSize(o) {
  const { mode, cols, rows } = o;
  if (mode !== 'ascii') throw new Error('unknown mode ' + mode);
  if (!ascii) throw new Error('ASCII mode unavailable: ' + (asciiError ? asciiError.message : 'ascii.js not loaded'));
  const [SX, SY] = ascii.ASCII_SUB;
  return [cols * Math.min(SX, ASCII_SAMPLE[0]), rows * Math.min(SY, ASCII_SAMPLE[1])];
}

/** Raw rows of a Grid. Blanks are U+0020. */
export function gridLines(grid) {
  const out = [];
  for (let r = 0; r < grid.rows; r++) {
    let s = '';
    for (let c = 0; c < grid.cols; c++) s += String.fromCodePoint(grid.cp[r * grid.cols + c]);
    out.push(s);
  }
  return out;
}

class LRU {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(k) {
    const v = this.map.get(k);
    if (v !== undefined) { this.map.delete(k); this.map.set(k, v); }
    return v;
  }
  set(k, v) {
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
  clear() { this.map.clear(); }
}

export function createConverter() {
  // the photo decoded once (RGBA, long side <= 1024): every crop resamples it in plain JS, so a
  // fresh crop is cheap and gives the same samples in every engine
  let source = null;
  // a few entries each, so flipping between grid sizes does not redo the work
  const samples = new LRU(6);
  const tones = new LRU(8);
  const stats = { samples: 0, tones: 0, encodes: 0 };
  let decodeMs = 0;

  function run(crop, opts = {}) {
    if (!source) throw new Error('converter: no source');
    const o = { ...OPTS_DEFAULTS, ...opts };
    const c = { ...CROP_DEFAULTS, ...crop };
    // NaN / Infinity from a parsed field must not size the grid (NaN cols gave a 0-wide Grid)
    const num = (v, d) => (Number.isFinite(+v) ? +v : d);
    o.cols = Math.max(1, Math.round(num(o.cols, OPTS_DEFAULTS.cols)));
    o.rows = Math.max(1, Math.round(num(o.rows, 0) || o.cols * ASPECT));
    const tone = normalizeTone(o.tone);   // defaults, clamped sliders, a valid look
    const [W, H] = sampleSize(o);

    // Stipple patch: the crop's aspect is part of the sample (see tone.js cropSize)
    const sKey = `${c.x},${c.y},${c.zoom},${c.rotation},${c.aspect || 1}|${W}x${H}`;
    let img = samples.get(sKey);
    if (!img) {
      img = sampleImage(source, c, W, H);
      samples.set(sKey, img);
      stats.samples++;
    }

    const tKey = `${sKey}|${tone.look}|${tone.auto ? 1 : 0},${tone.brightness},${tone.contrast},${tone.gamma},` +
      `${tone.detail},${tone.edges},${tone.invert ? 1 : 0}`;
    let L = tones.get(tKey);
    if (!L) {
      L = toneGrid(img, tone, { target: INK_TARGET, boost: 0 });
      tones.set(tKey, L);
      stats.tones++;
    }

    stats.encodes++;
    const cp = ascii.asciiCells(L, W, H, o.cols, o.rows, { method: o.ascii, contrast: o.asciiContrast });
    let ink = 0;
    for (let i = 0; i < L.length; i++) ink += 1 - L[i];
    return { mode: o.mode, cols: o.cols, rows: o.rows, cp, fg: null, bg: null, ink: ink / L.length, tone: L.stats };
  }

  return {
    stats,
    get asciiReady() { return !!ascii; },
    setSource(s) {
      samples.clear(); tones.clear();
      const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
      source = s ? decodeSource(s) : null;
      decodeMs = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
    },
    /** The decoded working buffer { width, height, data } (null before setSource). */
    get decoded() { return source; },
    get decodeMs() { return decodeMs; },
    run,
  };
}
