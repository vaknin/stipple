/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { createConverter, type DotField } from '$typist/convert.js';
import { ditherDots, encodeBraille } from '$typist/dither.js';
import { COLS_MAX, COLS_MIN } from './layout';
import {
  cleanMotion, coloursAt, COLUMN_CELLS_MAX, columnFrameAt, columnKeyframes, columnPlan, columnStart, defaultMotion, frameDots, frameGrid, hash, motionFor, motionFps, nightColours, nightWeight, packField,
  type Motion,
} from './motion';

/** wall.frag's hash in exact uint32 arithmetic. */
function glslHash(x: number, y: number, z: number): number {
  const M = 0xffffffffn;
  let h = (BigInt(x) * 374761393n + BigInt(y) * 668265263n + BigInt(z) * 2246822519n) & M;
  h = ((h ^ (h >> 13n)) * 1274126177n) & M;
  h ^= h >> 16n;
  return Number(h >> 8n) / 16777216;
}

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function field(W: number, H: number, seed: number, dither: 'bayer' | 'atkinson' = 'bayer', edges = false): DotField {
  const r = rng(seed);
  const L = new Float32Array(W * H);
  for (let i = 0; i < L.length; i++) L[i] = r();
  const forced = new Uint8Array(W * H);
  if (edges) for (let i = 0; i < forced.length; i++) forced[i] = r() < 0.05 ? 1 : 0;
  const dots = ditherDots(L, W, H, dither);
  for (let i = 0; i < dots.length; i++) if (forced[i]) dots[i] = 1;
  return { width: W, height: H, L, dots, forced };
}

const with_ = (patch: (m: Motion) => void): Motion => {
  const m = defaultMotion();
  patch(m);
  return m;
};

describe('shader mirror', () => {
  test('hash is the shader hash', () => {
    const r = rng(7);
    for (let i = 0; i < 2000; i++) {
      const x = Math.floor(r() * 5000), y = Math.floor(r() * 5000), z = Math.floor(r() * 4294967295);
      expect(hash(x, y, z)).toBe(glslHash(x, y, z));
    }
  });

  test('frame 0 of a re-dithering effect is the saved Ordered dots', () => {
    for (const [W, H, seed] of [[400, 260, 1], [8, 4, 2], [250, 1000, 3]] as const) {
      const f = field(W, H, seed, 'bayer', seed === 1);
      const p = packField(f);
      const pan = with_(m => { m.pan.on = true; });
      expect(Array.from(frameDots(p, W, H, pan, 0))).toEqual(Array.from(f.dots));
      // the plain path reads the saved dots
      expect(Array.from(frameDots(p, W, H, defaultMotion(), 12.5))).toEqual(Array.from(f.dots));
    }
  });

  test('without a re-dithering effect the saved dots are drawn as they are (any dither)', () => {
    const f = field(120, 80, 4, 'atkinson');
    const p = packField(f);
    expect(Array.from(frameDots(p, 120, 80, defaultMotion(), 3))).toEqual(Array.from(f.dots));
  });

  test('twinkle flips one dot in about `amount` of the cells, the same at the same time', () => {
    const W = 400, H = 260, f = field(W, H, 5, 'atkinson');
    const p = packField(f);
    const m = with_(m => { m.twinkle.on = true; m.twinkle.amount = 0.05; });
    const a = frameDots(p, W, H, m, 1.3);
    const b = frameDots(p, W, H, m, 1.3);
    expect(Array.from(a)).toEqual(Array.from(b));
    let flipped = 0;
    const cells = (W / 2) * (H / 4);
    for (let r = 0; r < H / 4; r++) {
      for (let c = 0; c < W / 2; c++) {
        let n = 0;
        for (let k = 0; k < 8; k++) {
          const i = (r * 4 + (k >> 1)) * W + c * 2 + (k & 1);
          if (a[i] !== f.dots[i]) n++;
        }
        expect(n).toBeLessThanOrEqual(1);
        flipped += n;
      }
    }
    expect(flipped / cells).toBeGreaterThan(0.035);
    expect(flipped / cells).toBeLessThan(0.065);
    // another tick picks other cells
    expect(Array.from(frameDots(p, W, H, m, 1.3 + 1 / m.twinkle.rate))).not.toEqual(Array.from(a));
  });

  test('shimmer and pan move the dots but keep the amount of ink', () => {
    const W = 200, H = 200, f = field(W, H, 6);
    const p = packField(f);
    const ink = (d: Uint8Array) => d.reduce((s, v) => s + v, 0) / d.length;
    const base = ink(f.dots);
    for (const m of [with_(m => { m.shimmer.on = true; }), with_(m => { m.pan.on = true; })]) {
      const d = frameDots(p, W, H, m, 17.3);
      expect(Array.from(d)).not.toEqual(Array.from(f.dots));
      expect(Math.abs(ink(d) - base)).toBeLessThan(0.05);
    }
  });

  test('frameGrid encodes the frame as Braille', () => {
    const f = field(40, 16, 8);
    const g = frameGrid(packField(f), 40, 16, defaultMotion(), 0);
    expect(Array.from(g.cp)).toEqual(Array.from(encodeBraille(f.dots, 40, 16).cp));
    expect([g.cols, g.rows, g.mode]).toEqual([20, 4, 'braille']);
  });

  test('the converter field: saved dots, and frame 0 of Ordered equals them', () => {
    const w = 300, h = 300, data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p += 4) {
        const v = Math.round(255 * (0.5 + 0.5 * Math.sin(x / 17) * Math.cos(y / 23)));
        data[p] = data[p + 1] = data[p + 2] = v;
        data[p + 3] = 255;
      }
    }
    const conv = createConverter();
    conv.setSource({ width: w, height: h, data });
    for (const edges of [0, 0.8]) {
      const g = conv.run({}, { mode: 'braille', cols: 60, rows: 35, dither: 'bayer', field: true, tone: { edges } });
      const f = g.field!;
      expect([f.width, f.height]).toEqual([120, 140]);
      expect(Array.from(encodeBraille(f.dots, f.width, f.height).cp)).toEqual(Array.from(g.cp));
      const pan = with_(m => { m.pan.on = true; });
      expect(Array.from(frameDots(packField(f), f.width, f.height, pan, 0))).toEqual(Array.from(f.dots));
    }
    expect(conv.run({}, { mode: 'ascii', cols: 20, rows: 10 }).field).toBeNull();
  });
});

