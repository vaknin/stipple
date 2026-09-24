/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  autoColumns, COLS_MAX, COLS_MIN, innerRect, layoutArt, MARGIN_MAX, marginPx,
  type Layout, type LayoutIn, type Placement,
} from './layout';

// Typist's File-target cell aspects (targets.js FIT.plain: cellEm / lineEm)
const ASPECT = { braille: 0.75 / 1.3, ascii: 0.6 / 1.3, blocks: 0.6 / 1.2 };
const rowsFor = (cols: number, aspect: number) => Math.max(1, Math.round(cols * aspect));
const shape = (cols: number, aspect: number) => ({ cols, rows: rowsFor(cols, aspect), cellAspect: aspect });

const SIZES: [number, number][] = [
  [1920, 1080], [1080, 1920], [2560, 1440], [1366, 767], [1001, 999], [999, 1001], [3440, 1440],
  [800, 1280], [7, 5], [1, 1],
];
const MARGINS = [0, 2.5, 10, MARGIN_MAX];
const GRIDS = [shape(125, ASPECT.braille), shape(156, ASPECT.ascii), shape(144, ASPECT.blocks),
  shape(4, ASPECT.braille), shape(200, ASPECT.ascii), { cols: 37, rows: 91, cellAspect: 0.5 }];

function each(fn: (l: Layout, o: LayoutIn, g: (typeof GRIDS)[number]) => void, placement: Placement) {
  for (const [width, height] of SIZES) {
    for (const marginPct of MARGINS) {
      for (const g of GRIDS) {
        const o = { width, height, marginPct, placement };
        fn(layoutArt(g, o), o, g);
      }
    }
  }
}

const EPS = 1e-6;

describe('margin', () => {
  test('a share of the shorter side, clamped, whole pixels', () => {
    expect(marginPx(1920, 1080, 0)).toBe(0);
    expect(marginPx(1920, 1080, 10)).toBe(108);
    expect(marginPx(1080, 1920, 10)).toBe(108);
    expect(marginPx(1920, 1080, 5)).toBe(54);
    expect(marginPx(1920, 1080, -5)).toBe(0);
    expect(marginPx(1920, 1080, 99)).toBe(Math.round(1080 * MARGIN_MAX / 100));
    expect(marginPx(1920, 1080, Number.NaN)).toBe(0);
  });

  test('inner rectangle is the canvas minus the margin on every side', () => {
    expect(innerRect({ width: 1920, height: 1080, marginPct: 10 })).toEqual({ x: 108, y: 108, w: 1704, h: 864 });
    expect(innerRect({ width: 1920, height: 1080, marginPct: 0 })).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });
});

describe('fit', () => {
  test('the whole art stays inside the inner rectangle', () => {
    each((l) => {
      expect(l.x).toBeGreaterThanOrEqual(l.inner.x);
      expect(l.y).toBeGreaterThanOrEqual(l.inner.y);
      expect(l.x + l.artW).toBeLessThanOrEqual(l.inner.x + l.inner.w + EPS);
      expect(l.y + l.artH).toBeLessThanOrEqual(l.inner.y + l.inner.h + EPS);
      expect(l.clip).toBeNull();
    }, 'fit');
  });

  test('one side touches the inner rectangle (as large as it can be)', () => {
    each((l) => {
      const w = Math.abs(l.artW - l.inner.w) < 1e-6, h = Math.abs(l.artH - l.inner.h) < 1e-6;
      expect(w || h).toBe(true);
    }, 'fit');
  });

  test('centred within 1 px on both axes', () => {
    each((l) => {
      const left = l.x - l.inner.x, right = l.inner.x + l.inner.w - (l.x + l.artW);
      const top = l.y - l.inner.y, bottom = l.inner.y + l.inner.h - (l.y + l.artH);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1 + EPS);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1 + EPS);
    }, 'fit');
  });

  test('integer offsets', () => {
    each((l) => {
      expect(Number.isInteger(l.x)).toBe(true);
      expect(Number.isInteger(l.y)).toBe(true);
    }, 'fit');
  });

  test('landscape 1080p Braille: art is 1080 tall, pillarboxed evenly', () => {
    const l = layoutArt(shape(125, ASPECT.braille), { width: 1920, height: 1080, marginPct: 0, placement: 'fit' });
    expect(l.artH).toBeCloseTo(1080, 6);
    expect(l.y).toBe(0);
    expect(l.cellH).toBeCloseTo(15, 6);
    const left = l.x, right = 1920 - l.x - l.artW;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  test('portrait output: a square art is width-limited and letterboxed', () => {
    const l = layoutArt(shape(125, ASPECT.braille), { width: 1080, height: 1920, marginPct: 0, placement: 'fit' });
    expect(l.artW).toBeCloseTo(1080, 6);
    expect(l.x).toBe(0);
    expect(l.y).toBeGreaterThan(400);
  });

  test('margin keeps paper around the art', () => {
    const l = layoutArt(shape(125, ASPECT.braille), { width: 1920, height: 1080, marginPct: 10, placement: 'fit' });
    expect(l.y).toBe(108);
    expect(l.artH).toBeCloseTo(864, 6);
  });
});

