/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import type { Grid } from '$typist/convert.js';
import type { Layout } from './layout';
import { atlasLevels, levelGeometry, packFrames } from './letterframes';

const grid = (cols: number, rows: number, text: string): Grid => ({
  mode: 'ascii', cols, rows, cp: Uint32Array.from({ length: cols * rows }, (_, i) => text.codePointAt(i % text.length)!),
  fg: null, bg: null, ink: 0,
} as unknown as Grid);

const lay = (cellW: number): Layout =>
  ({ cellW, cellH: cellW * 2, x: 1, y: 2, artW: 0, artH: 0, inner: { x: 0, y: 0, w: 0, h: 0 }, clip: null });

describe('letter frames', () => {
  test('cells become glyph indices, keyframes pack in shelves', () => {
    const gs = [grid(3, 2, 'a b'), grid(5, 1, '@a  '), grid(2, 2, 'zz')];
    const p = packFrames(gs, gs.map((_, i) => lay(i + 1)), 7);
    expect(p.glyphs).toEqual(['a', 'b', '@', 'z'].map(c => c.codePointAt(0)!));
    expect(p.frames.map(f => [f.ax, f.ay])).toEqual([[0, 0], [0, 2], [5, 2]]);
    expect([p.width, p.height]).toEqual([7, 4]);
    expect(p.frames[1]).toMatchObject({ cols: 5, rows: 1, x: 1, y: 2, cellW: 2, cellH: 4 });
    const at = (x: number, y: number) => p.rgb[(y * p.width + x) * 3];
    // "a b" / "a b": a = 1, blank = 0, b = 2
    expect([at(0, 0), at(1, 0), at(2, 0), at(0, 1)]).toEqual([1, 0, 2, 1]);
    expect([at(0, 2), at(1, 2), at(2, 2), at(3, 2)]).toEqual([3, 1, 0, 0]);
    expect([at(5, 2), at(6, 3)]).toEqual([4, 4]);
  });

  test('more than 255 letters is refused', () => {
    const many = String.fromCodePoint(...Array.from({ length: 300 }, (_, i) => 0x4e00 + i));
    expect(() => packFrames([grid(300, 1, many)], [lay(1)])).toThrow();
  });

  test('atlas levels cover the cell heights, capped', () => {
    expect(atlasLevels([5, 30])).toEqual([4, 8, 16, 32]);
    expect(atlasLevels([16, 16])).toEqual([16]);
    expect(atlasLevels([1, 900])).toEqual([4, 8, 16, 32, 64, 128, 256]);
    const g = levelGeometry(100, 0.46);
    expect(g.tileW).toBeGreaterThanOrEqual(2 * g.cellW);
    expect(g.tileH).toBeGreaterThanOrEqual(1.7 * g.cellH);
  });
});
