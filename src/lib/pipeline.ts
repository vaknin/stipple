// Photo -> Grid -> preview. Input only calls schedule(); one render runs per animation frame
// (app.js does the same). A change that does not touch the conversion (colours, a box moved with
// manual columns) only redraws. The full-size render happens on Save / Set only.

import { cleanTheme, lightInk } from '$palette';
import type { ConvertOpts, Grid } from '$typist/convert.js';
import { autoCrop, decodeImage, ImageError, imageErrorMessage, type Photo } from '$typist/imageio.js';
import { TONE_DEFAULTS } from '$typist/tone.js';
import { cellAspect, Engine, rowsFor, type ConvertRequest } from './engine/engine';
import { layoutArt, type Layout } from './layout';
import {
  cleanMotion, columnFrameAt, columnPlan, columnStart, frameGrid, motionFps, packField,
  type Motion,
} from './motion';
import { perf } from './perf.svelte';
import { surfaceCache } from './rasterize';
import { drawPhotoCrop, renderWallpaper, type Colours } from './render';
import { app, docFrom, squareCrop, wallFrom, type Wall } from './state.svelte';
import { errorText, readFile, readSidecar } from './tauri';

export const engine = new Engine();
const previewSurface = surfaceCache();

/**
 * Geist Mono before anything draws letters: raster.js caches each font's metrics per cell size
 * for good, so a draw before the font is in would bake a fallback face's metrics in.
 */
export const fontsReady: Promise<unknown> = document.fonts
  .load('16px "Geist Mono"', 'M@#')
  .catch(() => []);

let preview: HTMLCanvasElement | null = null;
let raf = 0;
let lastFrame = 0;
/** The last grid converted for each side, and the request it was converted for. */
const emptyGrids = (): Record<Side, { key: string; grid: Grid | null }> =>
  ({ day: { key: '', grid: null }, night: { key: '', grid: null } });
let grids = emptyGrids();

/** The preview canvas (its backing size is set by Preview.svelte before each draw). */
export function setPreviewCanvas(c: HTMLCanvasElement | null) {
  preview = c;
  if (c) schedule();
}

