// Converter tests (node, plain assert): node tests/convert.test.mjs
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
// Stipple patch: Letters only; upstream's Braille, dither and blocks tests went with those modes.
import { createConverter } from '../js/convert.js';
import { sampleFromRGBA, decodeSource, toneGrid, TONE_DEFAULTS, LOOKS } from '../js/tone.js';
// Timing budgets are for this machine; shared CI runners (CI=true) are slower, so they get slack
// there: the tests still catch a real slowdown without failing on a busy runner.
const PERF = process.env.CI ? 4 : 1;

let pass = 0, fail = 0;
const results = [];
function test(name, fn) {
  try { fn(); pass++; results.push('ok   ' + name); } catch (e) { fail++; results.push('FAIL ' + name + '\n     ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n     ')); }
}

// Synthetic portrait (ImageData-like): grey backdrop, dark hair, skin oval, eyes, mouth.
function portrait(w = 1200, h = 1600) {
  const data = new Uint8ClampedArray(w * h * 4);
  const ell = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = 0, p = 0; y < h; y++) {
    for (let x = 0; x < w; x++, p += 4) {
      const u = x / w, v = y / h;
      let c = [150, 160, 175];
      if (ell(u, v, 0.5, 0.4, 0.3, 0.27)) c = [40, 30, 25];
      if (ell(u, v, 0.5, 0.43, 0.21, 0.21)) c = [222, 180, 150];
      if (ell(u, v, 0.42, 0.4, 0.035, 0.018) || ell(u, v, 0.58, 0.4, 0.035, 0.018)) c = [30, 20, 20];
      if (ell(u, v, 0.5, 0.55, 0.06, 0.015)) c = [160, 60, 60];
      if (ell(u, v, 0.5, 1.0, 0.4, 0.15)) c = [40, 45, 60];
      data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function halves(w = 400, h = 400) {   // left half black, right half white
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p += 4) {
    const c = x < w / 2 ? 0 : 255;
    data[p] = data[p + 1] = data[p + 2] = c; data[p + 3] = 255;
  }
  return { width: w, height: h, data };
}

const CROP = { x: 0.5, y: 0.45, zoom: 1.2, rotation: 0 };
const PHOTO = portrait();

/** Letters (non-blank cells) in the left or right half of a grid. */
function inkCells(g, left) {
  let n = 0;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    if ((c < g.cols / 2) !== left) continue;
    if (g.cp[r * g.cols + c] !== 0x20) n++;
  }
  return n;
}

test('deterministic: two fresh converters give identical grids', () => {
  for (const ascii of ['shape', 'ramp']) {
    const a = createConverter(); a.setSource(PHOTO);
    const b = createConverter(); b.setSource(PHOTO);
    const opts = { mode: 'ascii', ascii, cols: 40, rows: 22, tone: { edges: 0.5 } };
    assert.deepEqual([...a.run(CROP, opts).cp], [...b.run(CROP, opts).cp]);
  }
});

test('only Letters: another mode is an error', () => {
  const conv = createConverter();
  conv.setSource(PHOTO);
  assert.equal(conv.run(CROP, {}).mode, 'ascii');
  assert.throws(() => conv.run(CROP, { mode: 'braille' }), /unknown mode/);
});

test('invert puts the letters on the light half', () => {
  const conv = createConverter();
  conv.setSource(halves());
  const opts = { mode: 'ascii', cols: 20, rows: 11, tone: { auto: false, detail: 0 } };
  const g0 = conv.run({}, opts);
  const g1 = conv.run({}, { ...opts, tone: { auto: false, detail: 0, invert: true } });
  assert.ok(inkCells(g0, true) > 5 * inkCells(g0, false), 'normal: letters on the dark (left) half');
  assert.ok(inkCells(g1, false) > 5 * inkCells(g1, true), 'inverted: letters on the light (right) half');
});

test('transparent pixels stay paper when inverted (logo background, past the photo edge)', () => {
  const w = 100, h = 100;
  const data = new Uint8ClampedArray(w * h * 4);   // transparent, with an opaque white square in the middle
  for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) data.set([255, 255, 255, 255], (y * w + x) * 4);
  const conv = createConverter();
  conv.setSource({ width: w, height: h, data });
  const g = conv.run({}, { mode: 'ascii', cols: 20, rows: 10, tone: { invert: true, auto: false, detail: 0 } });
  const inked = i => g.cp[i] !== 0x20;
  assert.ok(!inked(0) && !inked(19) && !inked(199), 'transparent corners stay blank');
  assert.ok(inked(5 * 20 + 10), 'the opaque white square becomes letters');
  // not inverted, white on transparent is paper on paper: nothing at all
  const plain = conv.run({ zoom: 0.5 }, { mode: 'ascii', cols: 20, rows: 10 });
  assert.ok(plain.cp.every(c => c === 0x20));
});

