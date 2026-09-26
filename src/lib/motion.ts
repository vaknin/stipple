// Animated wallpapers: the settings and the keyframe timing the shell plugin mirrors.
// Keep columnFrameAt in step with Service.qml.
//
// Effect:
//   Columns   the column count sweeps From -> To -> From through real keyframes

import { COLS_MAX, COLS_MIN } from './layout';

export interface Motion {
  /**
   * `frames` keyframes from `from` to `to` columns (fewer when they would not fit), there and back
   * once per `period` s. The period only sets the pace: changing it renders nothing.
   */
  columns: { on: boolean; from: number; to: number; frames: number; period: number };
}

export const defaultMotion = (): Motion => ({
  columns: { on: false, from: 10, to: 500, frames: 130, period: 20 },
});

/** Motion from a sidecar (any older or partial form; an old Twinkle is dropped) over the defaults. */
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
  return { columns: part(d.columns, r.columns) };
}

export const anyMotion = (m: Motion) => m.columns.on;

/** Frames per second the effects need (the plugin's baseFps). 0 = still. */
export function motionFps(m: Motion): number {
  return m.columns.on ? columnRate(m.columns.frames, m.columns.period) : 0;
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
