// Reading documents and wallpaper options back from sidecars and sessions of any age.
import { describe, expect, test } from 'bun:test';
import { lightInk } from '$palette';
import { DEFAULT_COLOURS, defaultDoc, docFrom, wallFrom } from './doc';

describe('older files keep their look without Invert', () => {
  test('Invert off and no picks: Typist’s dark ink on white', () => {
    const w = wallFrom({ ink: null, paper: null }, { tone: { invert: false } });
    expect([w.ink, w.paper]).toEqual(['#17171a', '#ffffff']);
    expect(lightInk(w.ink!, w.paper!)).toBe(false);
  });

  test('Invert on (or no doc) and no picks: the default colours', () => {
    const on = wallFrom({}, { tone: { invert: true } });
    expect([on.ink, on.paper]).toEqual([DEFAULT_COLOURS.ink, DEFAULT_COLOURS.paper]);
    expect(lightInk(on.ink!, on.paper!)).toBe(true);
    const none = wallFrom({});
    expect([none.ink, none.paper]).toEqual([null, null]);
  });

  test('picked colours are kept; one missing is filled from the old rule', () => {
    expect(wallFrom({ ink: '#FF48B0', paper: '#1b1d2e' }, { tone: { invert: false } })).toMatchObject({ ink: '#ff48b0', paper: '#1b1d2e' });
    expect(wallFrom({ ink: '#ff48b0', paper: null }, { tone: { invert: false } })).toMatchObject({ ink: '#ff48b0', paper: '#ffffff' });
    expect(wallFrom({ ink: null, paper: '#223344' }, { tone: { invert: true } })).toMatchObject({ ink: '#f2f2f0', paper: '#223344' });
  });

  test('a positive picture keeps its direction: the colours now say what Invert did', () => {
    const cases = [
      { invert: true, ink: '#f2f2f0', paper: '#111113' },
      { invert: false, ink: '#17171a', paper: '#ffffff' },
      { invert: true, ink: '#ff48b0', paper: '#1b1d2e' },
      { invert: false, ink: '#1b1d2e', paper: '#f4e9d8' },
      { invert: true, ink: null, paper: null },
      { invert: false, ink: null, paper: null },
    ];
    for (const c of cases) {
      const w = wallFrom({ ink: c.ink, paper: c.paper }, { tone: { invert: c.invert } });
      expect(lightInk(w.ink!, w.paper!)).toBe(c.invert);
    }
  });

  test('the doc drops an old invert', () => {
    const d = docFrom({ mode: 'braille', tone: { invert: true, auto: false, brightness: 0.2 } });
    expect(d.tone).toEqual({ ...defaultDoc().tone, auto: false, brightness: 0.2 });
    expect('invert' in d.tone).toBe(false);
  });
});