describe('fill', () => {
  test('the art covers the inner rectangle and is clipped to it', () => {
    each((l) => {
      expect(l.x).toBeLessThanOrEqual(l.inner.x);
      expect(l.y).toBeLessThanOrEqual(l.inner.y);
      expect(l.x + l.artW).toBeGreaterThanOrEqual(l.inner.x + l.inner.w - 1 - EPS);
      expect(l.y + l.artH).toBeGreaterThanOrEqual(l.inner.y + l.inner.h - 1 - EPS);
      expect(l.clip).toEqual(l.inner);
    }, 'fill');
  });

  test('overflow is symmetric within 1 px', () => {
    each((l) => {
      const left = l.inner.x - l.x, right = l.x + l.artW - (l.inner.x + l.inner.w);
      const top = l.inner.y - l.y, bottom = l.y + l.artH - (l.inner.y + l.inner.h);
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1 + EPS);
      expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1 + EPS);
    }, 'fill');
  });

  test('landscape 1080p: a square art is 1920 wide and cropped top and bottom', () => {
    const l = layoutArt(shape(125, ASPECT.braille), { width: 1920, height: 1080, marginPct: 0, placement: 'fill' });
    expect(l.artW).toBeCloseTo(1920, 6);
    expect(l.x).toBe(0);
    expect(l.y).toBeLessThan(-400);
  });
});

describe('cells', () => {
  test('cell aspect is preserved in both placements', () => {
    for (const placement of ['fit', 'fill'] as const) {
      each((l, _o, g) => {
        expect(l.cellW / l.cellH).toBeCloseTo(g.cellAspect, 9);
        expect(l.artW).toBeCloseTo(g.cols * l.cellW, 6);
        expect(l.artH).toBeCloseTo(g.rows * l.cellH, 6);
      }, placement);
    }
  });

  test('the layout scales with the canvas (the preview is the export, smaller)', () => {
    const g = shape(125, ASPECT.braille);
    const big = layoutArt(g, { width: 1920, height: 1080, marginPct: 5, placement: 'fit' });
    const small = layoutArt(g, { width: 960, height: 540, marginPct: 5, placement: 'fit' });
    expect(small.cellH * 2).toBeCloseTo(big.cellH, 1);
    expect(Math.abs(small.x * 2 - big.x)).toBeLessThanOrEqual(2);
  });
});