test('memoisation: a tone change never resamples, a matcher change never re-tones', () => {
  const conv = createConverter();
  conv.setSource(PHOTO);
  const o = { mode: 'ascii', cols: 40, rows: 22 };
  conv.run(CROP, o);
  assert.deepEqual({ ...conv.stats }, { samples: 1, tones: 1, encodes: 1 });
  conv.run(CROP, { ...o, tone: { contrast: 0.3 } });
  assert.equal(conv.stats.samples, 1, 'tone change resampled');
  assert.equal(conv.stats.tones, 2);
  conv.run(CROP, { ...o, tone: { contrast: 0.3 }, ascii: 'ramp' });
  assert.equal(conv.stats.tones, 2, 'matcher change re-toned');
  conv.run({ ...CROP }, o);   // back to the first tone: cached
  assert.equal(conv.stats.samples, 1);
  assert.equal(conv.stats.tones, 2);
  conv.run({ ...CROP, x: 0.51 }, o);
  assert.equal(conv.stats.samples, 2, 'crop change must resample');
  conv.setSource(PHOTO);
  conv.run(CROP, o);
  assert.equal(conv.stats.samples, 3, 'setSource clears the caches');
});

test('sampler: transparent pixels are white paper, rotation turns the image', () => {
  const w = 64, h = 64;
  const data = new Uint8ClampedArray(w * h * 4);   // all transparent black
  const s = sampleFromRGBA(data, w, h, 8, 8, { crop: {} });
  for (const v of s.L) assert.ok(v > 0.999);
  const hv = halves(64, 64);
  const s0 = sampleFromRGBA(hv.data, 64, 64, 8, 8, { crop: {} });
  assert.ok(s0.L[0] < 0.05 && s0.L[7] > 0.95, 'left dark, right light');
  const s90 = sampleFromRGBA(hv.data, 64, 64, 8, 8, { crop: { rotation: 90 } });
  // rotated 90 deg clockwise: the dark left half ends up on top
  assert.ok(s90.L[0] < 0.05 && s90.L[7] < 0.05 && s90.L[63] > 0.95, 'dark half on top after 90 deg');
  const sc = sampleFromRGBA(PHOTO.data, PHOTO.width, PHOTO.height, 30, 40, { crop: CROP, color: true });
  assert.equal(sc.rgb.length, 30 * 40 * 3);
});

test('decode once: long side capped at 1024 by exact area averaging; samples are area means', () => {
  // 2048 x 1024 fine checkerboard of 0 / 255 -> every decoded pixel averages one 2 x 2 block
  const w = 2048, h = 1024, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p += 4) {
    data[p] = data[p + 1] = data[p + 2] = (x + y) & 1 ? 255 : 0; data[p + 3] = 255;
  }
  const dec = decodeSource({ width: w, height: h, data });
  assert.deepEqual([dec.width, dec.height], [1024, 512]);
  assert.ok(dec.opaque);
  for (let i = 0; i < dec.data.length; i += 4 * 997) assert.ok(Math.abs(dec.data[i] - 127.5) <= 0.5 && dec.data[i + 3] === 255, 'pixel ' + dec.data[i]);
  // whole-image sample of a two-level image = its exact mean; a 1 x 1 sample of the halves is 0.5
  const hv = halves(64, 64);
  const one = sampleFromRGBA(hv.data, 64, 64, 1, 1);
  assert.ok(Math.abs(one.L[0] - 0.5) < 1e-3, 'mean ' + one.L[0]);
  // enlarging (8 source px -> 64 samples) interpolates linearly across the black / white edge
  const up = sampleFromRGBA(halves(8, 8).data, 8, 8, 64, 1, { crop: { zoom: 1 } });
  let steps = 0;
  for (let x = 1; x < 64; x++) { assert.ok(up.L[x] >= up.L[x - 1] - 1e-6, 'monotone'); if (up.L[x] > up.L[x - 1] + 1e-6) steps++; }
  assert.ok(steps >= 6, 'smooth ramp, not a hard step: ' + steps);
});

