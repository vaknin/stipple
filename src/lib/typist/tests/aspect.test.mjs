// Typist Wall: the crop's `aspect` (tone.js cropSize, crop.js, imageio.js autoCrop). A square crop
// (aspect missing or 1) must stay exactly upstream's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConverter } from '../js/convert.js';
import { cleanCrop, fitCropFor } from '../js/crop.js';
import { autoCrop } from '../js/imageio.js';
import { cropAspect, cropSide, cropSize, sampleFromRGBA } from '../js/tone.js';

function noise(w, h, seed = 1) {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  for (let p = 0; p < data.length; p += 4) {
    s = (s * 1103515245 + 12345) >>> 0;
    const x = (p / 4) % w, y = Math.floor(p / 4 / w);
    const v = ((s >>> 16) & 63) + (x * 150) / w + (y * 40) / h;
    data[p] = v; data[p + 1] = (v * 3) % 256; data[p + 2] = 255 - v; data[p + 3] = 255;
  }
  return { width: w, height: h, data };
}

// black left of `split` (a share of the width), white right of it
function split(w, h, at) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p += 4) {
    const c = x < at * w ? 0 : 255;
    data[p] = data[p + 1] = data[p + 2] = c; data[p + 3] = 255;
  }
  return { width: w, height: h, data };
}

test('cropAspect: 1 unless a positive finite number', () => {
  for (const c of [null, {}, { aspect: 0 }, { aspect: -2 }, { aspect: NaN }, { aspect: Infinity }, { aspect: 'x' }, { aspect: 1 }]) {
    assert.equal(cropAspect(c), 1);
  }
  assert.equal(cropAspect({ aspect: 16 / 9 }), 16 / 9);
});

test('cropSize: square is cropSide, a rectangle is the largest of its aspect at zoom 1', () => {
  for (const [w, h] of [[1200, 800], [800, 1200], [500, 500]]) {
    for (const zoom of [0.5, 1, 2.5]) {
      const s = cropSide(w, h, { zoom });
      assert.deepEqual(cropSize(w, h, { zoom }), [s, s]);
      assert.deepEqual(cropSize(w, h, { zoom, aspect: 1 }), [s, s]);
    }
  }
  assert.deepEqual(cropSize(1600, 1000, { zoom: 1, aspect: 16 / 9 }), [1600, 900]);
  assert.deepEqual(cropSize(1200, 1000, { zoom: 1, aspect: 1 / 2 }), [500, 1000]);
  const [cw, ch] = cropSize(1600, 1000, { zoom: 2, aspect: 16 / 9 });
  assert.ok(Math.abs(cw - 800) < 1e-9 && Math.abs(ch - 450) < 1e-9);
});

test('a converter run with aspect 1 is the one without', () => {
  const src = noise(640, 480);
  const crop = { x: 0.45, y: 0.55, zoom: 1.3, rotation: 17 };
  for (const mode of ['braille', 'blocks', 'ascii']) {
    const a = createConverter(); a.setSource(src);
    const b = createConverter(); b.setSource(src);
    const opts = { mode, cols: 40, rows: 23 };
    assert.deepEqual([...a.run(crop, opts).cp], [...b.run({ ...crop, aspect: 1 }, opts).cp], mode);
  }
});

test('a wide crop samples the whole width of a wide photo', () => {
  // 16:10 photo, the dark part is its left quarter; a 16:10 crop at zoom 1 sees all of it
  const src = split(800, 500, 0.25);
  const W = 80, H = 50;
  const s = sampleFromRGBA(src.data, src.width, src.height, W, H, { crop: { x: 0.5, y: 0.5, zoom: 1, rotation: 0, aspect: 1.6 } });
  const at = (x, y) => s.L[y * W + x];
  for (const y of [0, 25, 49]) {
    assert.ok(at(0, y) < 0.05 && at(18, y) < 0.05, 'dark left quarter');
    assert.ok(at(21, y) > 0.95 && at(79, y) > 0.95, 'white after it');
  }
  // the square crop of the same photo spans 150..650 px: its dark part is a tenth of it
  const q = sampleFromRGBA(src.data, src.width, src.height, 60, 60, { crop: { x: 0.5, y: 0.5, zoom: 1, rotation: 0 } });
  assert.ok(q.L[30 * 60 + 4] < 0.05 && q.L[30 * 60 + 7] > 0.95);
});

test('a new aspect is a new sample (the cache key has it)', () => {
  const conv = createConverter();
  conv.setSource(noise(320, 200));
  const crop = { x: 0.5, y: 0.5, zoom: 1, rotation: 0 };
  conv.run(crop, { mode: 'braille', cols: 20, rows: 10 });
  const n = conv.stats.samples;
  conv.run({ ...crop, aspect: 1.6 }, { mode: 'braille', cols: 20, rows: 10 });
  assert.equal(conv.stats.samples, n + 1);
});

test('cleanCrop keeps a non-square aspect and drops aspect 1', () => {
  assert.equal(cleanCrop({ x: 0.5, y: 0.5, zoom: 1, rotation: 0, aspect: 1.5 }).aspect, 1.5);
  assert.ok(!('aspect' in cleanCrop({ x: 0.5, y: 0.5, zoom: 1, rotation: 0, aspect: 1 })));
  assert.ok(!('aspect' in cleanCrop({ x: 0.5, y: 0.5, zoom: 1, rotation: 0 })));
});

test('fitCropFor: square unchanged; a rectangle stays on the photo when turned', () => {
  for (const r of [0, 30, 90, -135]) {
    const sq = fitCropFor({ rotation: r });
    assert.deepEqual(fitCropFor({ rotation: r }, 1600, 900), sq);
  }
  assert.equal(fitCropFor({ rotation: 0, aspect: 16 / 9 }, 1600, 900).zoom, 1);
  // 16:9 turned 90 on a 16:9 photo: its long side (now vertical) must fit the photo's height
  const z = fitCropFor({ rotation: 90, aspect: 16 / 9 }, 1600, 900).zoom;
  const [cw] = cropSize(1600, 900, { zoom: z, aspect: 16 / 9 });
  assert.ok(Math.abs(cw - 900) < 1e-3, `turned width ${cw}`);
});

test('autoCrop: aspect 1 is upstream; a rectangle frames a cut-out and biases portraits', () => {
  const box = { x0: 0.3, y0: 0.2, x1: 0.5, y1: 0.8 };
  for (const img of [{ width: 1000, height: 800, alphaBox: null }, { width: 800, height: 1400, alphaBox: null },
    { width: 1000, height: 800, alphaBox: box }]) {
    assert.deepEqual(autoCrop(img, 1), autoCrop(img));
  }
  // the box (200 x 480 px) fits in the 16:9 crop with its 12% margin, height-limited
  const c = autoCrop({ width: 1000, height: 800, alphaBox: box }, 16 / 9);
  const [, ch] = cropSize(1000, 800, { ...c, aspect: 16 / 9 });
  assert.ok(Math.abs(ch - 480 * 1.12) < 1e-6);
  // a 16:9 crop on a tall portrait: its top edge is the photo's top, not above it
  const p = autoCrop({ width: 800, height: 1400, alphaBox: null }, 16 / 9);
  const [, ph] = cropSize(800, 1400, { ...p, aspect: 16 / 9 });
  assert.ok(p.y * 1400 - ph / 2 >= -1e-9);
});