describe('auto columns', () => {
  const o = (width: number, height: number, placement: Placement = 'fit', marginPct = 0) =>
    ({ width, height, marginPct, placement });

  test('1080p reproduces the hand-made reference (~125 Braille columns)', () => {
    expect(autoColumns(ASPECT.braille, o(1920, 1080))).toBe(125);
    expect(autoColumns(ASPECT.ascii, o(1920, 1080))).toBe(156);
    expect(autoColumns(ASPECT.blocks, o(1920, 1080))).toBe(144);
  });

  test('cells come out about 15 px tall in fit', () => {
    for (const [w, h] of SIZES.filter(([w, h]) => Math.min(w, h) >= 600)) {
      for (const a of Object.values(ASPECT)) {
        const cols = autoColumns(a, o(w, h));
        if (cols === COLS_MAX) continue;
        const l = layoutArt(shape(cols, a), o(w, h));
        expect(l.cellH).toBeGreaterThan(13.5);
        expect(l.cellH).toBeLessThan(16.5);
      }
    }
  });

  test('portrait uses the width, fill the long side, margins shrink it', () => {
    expect(autoColumns(ASPECT.braille, o(1080, 1920))).toBe(125);
    expect(autoColumns(ASPECT.braille, o(1920, 1080, 'fill'))).toBe(COLS_MAX);
    expect(autoColumns(ASPECT.blocks, o(1280, 720, 'fill'))).toBe(171);
    expect(autoColumns(ASPECT.braille, o(1920, 1080, 'fit', 10))).toBeLessThan(125);
  });

  test('clamped to the column range', () => {
    expect(autoColumns(ASPECT.braille, o(7, 5))).toBe(COLS_MIN);
    expect(autoColumns(ASPECT.ascii, o(7680, 4320))).toBe(COLS_MAX);
  });
});

describe('auto columns, crop to the screen aspect', () => {
  const o = (width: number, height: number, placement: Placement = 'fit', marginPct = 0) =>
    ({ width, height, marginPct, placement });
  const screen = (x: LayoutIn) => { const r = innerRect(x); return r.w / r.h; };
  // rows for a crop aspect (engine.rowsFor)
  const rowsAt = (cols: number, cell: number, a: number) => Math.max(1, Math.round((cols * cell) / a));

  test('aspect 1 is the square formula', () => {
    for (const [w, h] of SIZES) {
      for (const m of MARGINS) {
        for (const p of ['fit', 'fill'] as const) {
          for (const a of Object.values(ASPECT)) {
            expect(autoColumns(a, o(w, h, p, m), 1)).toBe(autoColumns(a, o(w, h, p, m)));
          }
        }
      }
    }
  });

  test('the art fills the inner rectangle with cells about 15 px tall', () => {
    for (const [w, h] of SIZES.filter(([w, h]) => Math.min(w, h) >= 600)) {
      for (const m of MARGINS) {
        for (const a of Object.values(ASPECT)) {
          const x = o(w, h, 'fit', m), s = screen(x);
          const cols = autoColumns(a, x, s);
          const rows = rowsAt(cols, a, s);
          const l = layoutArt({ cols, rows, cellAspect: a }, x);
          // one side touches the inner rectangle; the art's aspect is the screen's up to the
          // rounding of the rows (half a row)
          expect(Math.min(l.inner.w - l.artW, l.inner.h - l.artH)).toBeLessThanOrEqual(EPS);
          expect(Math.abs(l.artW / l.artH - s)).toBeLessThanOrEqual((s * 0.5) / rows + EPS);
          if (cols === COLS_MAX) continue;
          expect(l.cellH).toBeGreaterThan(13.5);
          expect(l.cellH).toBeLessThan(16.5);
        }
      }
    }
  });

  test('fill equals fit when the aspect is the screen\'s', () => {
    for (const [w, h] of SIZES) {
      for (const a of Object.values(ASPECT)) {
        const s = screen(o(w, h));
        expect(autoColumns(a, o(w, h, 'fill'), s)).toBe(autoColumns(a, o(w, h, 'fit'), s));
      }
    }
  });

  test('a wide crop needs more columns; 16:9 at 1080p hits the cap', () => {
    expect(autoColumns(ASPECT.braille, o(1920, 1080), 16 / 9)).toBe(COLS_MAX);
    expect(autoColumns(ASPECT.braille, o(1280, 720), 16 / 9)).toBe(148);
    // a portrait screen: the width limits the art
    expect(autoColumns(ASPECT.braille, o(1080, 1920), 9 / 16)).toBe(125);
    expect(autoColumns(ASPECT.braille, o(7, 5), 1.4)).toBe(COLS_MIN);
  });
});
