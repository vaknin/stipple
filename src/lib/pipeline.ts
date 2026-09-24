// Photo -> Grid -> preview. Input only calls schedule(); one render runs per animation frame
// (app.js does the same). A change that does not touch the conversion (colours, margin, output
// size with manual columns) only redraws. The full-size render happens on Save / Set only.

import type { ConvertOpts, Grid } from '$typist/convert.js';
import { autoCrop, decodeImage, ImageError, imageErrorMessage } from '$typist/imageio.js';
import { LOOKS, type LookId } from '$typist/tone.js';
import { cellAspect, Engine, rowsFor, THUMB_COLS, type ConvertRequest } from './engine/engine';
import { layoutArt, type Layout } from './layout';
import { perf } from './perf.svelte';
import { surfaceCache } from './rasterize';
import { drawPhotoCrop, renderWallpaper } from './render';
import { app, squareCrop, type Wall } from './state.svelte';
import { errorText, readFile } from './tauri';

export const engine = new Engine();
const previewSurface = surfaceCache();
const thumbSurface = surfaceCache();

/**
 * Geist Mono before anything draws letters: raster.js caches each font's metrics per cell size
 * for good, so a draw before the font is in would bake a fallback face's metrics in.
 */
export const fontsReady: Promise<unknown> = document.fonts
  .load('16px "Geist Mono"', 'M@#')
  .catch(() => []);

let preview: HTMLCanvasElement | null = null;
let raf = 0;
let lastKey = '';
let lastFrame = 0;
let thumbsDirty = false;

/** The preview canvas (its backing size is set by Preview.svelte before each draw). */
export function setPreviewCanvas(c: HTMLCanvasElement | null) {
  preview = c;
  if (c) schedule();
}

export function schedule() {
  if (!raf) raf = requestAnimationFrame(frame);
}

/** After a commit (or a new photo): rebuild the look thumbnails once the preview is drawn. */
export function requestThumbs() {
  thumbsDirty = true;
  schedule();
}

function frame(t: number) {
  raf = 0;
  if (lastFrame) perf.add('frame', t - lastFrame);
  lastFrame = t;
  void render();
}

/** The converter request for the current document. */
export function currentRequest(): ConvertRequest {
  const d = app.doc;
  const opts: ConvertOpts = {
    mode: d.mode, cols: app.cols, rows: app.rows, dither: d.dither, ascii: d.ascii, blocks: d.blocks,
    color: app.colourBlocks, tone: { ...d.tone, look: d.look },
  };
  return { crop: { ...app.crop }, opts };
}

let converting = false;

async function render() {
  if (!app.loaded) return;
  const req = currentRequest();
  const key = JSON.stringify(req);
  if (key !== lastKey || !app.grid) {
    thumbs.cancel();   // the preview goes first; thumbnails wait for the next commit
    converting = true;
    const res = await engine.convert(req);
    converting = false;
    if (res) {
      lastKey = key;
      app.grid = res.grid;
      app.runMs = res.ms;
      perf.add('run', res.ms);
      drawPreview();
      // the settings moved on while this converted: go again (a queued newer request is already
      // running in the worker, so this only catches the end of a drag)
      if (JSON.stringify(currentRequest()) !== key) schedule();
    }
  } else {
    drawPreview();
  }
  if (thumbsDirty && !converting && key === lastKey) {
    thumbsDirty = false;
    thumbs.queue();
  }
}

/** The grid for the current settings (converts when the preview is behind). */
export async function currentGrid() {
  const req = currentRequest();
  const key = JSON.stringify(req);
  if (key === lastKey && app.grid) return app.grid;
  for (;;) {
    const res = await engine.convert(req);
    if (res) return res.grid;
  }
}

/** Where `g` goes on a width x height canvas with the given (default: current) wall options. */
export function layoutFor(g: Grid, width: number, height: number, wall: Pick<Wall, 'marginPct' | 'placement' | 'box'> = app.wall): Layout {
  return layoutArt(
    { cols: g.cols, rows: g.rows, cellAspect: cellAspect(g.mode) },
    { width, height, marginPct: wall.marginPct, placement: wall.placement, box: wall.box },
  );
}