test('tone: auto hits the ink target, brightness works with auto, gamma > 1 lightens (every look)', () => {
  const img = sampleFromRGBA(PHOTO.data, PHOTO.width, PHOTO.height, 80, 88, { crop: CROP });
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  // soft solves the midtones for the target exactly; the others place regions first and only trim
  const soft = toneGrid(img, { look: 'soft' }, { target: 0.4 });
  assert.ok(Math.abs(soft.stats.coverage - 0.4) < 0.08, 'soft coverage ' + soft.stats.coverage);
  for (const { id } of LOOKS) {
    const base = toneGrid(img, { look: id }, { target: 0.4 });
    assert.ok(base.stats.coverage > 0.15 && base.stats.coverage < 0.7, id + ' coverage ' + base.stats.coverage);
    const bright = toneGrid(img, { look: id, brightness: 0.6 }, { target: 0.4 });
    assert.ok(mean(bright) > mean(base) + 0.02, id + ': brightness lightens under auto');
    const g = toneGrid(img, { look: id, gamma: 2 }, { target: 0.4 });
    assert.ok(mean(g) > mean(base) + 0.01, id + ': gamma 2 lightens');
  }
  const inv = toneGrid(img, { ...TONE_DEFAULTS, look: 'soft', invert: true }, { target: 0.4 });
  // a mostly light photo cannot reach 0.4 ink inverted without crushing it: the solve is bounded
  assert.ok(inv.stats.coverage > 0.3 && inv.stats.coverage < 0.62, 'inverted coverage ' + inv.stats.coverage);
});

test('looks: TONE_DEFAULTS.look is photo; LOOKS lists 5 { id, name }; unknown look falls back', () => {
  assert.equal(TONE_DEFAULTS.look, 'photo');
  assert.deepEqual(LOOKS.map(l => l.id), ['photo', 'texture', 'sketch', 'soft', 'poster']);
  for (const l of LOOKS) assert.ok(typeof l.name === 'string' && l.name.length > 0);
  const img = sampleFromRGBA(PHOTO.data, PHOTO.width, PHOTO.height, 56, 60, { crop: CROP });
  assert.deepEqual([...toneGrid(img, { look: 'nope' })], [...toneGrid(img, { look: 'photo' })]);
  assert.equal(toneGrid(img, { look: 'nope' }).stats.look, 'photo');
});

test('looks: every look deterministic, finite, in [0, 1], with .edge and .stats (both themes, 3 sizes)', () => {
  for (const [W, H] of [[2, 4], [56, 60], [120, 88]]) {
    const img = sampleFromRGBA(PHOTO.data, PHOTO.width, PHOTO.height, W, H, { crop: CROP });
    for (const { id } of LOOKS) for (const invert of [false, true]) {
      const tone = { look: id, invert, edges: 0.3 };
      const a = toneGrid(img, tone, { target: 0.4, boost: 0.5 }), b = toneGrid(img, tone, { target: 0.4, boost: 0.5 });
      assert.deepEqual([...a], [...b], id + ' ' + W + 'x' + H + ' not deterministic');
      for (let i = 0; i < a.length; i++) assert.ok(a[i] >= 0 && a[i] <= 1, id + ' ' + W + 'x' + H + ' L[' + i + '] = ' + a[i]);
      assert.ok(a.edge && a.edge.mag.length === W * H, id + ' edge');
      for (const k of ['lo', 'hi', 'gamma', 'coverage', 'std']) assert.ok(Number.isFinite(a.stats[k]), id + ' stats.' + k);
    }
  }
});

test('looks: invert puts the letters on the light half in every look (auto on)', () => {
  const conv = createConverter();
  conv.setSource(halves());
  for (const { id } of LOOKS) {
    const g0 = conv.run({}, { mode: 'ascii', cols: 20, rows: 11, tone: { look: id } });
    const g1 = conv.run({}, { mode: 'ascii', cols: 20, rows: 11, tone: { look: id, invert: true } });
    assert.ok(inkCells(g0, true) > 5 * inkCells(g0, false), id + ': normal: letters on the dark (left) half');
    assert.ok(inkCells(g1, false) > 5 * inkCells(g1, true), id + ': inverted: letters on the light (right) half');
  }
});

test('looks: brightness moves the ink in both themes, every look (+ = lighter photo)', () => {
  const conv = createConverter();
  conv.setSource(PHOTO);
  const o = { mode: 'ascii', cols: 40, rows: 22 };
  for (const { id } of LOOKS) for (const invert of [false, true]) {
    const [dk, mid, lt] = [-0.6, 0, 0.6].map(b => conv.run(CROP, { ...o, tone: { look: id, invert, brightness: b } }).ink);
    // light theme: lighter photo = less ink; dark theme: lighter photo = more lit letters
    const ok = invert ? lt >= mid && mid >= dk && lt - dk > 0.05 : lt <= mid && mid <= dk && dk - lt > 0.05;
    assert.ok(ok, id + (invert ? ' dark' : ' light') + ': ink at -0.6 / 0 / +0.6 = ' + [dk, mid, lt].map(v => v.toFixed(3)).join(' / '));
  }
});

