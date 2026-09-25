/// <reference types="bun" />
// The Stipple theme's palette module (shell-plugin/kivan.stipple/palette.mjs): the sun, the
// colours of the hour, and parity with Omarchy's own template renderer.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanTheme, colorsToml, contrast, DAY_MODES, defaultTheme, deltaE, flipAt, lightInk, needsNight, paletteFor, renderTemplate,
  sun, sunTimes, SURFACES, themeAt, type DayMode, type Palette, type Surface, type ThemeOpts,
} from '$palette';

// sunTimes works on the local day: pin it so the expectations below are in UTC everywhere
process.env.TZ = 'UTC';

const HAIFA = { lat: 32.79, lon: 34.99 };
const DAY = Date.UTC(2026, 8, 23);
const at = (min: number) => new Date(DAY + min * 60000);
const haifaSun = (d: Date) => sun(d, HAIFA.lat, HAIFA.lon);

const WALLS = [
  { ink: '#ff48b0', paper: '#1b1d2e', surround: '#1b1d2e' },
  { ink: '#17171a', paper: '#ffffff', surround: '#ffffff' },
  { ink: '#f2f2f0', paper: '#111113', surround: '#111113' },
];

const opts = (patch: Partial<ThemeOpts>): ThemeOpts => ({ ...defaultTheme(), ...patch });

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const hex = (r: () => number) => '#' + Array.from({ length: 3 }, () => Math.floor(r() * 256).toString(16).padStart(2, '0')).join('');
const minutes = (d: Date | null) => (d ? (d.getTime() - DAY) / 60000 : NaN);

describe('sun', () => {
  test('Haifa at the equinox: noon height, midnight, sunrise and sunset', () => {
    let noon = -90;
    for (let m = 0; m < 1440; m++) noon = Math.max(noon, haifaSun(at(m)).elevation);
    expect(Math.abs(noon - (90 - HAIFA.lat))).toBeLessThan(1.5);
    // local midnight (UTC+3) is 21:00 UTC the day before
    expect(haifaSun(at(-180)).elevation).toBeLessThan(-40);
    expect(haifaSun(at(6 * 60)).rising).toBe(true);
    expect(haifaSun(at(12 * 60)).rising).toBe(false);
    const { sunrise, sunset } = sunTimes(at(12 * 60), HAIFA.lat, HAIFA.lon);
    expect(Math.abs(minutes(sunrise) - (3 * 60 + 30))).toBeLessThan(10);
    expect(Math.abs(minutes(sunset) - (15 * 60 + 35))).toBeLessThan(10);
  });

  test('polar day and night have no sunrise or sunset', () => {
    const summer = sunTimes(new Date(Date.UTC(2026, 5, 21, 12)), 80, 15);
    expect(summer.sunrise).toBeNull();
    expect(summer.sunset).toBeNull();
  });
});

const KEYS = ['background', 'foreground', 'accent'] as const;

