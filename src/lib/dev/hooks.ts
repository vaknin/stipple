// Dev only (loaded behind import.meta.env.DEV): `window.TW` for scripts driven through the dev
// bridge (dev/tw.sh), e.g. `TW.open('/path/cat.png')`, `TW.app.doc.tone.brightness = 0.2`.

import { gridLines } from '$typist/convert.js';
import { save, setAsWallpaper } from '../actions';
import { layoutFor, currentGrid, drawPreview, engine, openPath, schedule, thumbs } from '../pipeline';
import { perf } from '../perf.svelte';
import { rasterize, Surface } from '../rasterize';
import { renderPng } from '../render';
import { app } from '../state.svelte';
import { devLog, devSave, startBridge } from './bridge';

const frame = () => new Promise<number>(r => requestAnimationFrame(r));

/** Wait until the preview shows the current settings (no render pending). */
async function settle(frames = 3) {
  for (let i = 0; i < frames; i++) await frame();
}

/** The preview canvas as a PNG file in .dev-out (or $TW_DEV_OUT). */
async function shotPreview(name = 'preview.png') {
  const c = document.querySelector<HTMLCanvasElement>('canvas.preview-canvas');
  if (!c) throw new Error('no preview canvas');
  const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  return devSave(name, blob);
}

/** The full-size wallpaper as it would be saved, into .dev-out. */
async function shotFull(name = 'full.png') {
  const grid = await currentGrid();
  const { width, height } = app.wall;
  const png = await renderPng(grid, layoutFor(grid, width, height), app.colours, width, height);
  return devSave(name, png);
}

/**
 * Simulate a Brightness drag: one slider step per animation frame (the window must be visible,
 * WebKit pauses frames otherwise). Returns p50 / p95 of run, draw and frame interval.
 */
async function bench(mode: 'braille' | 'ascii' | 'blocks', cols: number, steps = 60, opts: { color?: boolean } = {}) {
  app.doc.mode = mode;
  app.doc.cols = cols;
  app.doc.color = !!opts.color;
  app.doc.tone.brightness = 0;
  await settle(4);
  // warm-up: the first conversion at a size builds samples and JIT tiers
  for (let i = 0; i < 5; i++) { app.doc.tone.brightness = -0.3 + i * 0.01; await frame(); }
  await settle(3);
  perf.reset();
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    app.doc.tone.brightness = -0.5 + (i / steps);
    await frame();
  }
  await settle(3);
  const wall = performance.now() - t0;
  const out = { mode, cols, rows: app.rows, steps, fps: +(steps / (wall / 1000)).toFixed(1),
    run: perf.stats('run'), draw: perf.stats('draw'), frame: perf.stats('frame') };
  app.doc.tone.brightness = 0;
  return out;
}

export function install() {
  const TW = {
    app, engine, perf, thumbs, openPath, schedule, drawPreview, settle, save, setAsWallpaper,
    shotPreview, shotFull, devSave, devLog, gridLines, bench, currentGrid, layoutFor, rasterize, Surface,
    lines: () => (app.grid ? gridLines(app.grid) : []),
  };
  (window as unknown as { TW: typeof TW }).TW = TW;
  startBridge();
}