describe('settings', () => {
  test('frame rate', () => {
    expect(motionFps(defaultMotion())).toBe(0);
    expect(motionFps(with_(m => { m.day.on = true; }))).toBe(0);
    expect(motionFps(with_(m => { m.twinkle.on = true; m.twinkle.rate = 6; }))).toBe(6);
    expect(motionFps(with_(m => { m.twinkle.on = m.shimmer.on = true; m.twinkle.rate = 6; m.shimmer.rate = 9; }))).toBe(9);
    expect(motionFps(with_(m => { m.twinkle.on = m.pan.on = true; m.pan.fps = 12; }))).toBe(12);
  });

  test('motionFor keeps only what the style can play and resolves the night colours', () => {
    const all = with_(m => { m.twinkle.on = m.shimmer.on = m.pan.on = m.day.on = true; });
    const c = { ink: '#111111', paper: '#eeeeee' };
    const on = (m: Motion) => [m.twinkle.on, m.shimmer.on, m.pan.on, m.day.on];
    expect(on(motionFor(all, { dots: true, ordered: true, mono: true, letters: false }, c))).toEqual([true, true, true, true]);
    expect(on(motionFor(all, { dots: true, ordered: false, mono: true, letters: false }, c))).toEqual([true, false, false, true]);
    expect(on(motionFor(all, { dots: false, ordered: false, mono: true, letters: false }, c))).toEqual([false, false, false, true]);
    expect(on(motionFor(all, { dots: false, ordered: false, mono: false, letters: false }, c))).toEqual([false, false, false, false]);
    const m = motionFor(all, { dots: true, ordered: true, mono: true, letters: false }, c);
    expect([m.day.nightInk, m.day.nightPaper]).toEqual(['#eeeeee', '#111111']);
    all.day.nightInk = '#ff0000';
    expect(nightColours(all, c)).toEqual({ ink: '#ff0000', paper: '#111111' });
  });
});

