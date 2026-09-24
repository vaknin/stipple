/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import { autoColumns, boxPx, clampBox, COLS_MAX, COLS_MIN, innerRect, layoutArt, type Box, type Layout, type LayoutIn } from './layout';

// Typist's File-target cell aspects (targets.js FIT.plain: cellEm / lineEm)
const ASPECT = { braille: 0.75 / 1.3, ascii: 0.6 / 1.3 };
const rowsFor = (cols: number, aspect: number) => Math.max(1, Math.round(cols * aspect));
const shape = (cols: number, aspect: number) => ({ cols, rows: rowsFor(cols, aspect), cellAspect: aspect });

const SIZES: [number, number][] = [
  [1920, 1080], [1080, 1920], [2560, 1440], [1366, 767], [1001, 999], [999, 1001], [3440, 1440],
  [800, 1280], [7, 5], [1, 1],
];
const BOXES: (Box | null)[] = [null, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, { x: 0.1, y: 0.6, w: 0.26, h: 0.185 }];
const GRIDS = [shape(125, ASPECT.braille), shape(156, ASPECT.ascii), shape(4, ASPECT.braille), shape(200, ASPECT.ascii),
  { cols: 37, rows: 91, cellAspect: 0.5 }];

function each(fn: (l: Layout, o: LayoutIn, g: (typeof GRIDS)[number]) => void) {
  for (const [width, height] of SIZES) {
    for (const box of BOXES) {
      for (const g of GRIDS) {
        const o = { width, height, box };
        fn(layoutArt(g, o), o, g);
      }
    }
  }
}

const EPS = 1e-6;

describe('art area', () => {
  test('Fill is the whole canvas', () => {
    expect(innerRect({ width: 1920, height: 1080 })).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(innerRect({ width: 1920, height: 1080, box: null })).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  test('a box is whole pixels of the canvas and stays on it', () => {
    const W = 1920, H = 1080;
    expect(boxPx({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, W, H)).toEqual({ x: 480, y: 270, w: 960, h: 540 });
    expect(boxPx({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, W, H)).toEqual({ x: 960, y: 540, w: 960, h: 540 });
    expect(clampBox({ x: -1, y: 2, w: 3, h: 0 }, 0.1)).toEqual({ x: 0, y: 0.9, w: 1, h: 0.1 });
    expect(clampBox({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 })).toEqual({ x: 0.25, y: 0, w: 0.5, h: 0.5 });
    const box = { x: 500 / W, y: 200 / H, w: 500 / W, h: 200 / H };
    expect(innerRect({ width: W, height: H, box })).toEqual({ x: 500, y: 200, w: 500, h: 200 });
  });
});

describe('layout', () => {
  test('the art covers the inner rectangle and is clipped to it', () => {
    each((l) => {
      expect(l.x).toBeLessThanOrEqual(l.inner.x);
      expect(l.y).toBeLessThanOrEqual(l.inner.y);
      expect(l.x + l.artW).toBeGreaterThanOrEqual(l.inner.x + l.inner.w - 1 - EPS);
      expect(l.y + l.artH).toBeGreaterThanOrEqual(l.inner.y + l.inner.h - 1 - EPS);
      expect(l.clip).toEqual(l.inner);
    });
  });

  test('overflow is symmetric within 1 px, at integer offsets', () => {
    each((l) => {
      const left = l.inner.x - l.x, right = l.x + l.artW - (l.inner.x + l.inner.w);
      const top = l.inner.y - l.y, bottom = l.y + l.artH - (l.inner.y + l.inner.h);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1 + EPS);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1 + EPS);
      expect(Number.isInteger(l.x)).toBe(true);
      expect(Number.isInteger(l.y)).toBe(true);
    });
  });

  test('cell aspect is preserved', () => {
    each((l, _o, g) => {
      expect(l.cellW / l.cellH).toBeCloseTo(g.cellAspect, 9);
      expect(l.artW).toBeCloseTo(g.cols * l.cellW, 6);
      expect(l.artH).toBeCloseTo(g.rows * l.cellH, 6);
    });
  });

  test('the layout scales with the canvas (the preview is the export, smaller)', () => {
    const g = shape(125, ASPECT.braille);
    const big = layoutArt(g, { width: 1920, height: 1080 });
    const small = layoutArt(g, { width: 960, height: 540 });
    expect(small.cellH * 2).toBeCloseTo(big.cellH, 1);
    expect(Math.abs(small.y * 2 - big.y)).toBeLessThanOrEqual(2);
  });
});

describe('auto columns', () => {
  const o = (width: number, height: number, box: Box | null = null) => ({ width, height, box });
  const aspectOf = (x: LayoutIn) => { const r = innerRect(x); return r.w / r.h; };
  // rows for a crop aspect (engine.rowsFor)
  const rowsAt = (cols: number, cell: number, a: number) => Math.max(1, Math.round((cols * cell) / a));

  test('1080p with the screen\'s aspect', () => {
    expect(autoColumns(ASPECT.braille, o(1920, 1080), 16 / 9)).toBe(222);
    expect(autoColumns(ASPECT.braille, o(1280, 720), 16 / 9)).toBe(148);
    expect(autoColumns(ASPECT.braille, o(1080, 1920), 9 / 16)).toBe(125);
  });

  test('the art fills its rectangle with cells about 15 px tall', () => {
    for (const [w, h] of SIZES.filter(([w, h]) => Math.min(w, h) >= 600)) {
      for (const box of BOXES) {
        for (const a of Object.values(ASPECT)) {
          const x = o(w, h, box), s = aspectOf(x);
          const cols = autoColumns(a, x, s);
          const rows = rowsAt(cols, a, s);
          const l = layoutArt({ cols, rows, cellAspect: a }, x);
          // the art's aspect is the rectangle's up to the rounding of the rows (half a row)
          expect(Math.abs(l.artW / l.artH - s)).toBeLessThanOrEqual((s * 0.5) / rows + EPS);
          if (cols === COLS_MAX || cols === COLS_MIN) continue;
          expect(l.cellH).toBeGreaterThan(13.5);
          expect(l.cellH).toBeLessThan(16.5);
        }
      }
    }
  });

  test('a box follows its own size', () => {
    const box = { x: 0, y: 0, w: 0.5, h: 300 / 1080 };
    expect(autoColumns(ASPECT.braille, o(1920, 1080, box), 960 / 300)).toBe(autoColumns(ASPECT.braille, o(960, 300), 960 / 300));
  });

  test('clamped to the column range', () => {
    expect(autoColumns(ASPECT.braille, o(7, 5), 1.4)).toBe(COLS_MIN);
    expect(autoColumns(ASPECT.braille, o(65536, 65536), 1)).toBe(COLS_MAX);
  });
});