export function schedule() {
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame(t: number) {
  raf = 0;
  if (lastFrame) perf.add('frame', t - lastFrame);
  lastFrame = t;
  void render();
}

/**
 * Which grid: the day's, drawn for the wallpaper's own colours, or the night's, drawn the other way
 * round for an hour whose colours have crossed over (palette.mjs flipAt).
 */
export type Side = 'day' | 'night';

/**
 * The converter request for the current document. The colours decide which way the art goes:
 * light ink on darker paper stands for the photo's light parts (the engine's invert), dark ink for
 * its dark parts, so the picture is never a negative. The night side is the other way round.
 */
export function requestFor(side: Side): ConvertRequest {
  const d = app.doc;
  const invert = lightInk(app.colours.ink, app.colours.paper) !== (side === 'night');
  const opts: ConvertOpts = {
    mode: d.mode, cols: app.cols, rows: app.rows, dither: 'atkinson', ascii: d.ascii, blocks: 'quad', color: false,
    tone: { ...TONE_DEFAULTS, ...d.tone, invert },
    // Dots carry their dot field: the animated preview and the saved field.png come from it
    field: d.mode === 'braille',
  };
  return { crop: { ...app.crop }, opts };
}

/**
 * The grid the preview shows: the night's while the Theme tab previews an hour whose colours have
 * crossed over. The plugin crossfades in a narrow band where ink and paper meet (flipAt); there is
 * no contrast to see that by at the preview's size, so the preview switches halfway.
 */
export function shownSide(): Side {
  return (app.themeShown || app.previewMinute != null) && app.themed.wall.flip >= 0.5 ? 'night' : 'day';
}

async function render() {
  if (!app.loaded) return;
  const side = shownSide();
  const req = requestFor(side);
  const key = JSON.stringify(req);
  const have = grids[side];
  if (key !== have.key || !have.grid) {
    const res = await engine.convert(req);
    if (res) {
      grids[side] = { key, grid: res.grid };
      app.grid = res.grid;
      app.runMs = res.ms;
      perf.add('run', res.ms);
      drawPreview();
      syncFrames();
      // the settings moved on while this converted: go again (a queued newer request is already
      // running in the worker, so this only catches the end of a drag)
      if (JSON.stringify(requestFor(shownSide())) !== key) schedule();
    }
  } else {
    // the other side's grid was already converted (scrubbing the Theme tab's time back and forth)
    if (app.grid !== have.grid) app.grid = have.grid;
    drawPreview();
    syncFrames();
  }
}

/** The grid for the current settings, of one side (converts when the preview does not have it). */
export async function currentGrid(side: Side = 'day') {
  const req = requestFor(side);
  const key = JSON.stringify(req);
  const have = grids[side];
  if (key === have.key && have.grid) return have.grid;
  for (;;) {
    const res = await engine.convert(req);
    if (res) {
      grids[side] = { key, grid: res.grid };
      return res.grid;
    }
  }
}

/** Where `g` goes on a width x height canvas with the given (default: current) wall options. */
export function layoutFor(g: Grid, width: number, height: number, wall: Pick<Wall, 'box'> = app.wall): Layout {
  return layoutArt({ cols: g.cols, rows: g.rows, cellAspect: cellAspect(g.mode) }, { width, height, box: wall.box });
}

export function drawPreview() {
  const c = preview, g = app.grid, loaded = app.loaded;
  if (!c || !g || !loaded || !c.width || !c.height) return;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const t0 = performance.now();
  // the Theme tab shows the colours of the hour (display only: Save keeps the day's)
  const colours = app.shownColours;
  if (app.peeking) {
    const layout = layoutFor(g, c.width, c.height);
    drawPhotoCrop(ctx, loaded.photo.canvas, app.crop, layout, colours.paper, c.width, c.height, colours.surround);
  } else {
    const shown = previewGrid(g);
    renderWallpaper(ctx, shown, layoutFor(shown, c.width, c.height), colours, previewSurface(c.width, c.height));
  }
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
  if (m.columns.on) {
    const k = app.playing ? playable() : null;
    if (!k) return g;
    const t = (performance.now() - epoch) / 1000;
    return k.grids[columnFrameAt(t, k.cols.length, m.columns.period, k.start)]!;
  }
  const f = g.field;
  if (!app.playing || !f || !m.twinkle.on) return g;
  if (packedFor !== g) { packed = packField(f); packedFor = g; }
  if (!scratch || scratch.length !== f.width * f.height) scratch = new Uint8Array(f.width * f.height);
  return frameGrid(packed!, f.width, f.height, m, (performance.now() - epoch) / 1000, scratch);
}

// Columns (Letters): the engine converts the photo at every keyframe's column count on a pool of
// workers (Engine.frames), after the preview is drawn. Converted counts are kept, so a new From,
// To or Smoothness converts only the counts it adds, and One cycle (only the pace) converts
// nothing. The preview plays the last complete set while a new one builds; Save waits for it.

interface FrameBatch {
  /** cacheKey (the picture) and framesKey. */
  base: string;
  key: string;
  cols: number[];
  start: number;
  grids: Grid[];
  done: Promise<Grid[] | null>;
}

/** The batch for the current settings (maybe building) and the last complete one (playing). */
let frames: FrameBatch | null = null;
let shown: FrameBatch | null = null;
/** Converted keyframes by column count, for `cacheKey`'s photo and options, one set per side. */
const emptyCaches = (): Record<Side, { key: string; grids: Map<number, Grid> }> =>
  ({ day: { key: '', grids: new Map() }, night: { key: '', grids: new Map() } });
let caches = emptyCaches();
/** The side Save is waiting for (columnFrames): the preview does not switch the build away from it. */
let held: Side | null = null;
const buildSide = (): Side => held ?? shownSide();

/** Everything a keyframe depends on but its column count. */
function cacheKey(side: Side): string {
  const { crop, opts } = requestFor(side);
  return JSON.stringify([app.loaded?.path, crop, { ...opts, cols: 0, rows: 0, field: false }, app.cropAspect]);
}

/** Everything the set of keyframes depends on (not the cycle: that is only the pace). */
function framesKey(side: Side): string {
  const m = app.playMotion.columns;
  return JSON.stringify([cacheKey(side), m.from, m.to, m.frames, app.cols]);
}

/** The complete keyframes to play: the current ones, or the last set of this picture while they build. */
function playable(): FrameBatch | null {
  const base = cacheKey(shownSide());
  for (const b of [frames, shown]) if (b?.grids.length && b.base === base) return b;
  return null;
}

/** The keyframes' column counts for the current settings (and whether the cell budget cut them). */
export const currentPlan = () =>
  columnPlan(app.playMotion.columns, app.cols, c => rowsFor(c, app.doc.mode, app.cropAspect));

/** Start building the keyframes for the current settings, if Columns is on and they are not built. */
function syncFrames() {
  const side = buildSide();
  const base = cacheKey(side);
  if (caches[side].key !== base) caches[side] = { key: base, grids: new Map() };
  if (!app.loaded || !app.playMotion.columns.on) {
    if (frames) { frames = null; shown = null; engine.frames.cancel(); app.framesProgress = null; }
    return;
  }
  const key = framesKey(side);
  if (frames?.key === key) return;
  const { cols } = currentPlan();
  const batch: FrameBatch = { base, key, cols, start: columnStart(cols, app.cols), grids: [], done: Promise.resolve(null) };
  if (frames?.grids.length) shown = frames;
  frames = batch;
  const have = caches[side].grids;
  const finish = () => {
    batch.grids = cols.map(c => have.get(c)!);
    // keep what this set and the one still playing use
    const keep = new Set([...cols, ...(shown?.cols ?? [])]);
    for (const c of have.keys()) if (!keep.has(c)) have.delete(c);
    shown = batch;
    app.framesProgress = null;
    schedule();
    return batch.grids;
  };
  const missing = cols.filter(c => !have.has(c));
  if (!missing.length) {
    engine.frames.cancel();
    finish();
    batch.done = Promise.resolve(batch.grids);
    return;
  }
  const { crop, opts } = requestFor(side);
  const reqs = missing.map(c => ({ crop, opts: { ...opts, cols: c, rows: rowsFor(c, opts.mode, app.cropAspect), field: false } }));
  let n = cols.length - missing.length;
  app.framesProgress = { done: n, total: cols.length };
  batch.done = engine.frames.run(reqs, (i, grid) => {
    if (caches[side].grids !== have) return;
    have.set(missing[i]!, grid);
    if (frames === batch) app.framesProgress = { done: ++n, total: cols.length };
  }).then(grids => (frames !== batch || !grids ? null : finish()), e => {
    if (frames === batch) { frames = null; app.framesProgress = null; }
    throw e;
  });
  batch.done.catch(e => app.say('error', `Could not build the Columns frames: ${errorText(e)}`));
}

/** The Columns keyframes of one side for the current settings (built now if they are not). */
export async function columnFrames(side: Side = 'day'): Promise<{ cols: number[]; start: number; grids: Grid[] }> {
  held = side;
  try {
    for (;;) {
      syncFrames();
      const b = frames;
      if (!b) throw new Error('Columns needs the Letters style');
      const grids = await b.done;
      if (grids && frames === b) return { cols: b.cols, start: b.start, grids };
    }
  } finally {
    held = null;
    schedule();
  }
}

/** Start, retime or stop the preview's motion frames (after any motion or play change). */
export function syncMotion(restart = false) {
  const m = previewMotion();
  const fps = app.playing && app.loaded ? motionFps(m) : 0;
  if (restart) epoch = performance.now();
  clearInterval(motionTimer);
  // Columns looks every display frame and draws only when the keyframe changes, so each keyframe
  // shows for its own time (a timer at the keyframe rate would beat against the changes)
  motionTimer = fps > 0 && m.columns.on ? window.setInterval(columnsTick, 16)
    : fps > 0 ? window.setInterval(schedule, 1000 / fps) : 0;
  schedule();
}

let lastKeyframe = -1;

function columnsTick() {
  const k = playable();
  if (!k) return;
  const i = columnFrameAt((performance.now() - epoch) / 1000, k.cols.length, previewMotion().columns.period, k.start);
  if (i === lastKeyframe) return;
  lastKeyframe = i;
  schedule();
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
  grids = emptyGrids();
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
    schedule();
  } catch (e) {
    app.say('error', e instanceof ImageError ? imageErrorMessage(e) : errorText(e));
  } finally {
    if (seq === loadSeq) app.loading = false;
  }
}

