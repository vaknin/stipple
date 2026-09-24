// Animated wallpapers: the settings, the dot field the renderer reads, and a JS mirror of the
// shell plugin's shader (shell-plugin/kivan.stipple/shaders/wall.frag) for the app's preview.
// Keep hash, BAYER4, panned, dotOn and columnFrameAt in step with wall.frag / Service.qml.
//
// Effects (combinable):
//   Twinkle   a few cells, picked at random each tick, flip one dot (Dots, any dither)
//   Shimmer   the tone is re-dithered each tick with noise in the threshold (Dots + Ordered)
//   Pan       the view breathes in and wanders inside the crop, re-dithered (Dots + Ordered)
//   Columns   the column count sweeps From -> To -> From through real keyframes (Letters)

import type { DotField, Grid } from '$typist/convert.js';
import { encodeBraille } from '$typist/dither.js';
import { COLS_MAX, COLS_MIN } from './layout';

export type Rate = 'keep' | 'slow' | 'still';
export type BatteryRule = 'same' | 'half' | 'still';

export interface Motion {
  twinkle: { on: boolean; amount: number; rate: number };
  shimmer: { on: boolean; amount: number; rate: number };
  pan: { on: boolean; zoom: number; period: number; fps: number };
  /**
   * `frames` keyframes from `from` to `to` columns (fewer when they would not fit), there and back
   * once per `period` s. The period only sets the pace: changing it renders nothing.
   */
  columns: { on: boolean; from: number; to: number; frames: number; period: number };
  /** With windows open on the screen's workspace. */
  windows: Rate;
  battery: BatteryRule;
  seed: number;
}

export const defaultMotion = (): Motion => ({
  twinkle: { on: false, amount: 0.04, rate: 8 },
  shimmer: { on: false, amount: 0.3, rate: 8 },
  pan: { on: false, zoom: 0.15, period: 60, fps: 8 },
  columns: { on: false, from: 10, to: 500, frames: 130, period: 20 },
  windows: 'slow',
  battery: 'same',
  seed: 1,
});

/** What each effect needs, for the Motion tab to explain a disabled switch. */
export interface Support { dots: boolean; ordered: boolean; letters: boolean }

/** Which effects a style can play: dot effects need Dots, re-dithering needs Ordered too. */
export function supportFor(doc: { mode: string; dither: string; color: boolean }): Support {
  const dots = doc.mode === 'braille';
  return { dots, ordered: dots && doc.dither === 'bayer', letters: doc.mode === 'ascii' };
}

/** Motion from a sidecar (any older or partial form) over the defaults. */
export function cleanMotion(raw: unknown): Motion {
  const d = defaultMotion();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const part = <T extends object>(def: T, v: unknown): T => {
    if (!v || typeof v !== 'object') return def;
    const out = { ...def } as Record<string, unknown>;
    for (const [k, dv] of Object.entries(def)) {
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === typeof dv && (typeof x !== 'number' || Number.isFinite(x))) out[k] = x;
      else if (dv === null && (x === null || (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x)))) out[k] = x;
    }
    return out as T;
  };
  const pick = <T extends string>(v: unknown, ok: readonly T[], def: T): T => (ok.includes(v as T) ? (v as T) : def);
  return {
    twinkle: part(d.twinkle, r.twinkle),
    shimmer: part(d.shimmer, r.shimmer),
    pan: part(d.pan, r.pan),
    columns: part(d.columns, columnsFrom(r.columns)),
    windows: pick(r.windows, ['keep', 'slow', 'still'] as const, d.windows),
    battery: pick(r.battery, ['same', 'half', 'still'] as const, d.battery),
    seed: typeof r.seed === 'number' && Number.isFinite(r.seed) ? r.seed >>> 0 : d.seed,
  };
}

/** Columns from the first release asked for `fps` keyframes a second: the frames that made. */
function columnsFrom(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const c = v as Record<string, unknown>;
  if (typeof c.frames === 'number' || typeof c.fps !== 'number' || typeof c.period !== 'number') return v;
  return { ...c, frames: Math.round((c.fps * c.period) / 2) + 1 };
}

export const anyMotion = (m: Motion) => m.twinkle.on || m.shimmer.on || m.pan.on || m.columns.on;
/** Effects drawn from the dot field (Dots only). */
export const dotMotion = (m: Motion) => m.twinkle.on || m.shimmer.on || m.pan.on;
/** Effects that re-dither the tone (need Ordered dithering to start from the saved dots). */
export const toneMotion = (m: Motion) => m.shimmer.on || m.pan.on;

