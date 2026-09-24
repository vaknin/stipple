// Photo -> Grid -> preview. Input only calls schedule(); one render runs per animation frame
// (app.js does the same). A change that does not touch the conversion (colours, margin, output
// size with manual columns) only redraws. The full-size render happens on Save / Set only.

import type { ConvertOpts, Grid } from '$typist/convert.js';
import { autoCrop, decodeImage, ImageError, imageErrorMessage, type Photo } from '$typist/imageio.js';
import { LOOKS, type LookId } from '$typist/tone.js';
import { cellAspect, Engine, rowsFor, THUMB_COLS, type ConvertRequest } from './engine/engine';
import { layoutArt, type Layout } from './layout';
import { cleanMotion, coloursAt, dotMotion, frameGrid, motionFps, packField, type Motion } from './motion';
import { perf } from './perf.svelte';
import { surfaceCache } from './rasterize';
import { drawPhotoCrop, renderWallpaper, type Colours } from './render';
import { app, docFrom, squareCrop, wallFrom, type Wall } from './state.svelte';
import { errorText, readFile, readSidecar } from './tauri';

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
    // Dots carry their dot field: the animated preview and the saved field.png come from it
    field: d.mode === 'braille',
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
  const colours = previewColours();
  if (app.peeking) drawPhotoCrop(ctx, loaded.photo.canvas, app.crop, layout, colours.paper, c.width, c.height, colours.surround);
  else renderWallpaper(ctx, previewGrid(g), layout, colours, previewSurface(c.width, c.height));
  perf.add('draw', performance.now() - t0);
}

// -------------------------------------------------------------------------------------- motion
// The preview plays the wallpaper's motion with motion.ts, the shader's JS mirror: each frame's
// dots are encoded to a Braille grid and drawn by the same rasteriser as the still.

/** The motion as it will be saved: effects this style cannot play are off. */
export const previewMotion = (): Motion => app.playMotion;

let packedFor: Grid | null = null;
let packed: Uint8Array | null = null;
let scratch: Uint8Array | null = null;
let motionTimer = 0;
let epoch = performance.now();

function previewGrid(g: Grid): Grid {
  const m = previewMotion();
  const f = g.field;
  if (!app.playing || !f || !dotMotion(m)) return g;
  if (packedFor !== g) { packed = packField(f); packedFor = g; }
  if (!scratch || scratch.length !== f.width * f.height) scratch = new Uint8Array(f.width * f.height);
  return frameGrid(packed!, f.width, f.height, m, (performance.now() - epoch) / 1000, scratch);
}

function previewColours(): Colours {
  const m = previewMotion();
  if (!m.day.on) return app.colours;
  const now = new Date();
  return coloursAt(m, app.colours, app.previewMinute ?? now.getHours() * 60 + now.getMinutes());
}

/**
 * Start, retime or stop the preview's motion frames (after any motion or play change). With only
 * Colour over the day on, a redraw every 30 s follows the clock.
 */
export function syncMotion(restart = false) {
  const m = previewMotion();
  const fps = app.playing && app.loaded ? motionFps(m) : 0;
  if (restart) epoch = performance.now();
  clearInterval(motionTimer);
  motionTimer = fps > 0 ? window.setInterval(schedule, 1000 / fps) : m.day.on && app.loaded ? window.setInterval(schedule, 30000) : 0;
  schedule();
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
    const opts = { ...base.opts, cols, rows: rowsFor(cols, base.opts.mode, app.cropAspect), color: false, field: false };
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

// a CR3 arrives as the camera's JPEG from inside it (src-tauri/src/raw.rs)
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', cr3: 'image/jpeg' };
export const IMAGE_EXTS = Object.keys(MIME);

export const baseName = (p: string) => p.split('/').pop() ?? p;

let loadSeq = 0;

async function decodePath(path: string) {
  const name = baseName(path);
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const bytes = await readFile(path);
  return decodeImage(new Blob([bytes], { type: MIME[ext] }), name);
}

/** Make `photo` the engine's source and the app's loaded photo (settings are set by the caller). */
async function adopt(photo: Photo, path: string, name: string) {
  if (app.cropping) app.cropping = false;
  await engine.setSource(photo.canvas);
  thumbs.cancel();
  lastKey = '';
  app.grid = null;
  app.loaded = { photo, path, name };
}

/**
 * Open a photo by path (file dialog or drop): decode, frame it (autoCrop), convert. A Stipple
 * wallpaper (a PNG with a sidecar) reopens instead: its photo with every setting and the motion,
 * and Save then updates that file when only the motion changed. `asPhoto` skips the sidecar.
 */
export async function openPath(path: string, { asPhoto = false } = {}) {
  const name = baseName(path);
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (!MIME[ext]) {
    app.say('error', `${name} is not a PNG, JPEG, WebP or CR3 image.`);
    return;
  }
  const seq = ++loadSeq;
  app.loading = true;
  try {
    await fontsReady;
    const side = ext === 'png' && !asPhoto ? await readSidecar(path).catch(() => null) : null;
    const spec = side ? parseSidecar(side.json) : null;
    if (side && spec) {
      await reopen(path, spec, side.editable, seq);
      return;
    }
    const photo = await decodePath(path);
    if (seq !== loadSeq) return;
    await adopt(photo, path, photo.name);
    app.doc.crop = squareCrop(autoCrop(photo, app.cropAspect));
    app.saved = null;
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

interface SidecarSpec {
  source: { path: string; name: string };
  doc: unknown;
  wallpaper: unknown;
  motion: unknown;
}

function parseSidecar(json: string): SidecarSpec | null {
  try {
    const s = JSON.parse(json) as Record<string, unknown>;
    const src = s.source as Record<string, unknown> | undefined;
    if (!/^stipple\//.test(String(s.format)) || typeof src?.path !== 'string') return null;
    return {
      source: { path: src.path, name: typeof src.name === 'string' ? src.name : baseName(src.path).replace(/\.[^.]+$/, '') },
      doc: s.doc,
      wallpaper: s.wallpaper,
      motion: s.motionSettings ?? s.motion,
    };
  } catch {
    return null;
  }
}

/** Reopen a saved wallpaper: its source photo with the saved settings. */
async function reopen(pngPath: string, spec: SidecarSpec, editable: boolean, seq: number) {
  const file = baseName(pngPath);
  let photo: Photo;
  try {
    photo = await decodePath(spec.source.path);
  } catch (e) {
    if (seq !== loadSeq) return;
    const why = e instanceof ImageError ? imageErrorMessage(e) : errorText(e);
    app.say('error', `${file} was made from ${spec.source.path}, which could not be opened (${why}).`,
      { label: 'Open it as a photo', run: () => openPath(pngPath, { asPhoto: true }) });
    return;
  }
  if (seq !== loadSeq) return;
  await adopt(photo, spec.source.path, spec.source.name);
  app.doc = docFrom(spec.doc);
  app.wall = wallFrom(spec.wallpaper);
  app.motion = cleanMotion(spec.motion);
  app.resetHistory();
  app.saved = editable ? { path: pngPath, key: app.imageKey(), motion: JSON.stringify(app.playMotion) } : null;
  app.say('info', editable
    ? `Reopened ${file}. A motion change updates it when you save; other changes save a new file.`
    : `Reopened ${file}. Saving makes a new file in ~/Pictures/Wallpapers.`);
  app.commits++;
  schedule();
}