/** A photo with its settings: from a sidecar (reopening a wallpaper) or the session (resuming). */
interface SidecarSpec {
  source: { path: string; name: string };
  doc: unknown;
  wallpaper: unknown;
  motion: unknown;
  /** The Theme settings (none in older files: the defaults). */
  theme: unknown;
}

/** A sidecar (`stipple/…`) or a session (`stipple-session/…`) file, parsed. */
function parseSidecar(json: string, format = /^stipple\//): SidecarSpec | null {
  try {
    const s = JSON.parse(json) as Record<string, unknown>;
    const src = s.source as Record<string, unknown> | undefined;
    if (!format.test(String(s.format)) || typeof src?.path !== 'string') return null;
    return {
      source: { path: src.path, name: typeof src.name === 'string' ? src.name : baseName(src.path).replace(/\.[^.]+$/, '') },
      doc: s.doc,
      wallpaper: s.wallpaper,
      motion: s.motionSettings ?? s.motion,
      theme: s.theme,
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
  applySpec(spec);
  app.saved = editable ? { path: pngPath, key: app.imageKey(), motion: JSON.stringify(app.playMotion), theme: JSON.stringify(app.themeOpts) } : null;
  app.say('info', editable
    ? `Reopened ${file}. A motion or theme change updates it when you save; other changes save a new file.`
    : `Reopened ${file}. Saving makes a new file in ~/Pictures/Wallpapers.`);
  schedule();
}

/** A spec's settings over the adopted photo, as the start of its history. */
function applySpec(spec: SidecarSpec) {
  app.doc = docFrom(spec.doc);
  app.wall = wallFrom(spec.wallpaper, spec.doc);
  app.motion = cleanMotion(spec.motion);
  app.themeOpts = cleanTheme(spec.theme);
  // an older file's crop may have been square: the art's shape can move it off the photo
  app.keepCropOnPhoto();
  app.resetHistory();
}

/**
 * Resume the session (session.ts): the photo the app was last left with, with its settings.
 * Nothing happens when a photo was opened meanwhile; a photo that is gone leaves the app empty.
 */
export async function resume(json: string) {
  const spec = parseSidecar(json, /^stipple-session\//);
  if (!spec) return;
  const seq = ++loadSeq;
  app.loading = true;
  try {
    await fontsReady;
    let photo: Photo;
    try {
      photo = await decodePath(spec.source.path);
    } catch (e) {
      if (seq !== loadSeq) return;
      const why = e instanceof ImageError ? imageErrorMessage(e) : errorText(e);
      // file errors already name the file
      app.say('warn', why.includes(spec.source.path)
        ? `Could not reopen the last photo: ${why}`
        : `Could not reopen the last photo, ${spec.source.path}: ${why}`);
      return;
    }
    if (seq !== loadSeq) return;
    await adopt(photo, spec.source.path, spec.source.name);
    applySpec(spec);
    app.saved = null;
    schedule();
  } finally {
    if (seq === loadSeq) app.loading = false;
  }
}