/** Frames per second the effects need (the plugin's baseFps). 0 = still. */
export function motionFps(m: Motion): number {
  if (m.columns.on) return columnRate(m.columns.frames, m.columns.period);
  if (!dotMotion(m)) return 0;
  if (m.pan.on) return m.pan.fps;
  return Math.max(m.twinkle.on ? m.twinkle.rate : 0, m.shimmer.on ? m.shimmer.rate : 0);
}

/** The motion as the sidecar stores it: only the effects this wallpaper can play stay on. */
export function motionFor(m: Motion, s: Support): Motion {
  return {
    ...m,
    twinkle: { ...m.twinkle, on: m.twinkle.on && s.dots },
    shimmer: { ...m.shimmer, on: m.shimmer.on && s.dots && s.ordered },
    pan: { ...m.pan, on: m.pan.on && s.dots && s.ordered },
    columns: { ...m.columns, on: m.columns.on && s.letters },
  };
}

// ------------------------------------------------------------------------------------ columns

/**
 * The column counts of the Columns keyframes, ascending: `steps` counts spaced geometrically
 * between `from` and `to` (every step looks about as big), plus `saved`, the still picture's
 * count, when it lies in the range. Near the coarse end the counts are whole numbers apart, so
 * there are fewer of them than asked for.
 */
export function columnKeyframes(from: number, to: number, steps: number, saved: number): number[] {
  const c = (v: number) => Math.min(COLS_MAX, Math.max(COLS_MIN, Math.round(Number.isFinite(v) ? v : COLS_MIN)));
  const lo = c(Math.min(from, to)), hi = c(Math.max(from, to));
  const n = Math.max(2, Math.round(Number.isFinite(steps) ? steps : 2));
  const out = new Set<number>();
  for (let i = 0; i < n; i++) out.add(c(lo * (hi / lo) ** (i / (n - 1))));
  if (saved >= lo && saved <= hi) out.add(c(saved));
  return [...out].sort((a, b) => a - b);
}

/** Cells all keyframes may hold together (frames.png: 4096 wide, room to spare under 8192 tall). */
export const COLUMN_CELLS_MAX = 4096 * 6000;

/**
 * The keyframes a Columns setting makes: `frames` distinct counts (all the whole numbers in the
 * range when it holds fewer), fewer when all their cells would not fit COLUMN_CELLS_MAX. `rowsOf`
 * gives a count's rows. `capped`: the cell budget cut them.
 */
export function columnPlan(c: Pick<Motion['columns'], 'from' | 'to' | 'frames'>, saved: number, rowsOf: (cols: number) => number) {
  const want = Math.max(2, Math.round(Number.isFinite(c.frames) ? c.frames : 2));
  // whole numbers collide near the coarse end: add steps until there are `want` distinct counts
  let steps = want;
  let cols = columnKeyframes(c.from, c.to, steps, saved);
  const whole = () => cols[cols.length - 1]! - cols[0]! + 1;
  while (cols.length < want && cols.length < whole() && steps < 1e5) {
    steps += Math.max(1, want - cols.length);
    cols = columnKeyframes(c.from, c.to, steps, saved);
  }
  const cellsOf = (k: number[]) => k.reduce((a, n) => a + n * rowsOf(n), 0);
  let cells = cellsOf(cols), capped = false;
  while (cells > COLUMN_CELLS_MAX && steps > 2) {
    steps = Math.max(2, Math.floor(steps * 0.8));
    cols = columnKeyframes(c.from, c.to, steps, saved);
    cells = cellsOf(cols);
    capped = true;
  }
  return { cols, cells, capped };
}

/** Keyframe changes a second: a sweep there and back is 2 (n - 1) steps (columnFrameAt). */
export function columnRate(n: number, period: number): number {
  return n < 2 ? 0 : Math.min(60, (2 * (n - 1)) / Math.max(period, 1));
}

/** The keyframe to start on: the saved count's, or the nearer end. */
export function columnStart(keys: number[], saved: number): number {
  let best = 0;
  for (let i = 1; i < keys.length; i++) if (Math.abs(keys[i]! - saved) < Math.abs(keys[best]! - saved)) best = i;
  return best;
}

/**
 * The keyframe shown at time t (s): there and back once per `period` at an even pace, so every
 * keyframe shows for the same time, and keyframe `start` at t = 0 (Service.qml columnFrameAt).
 */
export function columnFrameAt(t: number, n: number, period: number, start: number): number {
  if (n < 2) return 0;
  const P = Math.max(period, 1);
  const s0 = Math.min(1, Math.max(0, start / (n - 1)));
  const u = ((((t / P + s0 / 2) % 1) + 1) % 1);
  const i = Math.round((n - 1) * (u < 0.5 ? 2 * u : 2 - 2 * u));
  return Math.min(n - 1, Math.max(0, i));
}