test('looks: the tone cache is keyed on the look', () => {
  const conv = createConverter();
  conv.setSource(PHOTO);
  const o = { mode: 'ascii', cols: 30, rows: 16 };
  const a = conv.run(CROP, { ...o, tone: { look: 'photo' } });
  const n = conv.stats.tones;
  const b = conv.run(CROP, { ...o, tone: { look: 'poster' } });
  assert.equal(conv.stats.tones, n + 1, 'a look change re-tones');
  assert.notDeepEqual([...a.cp], [...b.cp], 'photo and poster differ');
  assert.deepEqual([...conv.run(CROP, { ...o, tone: { look: 'photo' } }).cp], [...a.cp], 'back to photo from the cache');
  const s = conv.stats.samples;
  conv.run(CROP, { ...o, tone: { look: 'sketch' } });
  assert.equal(conv.stats.samples, s, 'a look change never resamples');
});

const lookMs = {};
test('looks: every look under 5 ms for a 120 x 88 grid (node, median)', () => {
  const img = sampleFromRGBA(PHOTO.data, PHOTO.width, PHOTO.height, 120, 88, { crop: CROP });
  for (const { id } of LOOKS) {
    const xs = [];
    for (let k = 0; k < 15; k++) {
      const t0 = performance.now();
      toneGrid(img, { look: id, brightness: (k % 5) / 10 }, { target: 0.4, boost: 0 });
      if (k >= 3) xs.push(performance.now() - t0);
    }
    xs.sort((a, b) => a - b);
    lookMs[id] = xs[xs.length >> 1];
  }
  const slow = Object.entries(lookMs).filter(([, v]) => v >= 5 * PERF);
  assert.deepEqual(slow, []);
});

const timing = {};
test('timing: 60 x 28 Letters from a fresh crop < 30 ms, tone change < 20 ms (the glyph match reruns)', () => {
  const conv = createConverter();
  conv.setSource(PHOTO);
  const o = { mode: 'ascii', cols: 60, rows: 28 };
  conv.run({ ...CROP, x: 0.3 }, o);   // warm up the JIT
  conv.run({ ...CROP, x: 0.3 }, { ...o, tone: { contrast: 0.9 } });
  const fresh = [], toneT = [];
  for (let k = 0; k < 9; k++) {
    const crop = { ...CROP, x: 0.45 + k * 0.01 };
    let t0 = performance.now(); conv.run(crop, o); fresh.push(performance.now() - t0);
    t0 = performance.now(); conv.run(crop, { ...o, tone: { contrast: 0.1 * k + 0.05 } }); toneT.push(performance.now() - t0);
  }
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  timing.fresh = med(fresh); timing.tone = med(toneT);
  timing.freshMax = Math.max(...fresh); timing.toneMax = Math.max(...toneT);
  assert.ok(timing.fresh < 30 * PERF, 'fresh ' + timing.fresh);
  assert.ok(timing.tone < 20 * PERF, 'tone ' + timing.tone);
});

test('ASCII wiring (when ascii.js is present)', () => {
  const conv = createConverter();
  conv.setSource(PHOTO);
  if (!conv.asciiReady) { results.push('     (ascii.js not loaded: skipped)'); return; }
  for (const method of ['shape', 'ramp']) {
    let g;
    try { g = conv.run(CROP, { mode: 'ascii', cols: 40, rows: 18, ascii: method }); } catch (e) {
      if (/shape-vectors/.test(e.message)) { results.push('     (ascii ' + method + ': ' + e.message + ' - skipped)'); continue; }
      throw e;
    }
    assert.equal(g.cp.length, 40 * 18);
    for (const cp of g.cp) assert.ok(cp >= 0x20 && cp <= 0x7E && cp !== 0x60, `U+${cp.toString(16)}`);
  }
});

console.log(results.join('\n'));
console.log('timing (node, median ms):', JSON.stringify(Object.fromEntries(Object.entries(timing).map(([k, v]) => [k, +v.toFixed(2)]))));
console.log('looks 120 x 88 (node, median ms):', JSON.stringify(Object.fromEntries(Object.entries(lookMs).map(([k, v]) => [k, +v.toFixed(2)]))));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
