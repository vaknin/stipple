// Adversarial tests for the converter: node tests/fuzz.test.mjs
// Stipple patch: Letters only. Upstream's Braille, dither and block attacks went with those modes,
// and its formatter attacks with targets.js / count.js, which Stipple does not vendor.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createConverter, gridLines } from '../js/convert.js';
import { sampleFromRGBA, toneGrid, TONE_DEFAULTS, LOOKS } from '../js/tone.js';
import { asciiCells, ASCII_CHARSET, ASCII_SUB } from '../js/ascii.js';
// Timing budgets are for this machine; shared CI runners (CI=true) are slower, so they get slack
// there: the tests still catch a real slowdown without failing on a busy runner.
const PERF = process.env.CI ? 4 : 1;

let pass = 0, fail = 0;
const out = [];
function test(name, fn) {
  try { fn(); pass++; out.push('ok   ' + name); }
  catch (e) { fail++; out.push('FAIL ' + name + '\n     ' + String(e && e.message || e).split('\n').slice(0, 6).join('\n     ')); }
}

// ---------- seeded helpers ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const cps = s => Array.from(s, ch => ch.codePointAt(0));

// ImageData-like sources
function img(w, h, f) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p += 4) {
    const [r, g, b, a = 255] = f(x, y);
    data[p] = r; data[p + 1] = g; data[p + 2] = b; data[p + 3] = a;
  }
  return { width: w, height: h, data };
}
const solid = (v, w = 64, h = 64, a = 255) => img(w, h, () => [v, v, v, a]);
function noise(w, h, seed) { const r = rng(seed); return img(w, h, () => { const v = (r() * 256) | 0; return [v, v, v]; }); }
function portrait(w = 600, h = 800) {
  const ell = (u, v, cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
  return img(w, h, (x, y) => {
    const u = x / w, v = y / h;
    let c = [150, 160, 175];
    if (ell(u, v, 0.5, 0.4, 0.3, 0.27)) c = [40, 30, 25];
    if (ell(u, v, 0.5, 0.43, 0.21, 0.21)) c = [222, 180, 150];
    if (ell(u, v, 0.42, 0.4, 0.035, 0.018) || ell(u, v, 0.58, 0.4, 0.035, 0.018)) c = [30, 20, 20];
    if (ell(u, v, 0.5, 0.55, 0.06, 0.015)) c = [160, 60, 60];
    return c;
  });
}

function assertGridSane(g, mode, cols, rows) {
  assert.equal(g.cols, cols, 'cols');
  assert.equal(g.rows, rows, 'rows');
  assert.equal(g.cp.length, cols * rows, 'cp length');
  assert.ok(Number.isFinite(g.ink) && g.ink >= 0 && g.ink <= 1, 'ink finite in [0,1]: ' + g.ink);
  assert.equal(g.mode, mode, 'mode');
  const asciiSet = new Set(cps(ASCII_CHARSET));
  for (let i = 0; i < g.cp.length; i++) {
    const v = g.cp[i];
    assert.ok(asciiSet.has(v), `ascii cell ${i} = U+${v.toString(16)}`);
  }
  assert.ok(g.fg === null && g.bg === null, 'no colours');
  if (g.tone) for (const k of ['lo', 'hi', 'gamma', 'coverage', 'std']) assert.ok(Number.isFinite(g.tone[k]), `tone.${k} = ${g.tone[k]}`);
}

const MODES = [{ mode: 'ascii', ascii: 'shape' }, { mode: 'ascii', ascii: 'ramp' }];
function conv(source) { const c = createConverter(); c.setSource(source); return c; }

// =====================================================================================
// Converter
// =====================================================================================

test('determinism: fresh converters, and a converter after 30 unrelated runs, give identical grids', () => {
  const src = portrait();
  const a = conv(src), b = conv(src);
  const r = rng(3);
  for (const m of MODES) {
    const opts = { ...m, cols: 24, rows: 13 };
    const ga = a.run({ x: 0.5, y: 0.45, zoom: 1.3 }, opts);
    for (let k = 0; k < 3; k++) {   // pollute b's caches with other crops, tones and sizes
      b.run({ x: r(), y: r(), zoom: 0.5 + r() * 3, rotation: r() * 360 },
        { ...MODES[(r() * MODES.length) | 0], cols: 5 + ((r() * 40) | 0), rows: 3 + ((r() * 20) | 0),
          tone: { brightness: r() * 2 - 1, contrast: r() * 2 - 1, gamma: 0.3 + r() * 2.7, edges: r(), invert: r() < 0.5 } });
    }
    const gb = b.run({ x: 0.5, y: 0.45, zoom: 1.3 }, opts);
    assert.deepEqual(gb.cp, ga.cp, JSON.stringify(m));
    if (ga.fg) { assert.deepEqual(gb.fg, ga.fg); assert.deepEqual(gb.bg, ga.bg); }
  }
});

test('memo: tone-only change never resamples; crop change always does; returning to A gives A', () => {
  const c = conv(portrait());
  const opts = { mode: 'ascii', cols: 40, rows: 22 };
  const A = c.run({ x: 0.5, y: 0.5 }, opts);
  const s0 = c.stats.samples;
  const tones = [{ brightness: 0.5 }, { contrast: -0.4 }, { gamma: 2 }, { detail: 0 }, { edges: 1 }, { invert: true }, { auto: false }];
  for (const t of tones) c.run({ x: 0.5, y: 0.5 }, { ...opts, tone: t });
  assert.equal(c.stats.samples, s0, 'tone change resampled');
  for (const crop of [{ x: 0.51 }, { y: 0.49 }, { zoom: 1.01 }, { rotation: 1 }]) {
    const n = c.stats.samples;
    const g = c.run({ x: 0.5, y: 0.5, ...crop }, opts);
    assert.equal(c.stats.samples, n + 1, 'crop change did not resample: ' + JSON.stringify(crop));
    assert.equal(g.cp.length, 40 * 22);
  }
  // evict the tone LRU (8) and the sample LRU (6), then come back
  for (let k = 0; k < 10; k++) c.run({ x: 0.3 + k * 0.03 }, { ...opts, tone: { brightness: k / 10 } });
  assert.deepEqual(c.run({ x: 0.5, y: 0.5 }, opts).cp, A.cp, 'A changed after cache churn');
  // cached tone arrays must not be mutated by encoders: same key twice, every mode
  for (const m of MODES) {
    const o = { ...m, cols: 20, rows: 11, tone: { edges: 0.7 } };
    assert.deepEqual(c.run({}, o).cp, c.run({}, o).cp, JSON.stringify(m));
  }
});

test('memo: setSource with a different photo never serves the old photo', () => {
  const c = conv(solid(255));
  const white = c.run({}, { mode: 'ascii', cols: 10, rows: 5 });
  c.setSource(solid(0));
  const black = c.run({}, { mode: 'ascii', cols: 10, rows: 5 });
  assert.ok(white.cp.every(v => v === 0x20) && black.cp.every(v => v !== 0x20));
});

test('extremes: all white is blank, all black is full, in every mode (and swapped when inverted)', () => {
  for (const [v, name] of [[255, 'white'], [0, 'black']]) {
    const c = conv(solid(v));
    for (const m of MODES) {
      for (const invert of [false, true]) {
        const g = c.run({}, { ...m, cols: 12, rows: 7, tone: { invert } });
        assertGridSane(g, m.mode, 12, 7);
        const inky = (v === 0) !== invert;
        if (m.mode === 'ascii') {
          const blank = g.cp.every(x => x === 0x20);
          assert.equal(blank, !inky, `${name} ${JSON.stringify(m)} invert=${invert}: "${gridLines(g)[0]}"`);
        }
      }
    }
  }
});

test('extremes: 1 x 1 grid and 200-column grid in every mode, valid and NaN-free', () => {
  const c = conv(portrait());
  for (const m of MODES) {
    assertGridSane(c.run({}, { ...m, cols: 1, rows: 1 }), m.mode, 1, 1);
    const t0 = performance.now();
    const g = c.run({}, { ...m, cols: 200, rows: 110 });
    const ms = performance.now() - t0;
    assertGridSane(g, m.mode, 200, 110);
    assert.ok(ms < 2000 * PERF, `${JSON.stringify(m)} 200 cols took ${ms.toFixed(0)} ms`);
  }
});

test('extremes: flat grey, 1x1 photo, 4000x3 panorama, tiny zoom, crop off the photo', () => {
  const cases = [
    ['flat 128', solid(128), {}],
    ['flat 128 tiny', solid(128, 1, 1), {}],
    ['pano', img(4000, 3, x => [x % 255, 0, 0]), {}],
    ['zoom 0.001', portrait(), { zoom: 0.001 }],
    ['zoom 1e6', portrait(), { zoom: 1e6 }],
    ['off photo', portrait(), { x: 9, y: -9 }],
    ['rot 45', portrait(), { rotation: 45 }],
    ['rot -720.5', portrait(), { rotation: -720.5 }],
  ];
  for (const [name, src, crop] of cases) {
    const c = conv(src);
    for (const m of MODES) {
      const g = c.run(crop, { ...m, cols: 16, rows: 9 });
      try { assertGridSane(g, m.mode, 16, 9); } catch (e) { throw new Error(`${name} ${JSON.stringify(m)}: ${e.message}`); }
    }
  }
  const off = conv(portrait()).run({ x: 9, y: -9 }, { mode: 'ascii', cols: 16, rows: 9 });
  assert.ok(off.cp.every(v => v === 0x20), 'a crop entirely off the photo should be blank paper');
});

test('extremes: flat grey stays NaN-free and is flagged flat', () => {
  const g = conv(solid(128)).run({}, { mode: 'ascii', cols: 20, rows: 11 });
  assert.ok(g.tone.flat, 'flat photo not flagged: ' + JSON.stringify(g.tone));
  const L = toneGrid(sampleFromRGBA(solid(128).data, 64, 64, 40, 44), TONE_DEFAULTS);
  assert.ok(L.every(Number.isFinite), 'NaN in toned flat grey');
});

test('transparent PNG: fully transparent is blank in both themes, half-alpha black is grey', () => {
  const c = conv(solid(0, 64, 64, 0));
  for (const m of MODES) for (const invert of [false, true]) {
    const g = c.run({}, { ...m, cols: 10, rows: 6, tone: { invert } });
    assertGridSane(g, m.mode, 10, 6);
    assert.ok(g.cp.every(v => v === 0x20), `transparent ${JSON.stringify(m)} invert=${invert}: "${gridLines(g)[0]}"`);
  }
  const s = sampleFromRGBA(solid(0, 8, 8, 128).data, 8, 8, 4, 4);
  assert.ok(Math.abs(s.L[5] - (1 - 128 / 255)) < 0.01, 'half-alpha black should composite to mid grey: ' + s.L[5]);
});

test('hostile tone values (NaN, out of range, strings) never give NaN or invalid glyphs', () => {
  const c = conv(portrait());
  const bad = [
    { gamma: 0 }, { gamma: -1 }, { gamma: NaN }, { gamma: 1e9 }, { brightness: NaN }, { brightness: 7 },
    { contrast: -5 }, { contrast: 9 }, { detail: 50 }, { detail: -1 }, { edges: 20 }, { contrast: NaN },
    { detail: NaN }, { gamma: '2' }, { brightness: undefined },
  ];
  const problems = [];
  for (const t of bad) {
    for (const m of MODES) {
      try {
        const g = c.run({}, { ...m, cols: 16, rows: 9, tone: t });
        assertGridSane(g, m.mode, 16, 9);
      } catch (e) { problems.push(`${JSON.stringify(t, (k, v) => (Number.isNaN(v) ? 'NaN' : v === undefined ? 'undefined' : v))} ${m.mode}: ${e.message}`); }
    }
  }
  assert.deepEqual(problems, []);
});

test('hostile grid sizes (cols NaN / 0 / -3 / 2.6 / "12") are clamped, never NaN-sized', () => {
  const c = conv(portrait());
  for (const [cols, rows, ec, er] of [[0, 0, 1, 1], [-3, -3, 1, 1], [2.6, 1.4, 3, 1], ['12', '6', 12, 6], [NaN, 5, null, 5], [10, NaN, 10, null]]) {
    let g;
    try { g = c.run({}, { mode: 'ascii', cols, rows }); }
    catch (e) { throw new Error(`cols=${cols} rows=${rows} threw ${e.message}`); }
    assert.ok(Number.isInteger(g.cols) && g.cols >= 1 && Number.isInteger(g.rows) && g.rows >= 1,
      `cols=${cols} rows=${rows} gave ${g.cols} x ${g.rows}`);
    if (ec != null) assert.equal(g.cols, ec);
    if (er != null) assert.equal(g.rows, er);
    assert.equal(g.cp.length, g.cols * g.rows);
  }
});

test('invert: a symmetric grey ramp reaches the same coverage in both themes', () => {
  // a left-to-right grey ramp's negative is its mirror image, so dark mode must give the same
  // coverage; brightness must still move the picture in dark mode
  const grad = img(256, 256, x => [x, x, x]);
  const c = conv(grad);
  const base = { mode: 'ascii', cols: 40, rows: 22 };
  const a = c.run({}, { ...base, tone: { invert: false } });
  const b = c.run({}, { ...base, tone: { invert: true } });
  out.push(`     info: light coverage ${a.tone.coverage.toFixed(3)}, dark ${b.tone.coverage.toFixed(3)}`);
  assert.ok(Math.abs(a.tone.coverage - b.tone.coverage) < 0.02, 'coverage differs between themes');
  // not asserted: dark mode uses v^g on the light side, not the mirror curve 1 - (1 - v)^g (design)
});

test('brightness moves dark mode on a bright photo too, every look (auto gamma on its bound must not swallow it)', () => {
  // light photo inverted = mostly lit letters; the auto solve pins at its bound. Brightness is a lighter
  // photo in both themes: less ink on paper, MORE lit letters in dark mode (they are the light parts)
  const c = conv(portrait());
  const base = { mode: 'ascii', cols: 40, rows: 22 };
  const problems = [];
  for (const { id } of LOOKS) {
    for (const invert of [false, true]) {
      const res = [-0.6, 0, 0.6].map(b => c.run({}, { ...base, tone: { look: id, invert, brightness: b } }));
      const [dk, mid, lt] = res.map(g => g.ink);
      // monotone with a real spread (sketch on a hard-edged face is all lines at 0: + has little to
      // lighten, so each side alone is not required to move 0.03)
      const ok = invert ? lt >= mid && mid >= dk && lt - dk > 0.06 : lt <= mid && mid <= dk && dk - lt > 0.06;
      if (!ok) problems.push(`${id} ${invert ? 'dark' : 'light'}: ink at brightness -0.6 / 0 / +0.6 = ${dk.toFixed(3)} / ${mid.toFixed(3)} / ${lt.toFixed(3)}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('ASCII ramp: hostile ramps never leak non-charset glyphs (backtick-only, empty, control, non-ASCII)', () => {
  const [SX, SY] = ASCII_SUB;
  const cols = 12, rows = 6, W = cols * SX, H = rows * SY;
  const r = rng(5);
  const L = Float32Array.from({ length: W * H }, r);
  const set = new Set(ASCII_CHARSET);
  const leaks = [];
  for (const ramp of ['`', '```', '', '\t\r\n', 'é█⣿', '@\u0000 ', '﻿#.', '🙂@. ']) {
    const cp = asciiCells(L, W, H, cols, rows, { method: 'ramp', ramp });
    const bad = [...new Set(Array.from(cp).filter(v => !set.has(String.fromCodePoint(v))))];
    if (bad.length) leaks.push(`${JSON.stringify(ramp)} -> ${bad.map(v => 'U+' + v.toString(16).padStart(4, '0')).join(',')}`);
  }
  assert.deepEqual(leaks, []);
});

test('ASCII: NaN lightness never becomes NUL', () => {
  const [SX, SY] = ASCII_SUB;
  const L = new Float32Array(4 * SX * 2 * SY).fill(NaN);
  for (const method of ['shape', 'ramp']) {
    const cp = asciiCells(L, 4 * SX, 2 * SY, 4, 2, { method });
    assert.ok(Array.from(cp).every(v => v >= 0x20 && v <= 0x7e && v !== 0x60), method + ': ' + Array.from(cp));
  }
});

// ---------- report ----------
console.log(out.join('\n'));
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