describe('colours of the hour', () => {
  const modes: { name: string; o: ThemeOpts }[] = [
    ...DAY_MODES.map(day => ({ name: day, o: opts({ day }) })),
    { name: 'sky, full strength', o: opts({ day: 'sky', strength: 1 }) },
    { name: 'custom, own night colours', o: opts({ day: 'custom', nightInk: '#5ec8e5', nightPaper: '#0b0d1a' }) },
  ];
  // The only jump allowed is the light / dark switch-over (Custom between a light day and a dark
  // night): no text colour reads on a mid grey, so it happens in one step, once per crossing.
  for (const { name, o } of modes) {
    test(`${name} is continuous over the day`, () => {
      const jumps: string[] = [];
      for (const w of WALLS) {
        let prev: Palette | null = null;
        let switches = 0;
        for (let m = -180; m <= 1260; m++) {
          const p = themeAt(w, o, haifaSun(at(m))).palette;
          if (prev && prev.mode !== p.mode) switches++;
          else for (const k of KEYS) {
            const d = prev ? deltaE(prev[k]!, p[k]!) : 0;
            if (d >= 0.03) jumps.push(`${w.ink} on ${w.paper} ${k} at ${m} min UTC: ${prev![k]} -> ${p[k]} (${d.toFixed(3)})`);
          }
          prev = p;
        }
        if (switches > 2) jumps.push(`${w.ink} on ${w.paper}: ${switches} light / dark switches in a day`);
        if (o.day !== 'custom' && switches > 0) jumps.push(`${w.ink} on ${w.paper}: ${o.day} switched light / dark`);
      }
      expect(jumps).toEqual([]);
    });
  }

  test('text and accent stay readable', () => {
    const r = rng(7);
    const walls = [...WALLS, ...Array.from({ length: 12 }, () => ({ ink: hex(r), paper: hex(r), surround: '' }))];
    const bad: string[] = [];
    for (const w of walls) {
      for (const day of DAY_MODES as DayMode[]) {
        for (const surface of SURFACES as Surface[]) {
          for (let h = 0; h < 24; h += 1.5) {
            const p = themeAt(w, opts({ day, surface }), haifaSun(at(h * 60 - 180))).palette;
            const fg = contrast(p.foreground!, p.background!), ac = contrast(p.accent!, p.background!);
            if (fg < 7 || ac < 3) bad.push(`${w.ink} on ${w.paper} ${day}/${surface} ${h}h: text ${fg.toFixed(2)}, accent ${ac.toFixed(2)}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test('the wallpaper keeps its own colours when it does not follow the sun', () => {
    const night = haifaSun(at(-180));
    const own = themeAt(WALLS[0]!, opts({ wallpaper: false }), night);
    expect(own.wall).toEqual({ ink: '#ff48b0', paper: '#1b1d2e', surround: '#1b1d2e', flip: 0 });
    // the palette still does
    expect(own.palette.background).not.toBe(themeAt(WALLS[0]!, opts({ day: 'off' }), night).palette.background);
  });
});

describe('which way the art goes', () => {
  const noon = { elevation: 60, rising: false }, midnight = { elevation: -50, rising: false };

  test('light ink on darker paper is drawn the other way round', () => {
    expect(lightInk('#f2f2f0', '#111113')).toBe(true);
    expect(lightInk('#17171a', '#ffffff')).toBe(false);
    expect(lightInk('#ff48b0', '#1b1d2e')).toBe(true);
  });

  test('Custom with the day colours swapped turns the art over at night', () => {
    for (const w of WALLS) {
      const t = opts({ day: 'custom', strength: 1 });
      expect(themeAt(w, t, noon).wall.flip).toBe(0);
      expect(themeAt(w, t, midnight).wall.flip).toBe(1);
      expect(needsNight(w, t)).toBe(true);
      // the switch is where ink and paper meet: little contrast either side of it
      for (let el = -20; el <= 10; el += 0.25) {
        const h = themeAt(w, t, { elevation: el, rising: false }).wall;
        if (h.flip > 0 && h.flip < 1) expect(contrast(h.ink, h.paper)).toBeLessThan(1.35);
      }
    }
  });

  test('Custom that never crosses keeps the day grid', () => {
    for (const w of WALLS) {
      const t = opts({ day: 'custom', strength: 0.4 });
      for (let el = -60; el <= 60; el += 2) expect(themeAt(w, t, { elevation: el, rising: false }).wall.flip).toBe(0);
      expect(needsNight(w, t)).toBe(false);
    }
  });

  test('Sky, Light and Warm never turn the art over', () => {
    const r = rng(7);
    const walls: { ink: string; paper: string }[] = [...WALLS];
    while (walls.length < 80) {
      const w = { ink: hex(r), paper: hex(r) };
      if (contrast(w.ink, w.paper) >= 1.5) walls.push(w);
    }
    const bad: string[] = [];
    for (const w of walls) {
      for (const day of ['sky', 'light', 'warm'] as DayMode[]) {
        if (needsNight(w, opts({ day, strength: 1 }))) bad.push(`${w.ink} on ${w.paper} ${day}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('a wallpaper that does not follow the sun never turns over', () => {
    const t = opts({ day: 'custom', strength: 1, wallpaper: false });
    expect(themeAt(WALLS[0]!, t, midnight).wall.flip).toBe(0);
    expect(needsNight(WALLS[0]!, t)).toBe(false);
    expect(needsNight(WALLS[0]!, opts({ day: 'off' }))).toBe(false);
  });

  test('flipAt is 0 for the day itself and for colours with no lightness between them', () => {
    expect(flipAt({ ink: '#f2f2f0', paper: '#111113' }, { ink: '#f2f2f0', paper: '#111113' })).toBe(0);
    expect(flipAt({ ink: '#808080', paper: '#808080' }, { ink: '#000000', paper: '#ffffff' })).toBe(0);
  });
});

describe('cleanTheme', () => {
  test('tolerates garbage', () => {
    const d = defaultTheme();
    for (const raw of [undefined, null, 42, 'sky', [], [1, 2], true, {}]) expect(cleanTheme(raw)).toEqual(d);
    expect(cleanTheme({ day: 'nope', strength: 'abc', nightInk: '#12', nightPaper: 'red', surface: 5, wallpaper: 'yes', apply: 1 }))
      .toEqual(d);
    expect(cleanTheme({ strength: 5 }).strength).toBe(1);
    expect(cleanTheme({ strength: -1 }).strength).toBe(0);
    expect(cleanTheme({ strength: Infinity }).strength).toBe(d.strength);
    expect(cleanTheme({ day: 'custom', nightInk: '#ABCDEF', surface: 'tinted', wallpaper: false, apply: false }))
      .toEqual({ ...d, day: 'custom', nightInk: '#abcdef', surface: 'tinted', wallpaper: false, apply: false });
  });
});

// omarchy-theme-set-templates renders every template into $HOME/.local/state/omarchy/current/next-theme
// from the colors.toml there, and writes nothing outside $HOME
const OMARCHY = process.env.OMARCHY_PATH || '/usr/share/omarchy';
const TPL = join(OMARCHY, 'default/themed/shell.toml.tpl');
const SET_TEMPLATES = join(OMARCHY, 'bin/omarchy-theme-set-templates');
const haveOmarchy = existsSync(TPL) && existsSync(SET_TEMPLATES);

describe('templates', () => {
  test.skipIf(!haveOmarchy)('renderTemplate matches omarchy-theme-set-templates for shell.toml', () => {
    const tpl = readFileSync(TPL, 'utf8');
    const cases = [
      paletteFor(WALLS[0]!, opts({})),
      paletteFor(WALLS[1]!, opts({ surface: 'deep' })),
      themeAt(WALLS[2]!, opts({ surface: 'tinted' }), haifaSun(at(15 * 60 + 40))).palette,
    ];
    for (const p of cases) {
      const home = mkdtempSync(join(tmpdir(), 'stipple-theme-'));
      try {
        const next = join(home, '.local/state/omarchy/current/next-theme');
        mkdirSync(next, { recursive: true });
        writeFileSync(join(next, 'colors.toml'), colorsToml(p));
        const run = spawnSync(SET_TEMPLATES, [], {
          env: { ...process.env, HOME: home, OMARCHY_PATH: OMARCHY, PATH: `${join(OMARCHY, 'bin')}:${process.env.PATH ?? ''}` },
          encoding: 'utf8',
        });
        expect(run.status).toBe(0);
        expect(renderTemplate(tpl, p)).toBe(readFileSync(join(next, 'shell.toml'), 'utf8'));
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    }
  });
});