describe('colour over the day', () => {
  const S = 19 * 60, E = 7 * 60;

  test('day and night', () => {
    expect(nightWeight(12 * 60, S, E, 60)).toBe(0);
    expect(nightWeight(0, S, E, 60)).toBe(1);
    expect(nightWeight(S, S, E, 60)).toBe(0.5);
    expect(nightWeight(E, S, E, 60)).toBe(0.5);
    expect(nightWeight(S - 30, S, E, 60)).toBe(0);
    expect(nightWeight(S + 30, S, E, 60)).toBe(1);
    expect(nightWeight(S + 15, S, E, 60)).toBe(0.75);
    expect(nightWeight(E - 15, S, E, 60)).toBe(0.75);
    // a night inside one day, and no fade
    expect(nightWeight(3 * 60, 60, 5 * 60, 0)).toBe(1);
    expect(nightWeight(6 * 60, 60, 5 * 60, 0)).toBe(0);
  });

  test('the weight is continuous round the clock', () => {
    for (const [s, e, fade] of [[S, E, 60], [S, E, 180], [60, 300, 30], [0, 720, 120]] as const) {
      for (let m = 0; m < 1440; m++) {
        const a = nightWeight(m, s, e, fade), b = nightWeight((m + 1) % 1440, s, e, fade);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        expect(Math.abs(a - b)).toBeLessThanOrEqual(1 / fade + 1e-9);
      }
    }
  });

  test('colours mix, a custom surround stays', () => {
    const m = with_(m => { m.day.on = true; m.day.fade = 0; });
    const c = { ink: '#000000', paper: '#ffffff', surround: '#123456' };
    expect(coloursAt(m, c, 12 * 60)).toEqual({ ink: '#000000', paper: '#ffffff', surround: '#123456' });
    expect(coloursAt(m, c, 0)).toEqual({ ink: '#ffffff', paper: '#000000', surround: '#123456' });
    expect(coloursAt(m, { ink: '#000000', paper: '#ffffff' }, 0).surround).toBe('#000000');
    m.day.fade = 60;
    expect(coloursAt(m, c, S).ink).toBe('#808080');
    expect(coloursAt(defaultMotion(), c, 0)).toBe(c);
  });
});

describe('columns', () => {
  test('keyframes: geometric, deduped, in range, with the saved count', () => {
    const k = columnKeyframes(10, 500, 40, 125);
    expect(k[0]).toBe(10);
    expect(k[k.length - 1]).toBe(500);
    expect(k).toContain(125);
    expect(new Set(k).size).toBe(k.length);
    for (let i = 1; i < k.length; i++) expect(k[i]!).toBeGreaterThan(k[i - 1]!);
    // from > to is the same range; a saved count outside it is not added
    expect(columnKeyframes(500, 10, 40, 1000)).toEqual(columnKeyframes(10, 500, 40, 1000));
    expect(columnKeyframes(10, 500, 40, 1000)).not.toContain(1000);
    expect(columnKeyframes(1, 99999, 2, 0)).toEqual([COLS_MIN, COLS_MAX]);
    expect(columnKeyframes(10, 12, 40, 11)).toEqual([10, 11, 12]);
  });

  test('the sweep starts on the saved frame and goes there and back', () => {
    const k = columnKeyframes(10, 500, 40, 125), s = columnStart(k, 125);
    expect(k[s]).toBe(125);
    expect(columnStart(k, 5)).toBe(0);
    expect(columnStart(k, 9000)).toBe(k.length - 1);
    const n = k.length, P = 20;
    expect(columnFrameAt(0, n, P, s)).toBe(s);
    expect(columnFrameAt(0, n, P, 0)).toBe(0);
    expect(columnFrameAt(P / 2, n, P, 0)).toBe(n - 1);
    expect(columnFrameAt(P, n, P, 0)).toBe(0);
    expect(columnFrameAt(-P, n, P, 0)).toBe(0);
    // an even pace: every keyframe but the two ends shows for the same time
    const time = new Map<number, number>();
    for (let t = 0; t < P; t += 0.001) { const i = columnFrameAt(t, n, P, s); time.set(i, (time.get(i) ?? 0) + 0.001); }
    expect(time.size).toBe(n);
    const each = P / (2 * (n - 1));
    for (let i = 1; i < n - 1; i++) expect(Math.abs(time.get(i)! - 2 * each)).toBeLessThan(0.01);
    expect(columnFrameAt(3, 1, P, 0)).toBe(0);
  });

  test('frame rate, style support and older sidecars', () => {
    const m = with_(x => { x.columns.on = true; x.columns.fps = 12; });
    expect(motionFps(m)).toBe(12);
    const c = { ink: '#111111', paper: '#eeeeee' };
    expect(motionFor(m, { dots: false, ordered: false, mono: true, letters: true }, c).columns.on).toBe(true);
    expect(motionFor(m, { dots: true, ordered: true, mono: true, letters: false }, c).columns.on).toBe(false);
    expect(cleanMotion({ twinkle: { on: true } }).columns).toEqual(defaultMotion().columns);
  });

  test('a plan makes a keyframe per frame, capped by the cells', () => {
    const rows = (k: number) => Math.round(k * 0.46);
    const p = columnPlan({ on: true, from: 10, to: 500, fps: 15, period: 20 }, 156, rows);
    expect(p.capped).toBe(false);
    // 151 geometric steps, fewer where whole numbers collide near 10 columns
    expect(p.cols.length).toBeGreaterThan(120);
    expect(p.cols.length).toBeLessThanOrEqual(152);
    const big = columnPlan({ on: true, from: 10, to: 4096, fps: 30, period: 600 }, 156, rows);
    expect(big.capped).toBe(true);
    expect(big.cells).toBeLessThanOrEqual(COLUMN_CELLS_MAX);
  });
});