export function drawPreview() {
  const c = preview, g = app.grid, loaded = app.loaded;
  if (!c || !g || !loaded || !c.width || !c.height) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const layout = layoutFor(g, c.width, c.height);
  const t0 = performance.now();
  if (app.peeking) drawPhotoCrop(ctx, loaded.photo.canvas, app.crop, layout, app.colours.paper, c.width, c.height, app.colours.surround);
  else renderWallpaper(ctx, g, layout, app.colours, previewSurface(c.width, c.height));
  perf.add('draw', performance.now() - t0);
}

// ---------------------------------------------------------------------------------- thumbnails
// The five looks drawn from the user's photo at <= THUMB_COLS columns, in idle time, after commits
// only; any main render cancels the batch (it is rebuilt at the next commit).

// WebKitGTK has no requestIdleCallback: fall back to a timer, as app.js does
const hasIdle = typeof window.requestIdleCallback === 'function';
const idle = (fn: () => void): number =>
  hasIdle ? window.requestIdleCallback(fn, { timeout: 400 }) : window.setTimeout(fn, 16);
const cancelIdle = (id: number) => (hasIdle ? window.cancelIdleCallback(id) : window.clearTimeout(id));

export const thumbs = {
  canvases: new Map<LookId, HTMLCanvasElement>(),
  token: 0,
  job: 0,
  key: '',

  cancel() {
    this.token++;
    cancelIdle(this.job);
    engine.cancelThumbs();
    this.key = '';
  },

  queue() {
    if (!app.loaded) return;
    const base = currentRequest();
    const cols = Math.min(base.opts.cols, THUMB_COLS);
    const opts = { ...base.opts, cols, rows: rowsFor(cols, base.opts.mode, app.cropAspect), color: false };
    const colours = app.colours;
    const key = JSON.stringify([app.loaded.path, base.crop, opts, colours]);
    if (key === this.key) return;
    this.cancel();
    this.key = key;
    const token = this.token;
    const looks = LOOKS.map(l => l.id);
    const step = (i: number) => {
      this.job = idle(async () => {
        if (token !== this.token || i >= looks.length) return;
        const look = looks[i]!;
        const res = await engine.convert({ crop: base.crop, opts: { ...opts, tone: { ...opts.tone, look } } }, 'thumb');
        if (!res || token !== this.token) return;
        const cv = this.canvases.get(look);
        if (cv) drawThumb(cv, res.grid, colours);
        step(i + 1);
      });
    };
    step(0);
  },
};

function drawThumb(cv: HTMLCanvasElement, g: Grid, colours: { ink: string; paper: string }) {
  const css = cv.clientWidth || 56;
  const S = Math.round(css * Math.min(3, window.devicePixelRatio || 1));
  if (cv.width !== S) { cv.width = S; cv.height = S; }
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  // the art fitted in the square with an 8% margin, as Typist's look thumbnails
  const layout = layoutArt({ cols: g.cols, rows: g.rows, cellAspect: cellAspect(g.mode) },
    { width: S, height: S, marginPct: 8, placement: 'fit' });
  renderWallpaper(ctx, g, layout, colours, thumbSurface(S, S));
}

// -------------------------------------------------------------------------------------- intake

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
export const IMAGE_EXTS = Object.keys(MIME);

export const baseName = (p: string) => p.split('/').pop() ?? p;

let loadSeq = 0;

/** Open a photo by path (file dialog or drop): decode, frame it (autoCrop), convert. */
export async function openPath(path: string) {
  const name = baseName(path);
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (!MIME[ext]) {
    app.say('error', `${name} is not a PNG, JPEG or WebP image.`);
    return;
  }
  const seq = ++loadSeq;
  app.loading = true;
  try {
    await fontsReady;
    const bytes = await readFile(path);
    const photo = await decodeImage(new Blob([bytes], { type: MIME[ext] }), name);
    if (seq !== loadSeq) return;
    if (app.cropping) app.cropping = false;
    await engine.setSource(photo.canvas);
    thumbs.cancel();
    lastKey = '';
    app.grid = null;
    app.loaded = { photo, path, name: photo.name };
    app.doc.crop = squareCrop(autoCrop(photo, app.cropAspect));
    app.resetHistory();
    app.notice = photo.small ? { kind: 'info', text: 'This photo is small, so fine details may get lost.' } : null;
    app.commits++;
    schedule();
  } catch (e) {
    app.say('error', e instanceof ImageError ? imageErrorMessage(e) : errorText(e));
  } finally {
    if (seq === loadSeq) app.loading = false;
  }
}