// ------------------------------------------------------------------------------ shader mirror

/** 4x4 Bayer matrix of dither.js (Ordered). */
export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const bayer = (x: number, y: number) => (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

/** wall.frag hash: three uints to [0, 1). */
export function hash(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, -2048144777)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}

/**
 * The field texture the plugin reads (RGB, one texel per dot): R the saved dot, G the ink amount
 * 1 - L quantised so the Ordered threshold at that dot decides as the engine did, B the dot edge
 * emphasis forces on.
 */
export function packField(f: DotField): Uint8Array {
  const { width: W, height: H, L, dots, forced } = f;
  const out = new Uint8Array(W * H * 3);
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const v = 1 - L[i]!;
      let b = Math.max(0, Math.min(255, Math.round(v * 255)));
      // keep the side of this dot's threshold: b / 255 > t exactly when v > t
      const t = bayer(x, y) * 255;
      if (v * 255 > t) b = Math.max(b, Math.ceil(t));
      else b = Math.min(b, Math.floor(t));
      out[i * 3] = dots[i] ? 255 : 0;
      out[i * 3 + 1] = b;
      out[i * 3 + 2] = forced[i] ? 255 : 0;
    }
  }
  return out;
}

/** wall.frag panned(): sample-space position for pan and zoom at time t. */
function panned(px: number, py: number, W: number, H: number, m: Motion, t: number): [number, number] {
  if (!m.pan.on || m.pan.zoom <= 0) return [px, py];
  const P = Math.max(m.pan.period, 1);
  const z = 1 + m.pan.zoom * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / P));
  const cx = W / 2, cy = H / 2;
  const a = (2 * Math.PI * t) / (P * 1.618);
  const k = (1 - 1 / z) * 0.9;
  return [cx + (px - cx) / z + k * cx * Math.cos(a), cy + (py - cy) / z + k * cy * Math.sin(a * 1.3)];
}

/** The dots of one frame at time t (seconds since the wallpaper appeared), as wall.frag dotOn. */
export function frameDots(packed: Uint8Array, W: number, H: number, m: Motion, t: number, out: Uint8Array = new Uint8Array(W * H)): Uint8Array {
  const seed = (m.seed >>> 0) % 65536;
  const live = toneMotion(m);
  const shimmer = m.shimmer.on ? m.shimmer.amount : 0;
  const sTick = Math.floor(t * m.shimmer.rate);
  const G = (x: number, y: number) =>
    packed[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 3 + 1]! / 255;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      if (!live) { out[i] = packed[i * 3]! > 127 ? 1 : 0; continue; }
      const [px, py] = panned(x + 0.5, y + 0.5, W, H, m, t);
      const qx = px - 0.5, qy = py - 0.5;
      const x0 = Math.floor(qx), y0 = Math.floor(qy), fx = qx - x0, fy = qy - y0;
      const v = (G(x0, y0) * (1 - fx) + G(x0 + 1, y0) * fx) * (1 - fy) + (G(x0, y0 + 1) * (1 - fx) + G(x0 + 1, y0 + 1) * fx) * fy;
      let thr = bayer(x, y);
      if (shimmer > 0) thr += (hash(x, y, (sTick * 4 + seed) >>> 0) - 0.5) * shimmer;
      const fxI = Math.min(W - 1, Math.max(0, Math.floor(px))), fyI = Math.min(H - 1, Math.max(0, Math.floor(py)));
      out[i] = v > thr || packed[(fyI * W + fxI) * 3 + 2]! > 127 ? 1 : 0;
    }
  }
  if (m.twinkle.on && m.twinkle.amount > 0) {
    const tk = (Math.floor(t * m.twinkle.rate) * 4 + seed) >>> 0;
    const cols = W >> 1, rows = H >> 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (hash(c, r, tk + 1) >= m.twinkle.amount) continue;
        const k = Math.min(7, Math.floor(hash(c, r, tk + 2) * 8));
        const i = (r * 4 + (k >> 1)) * W + c * 2 + (k & 1);
        out[i] = out[i] ? 0 : 1;
      }
    }
  }
  return out;
}

/** A Dots grid for one frame (for the preview's rasteriser). */
export function frameGrid(packed: Uint8Array, W: number, H: number, m: Motion, t: number, scratch?: Uint8Array): Grid {
  const g = encodeBraille(frameDots(packed, W, H, m, t, scratch), W, H);
  return { mode: 'braille', cols: g.cols, rows: g.rows, cp: g.cp, fg: null, bg: null, ink: g.ink };
}
