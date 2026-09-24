// The document (every Typist option) and the wallpaper options, with undo / redo.
//
// One gesture is one history step, as in Typist: discrete controls commit right away, sliders
// commit on release (same label within 600 ms merges), a crop commits on Done. The snapshot holds
// both the doc and the wallpaper options, so a margin or colour change undoes too.

import type { AsciiMethod, Grid, Mode } from '$typist/convert.js';
import { cleanCrop } from '$typist/crop.js';
import { History } from '$typist/history.js';
import type { Photo } from '$typist/imageio.js';
import { CROP_DEFAULTS, cropSize, TONE_DEFAULTS, type Crop, type Tone } from '$typist/tone.js';
import { autoCols, cellAspect, fileColours, rowsFor } from './engine/engine';
import { clampBox, COLS_MAX, COLS_MIN, innerRect, MARGIN_MAX, type Box, type LayoutIn, type Placement } from './layout';
import { defaultMotion, motionFor, supportFor, type Motion, type Support } from './motion';
import type { Colours } from './render';
import type { Monitor, ThemeColors } from './tauri';

/** The styles Stipple offers (Typist's Blocks is not one of them). */
export type Style = Exclude<Mode, 'blocks'>;

/** The tone controls Stipple shows; the rest of Typist's tone stays at its defaults. */
export type ToneControls = Pick<Tone, 'auto' | 'brightness' | 'contrast' | 'invert'>;

export interface Doc {
  mode: Style;
  ascii: AsciiMethod;
  /** null = auto (from the output size). */
  cols: number | null;
  tone: ToneControls;
  crop: Crop;
}

export interface Wall {
  width: number;
  height: number;
  placement: Placement;
  marginPct: number;
  /** Crop to the aspect of the space inside the margin, so the art fills it (off = square). */
  cropToScreen: boolean;
  /** null = Typist's invert rule. */
  ink: string | null;
  paper: string | null;
  /** The art's box on the screen (fractions); null = the whole screen inside the margin. */
  box: Box | null;
  /** Colour outside the art's box or margin; null = the paper colour. */
  surround: string | null;
}

export interface Snapshot { doc: Doc; wall: Wall; motion: Motion }

export interface LoadedPhoto {
  photo: Photo;
  /** Absolute path it was opened from. */
  path: string;
  /** Stem for the output name. */
  name: string;
}

export interface Notice {
  kind: 'ok' | 'warn' | 'error' | 'info';
  text: string;
  action?: { label: string; run: () => void | Promise<void> };
}

const { auto, brightness, contrast, invert } = TONE_DEFAULTS;
export const TONE_CONTROL_DEFAULTS: Readonly<ToneControls> = Object.freeze({ auto, brightness, contrast, invert });

export const defaultDoc = (): Doc => ({
  mode: 'ascii', ascii: 'shape', cols: null, tone: { ...TONE_CONTROL_DEFAULTS, invert: true }, crop: { ...CROP_DEFAULTS },
});

export const defaultWall = (): Wall => ({
  width: 1920, height: 1080, placement: 'fit', marginPct: 0, cropToScreen: false, ink: null, paper: null,
  box: null, surround: null,
});

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const oneOf = <T extends string>(v: unknown, ok: readonly T[], def: T): T => (ok.includes(v as T) ? (v as T) : def);
const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const hex = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

/** A document from a sidecar's `doc` (older or partial ones get the defaults). */
export function docFrom(raw: unknown): Doc {
  const r = obj(raw), t = obj(r.tone), d = defaultDoc();
  const tone = { ...d.tone };
  for (const k of Object.keys(tone) as (keyof ToneControls)[]) {
    const v = t[k];
    if (typeof v === typeof tone[k] && (typeof v !== 'number' || Number.isFinite(v))) (tone as Raw)[k] = v;
  }
  const cols = typeof r.cols === 'number' && Number.isFinite(r.cols) ? clamp(Math.round(r.cols), COLS_MIN, COLS_MAX) : null;
  return {
    // Blocks (no longer offered) opens as the default style
    mode: oneOf(r.mode, ['braille', 'ascii'] as const, d.mode),
    ascii: oneOf(r.ascii, ['shape', 'ramp'] as const, d.ascii),
    cols,
    tone,
    crop: squareCrop(cleanCrop(obj(r.crop) as Partial<Crop>)),
  };
}

/** Wallpaper options from a sidecar's `wallpaper`. */
export function wallFrom(raw: unknown): Wall {
  const r = obj(raw), d = defaultWall();
  const b = r.box ? obj(r.box) : null;
  const size = (v: unknown, def: number) => clamp(Math.round(num(v, def)), 16, 16384);
  return {
    width: size(r.width, d.width),
    height: size(r.height, d.height),
    placement: oneOf(r.placement, ['fit', 'fill'] as const, d.placement),
    marginPct: clamp(num(r.marginPct, d.marginPct), 0, MARGIN_MAX),
    cropToScreen: r.cropToScreen === true,
    ink: hex(r.ink),
    paper: hex(r.paper),
    box: b ? clampBox({ x: num(b.x, NaN), y: num(b.y, NaN), w: num(b.w, NaN), h: num(b.h, NaN) }) : null,
    surround: hex(r.surround),
  };
}

/**
 * The crop's aspect (width / height): the inner rectangle's with Crop to screen on, else 1. Rounded
 * so a size or margin change that keeps the shape keeps the converter's cached samples.
 */
export function cropAspectFor(wall: Pick<Wall, 'width' | 'height' | 'marginPct' | 'cropToScreen' | 'box'>): number {
  if (!wall.cropToScreen) return 1;
  const r = innerRect(wall);
  return Math.round((r.w / r.h) * 1e6) / 1e6;
}

/** The crop the engine samples: the doc's, with the aspect when it is not square. */
export function effectiveCrop(doc: Pick<Doc, 'crop'>, wall: Parameters<typeof cropAspectFor>[0]): Crop {
  const crop = squareCrop(doc.crop);
  const a = cropAspectFor(wall);
  return a === 1 ? crop : { ...crop, aspect: a };
}

/** A crop without its aspect (the doc keeps only the position; the aspect is derived). */
export function squareCrop(c: Crop): Crop {
  const { aspect: _aspect, ...rest } = c;
  return rest;
}

class AppState {
  doc: Doc = $state(defaultDoc());
  wall: Wall = $state(defaultWall());
  motion: Motion = $state(defaultMotion());
  /** The preview plays the motion. */
  playing = $state(true);
  /** Columns keyframes built so far for the current settings (null: none being built). */
  framesProgress: { done: number; total: number } | null = $state.raw(null);
  loaded: LoadedPhoto | null = $state.raw(null);
  grid: Grid | null = $state.raw(null);
  /** Last main conversion time (ms). */
  runMs = $state(0);
  cropping = $state(false);
  peeking = $state(false);
  dragOver = $state(false);
  loading = $state(false);
  busy: string | null = $state(null);
  monitors: Monitor[] = $state.raw([]);
  theme: ThemeColors | null = $state.raw(null);
  notice: Notice | null = $state.raw(null);
  canUndo = $state(false);
  canRedo = $state(false);
  undoLabel: string | null = $state(null);
  redoLabel: string | null = $state(null);

  history = new History<Snapshot>({
    onChange: h => {
      this.canUndo = h.canUndo;
      this.canRedo = h.canRedo;
      this.undoLabel = h.undoLabel;
      this.redoLabel = h.redoLabel;
    },
  });

  /** Which effects the current style can play. */
  support: Support = $derived(supportFor(this.doc));
  layoutIn: LayoutIn = $derived({
    width: this.wall.width, height: this.wall.height, marginPct: this.wall.marginPct, placement: this.wall.placement,
    box: this.wall.box,
  });
  /** Crop width / height (1 = square). */
  cropAspect = $derived(cropAspectFor(this.wall));
  /** The crop the engine samples (see effectiveCrop). */
  crop: Crop = $derived(effectiveCrop(this.doc, this.wall));
  autoCols = $derived(autoCols(this.doc.mode, this.layoutIn, this.cropAspect));
  cols = $derived(clamp(this.doc.cols ?? this.autoCols, COLS_MIN, COLS_MAX));
  rows = $derived(rowsFor(this.cols, this.doc.mode, this.cropAspect));
  cellAspect = $derived(cellAspect(this.doc.mode));
  isAuto = $derived(this.doc.cols == null || this.doc.cols === this.autoCols);
  /** The colours drawn: custom picks, else Typist's file colours for the invert setting. */
  colours: Colours = $derived.by(() => {
    const rule = fileColours(this.doc.tone.invert);
    const paper = this.wall.paper ?? rule.paper;
    return { ink: this.wall.ink ?? rule.ink, paper, surround: this.wall.surround ?? paper };
  });

  /** The motion as it plays and is saved: effects this style cannot play are off. */
  playMotion: Motion = $derived(motionFor(this.motion, this.support));

  /**
   * The wallpaper file these settings were last saved to (or reopened from): `key` is everything
   * that changes the image (see imageKey), `motion` the motion saved with it. Only the motion
   * changed: Save rewrites that file's sidecar instead of making a new file.
   */
  saved: { path: string; key: string; motion: string } | null = null;

  imageKey(): string {
    const { doc, wall } = this.snapshot();
    return JSON.stringify([this.loaded?.path, doc, wall, this.colours]);
  }

  snapshot(): Snapshot {
    return $state.snapshot({ doc: this.doc, wall: this.wall, motion: this.motion }) as Snapshot;
  }

  /** Record a finished change (app.js commit): a merged burst ending where it began is no step. */
  commit(label: string) {
    if (!this.loaded) return;
    const h = this.history;
    h.commit(this.snapshot(), label);
    if (h.index > 0 && h.stack[h.index] === h.stack[h.index - 1]) {
      h.stack.splice(h.index, 1);
      h.labels.splice(h.index, 1);
      h.index--;
      h.lastLabel = null;
      h.onChange?.(h);
    }
  }

  resetHistory() {
    this.history.reset(this.snapshot());
  }

  #restore(s: Snapshot | null) {
    if (!s) return;
    this.doc = s.doc;
    this.wall = s.wall;
    this.motion = s.motion;
  }

  undo() { this.#restore(this.history.undo()); }
  redo() { this.#restore(this.history.redo()); }

  /** Columns −/+ (app.js stepCols): landing on the auto value goes back to auto. */
  stepCols(d: number) {
    const next = clamp(this.cols + d, COLS_MIN, COLS_MAX);
    if (next === this.cols) return;
    this.doc.cols = next === this.autoCols ? null : next;
    this.commit('Width');
  }

  /**
   * Crop to screen on / off. An upright crop that fits on the photo is moved just enough to stay
   * on it in the new shape (a square panned to one side would otherwise widen off the photo).
   */
  setCropToScreen(on: boolean) {
    if (on === this.wall.cropToScreen) return;
    this.wall.cropToScreen = on;
    const p = this.loaded?.photo, c = this.crop;
    if (p && !c.rotation) {
      const [cw, ch] = cropSize(p.width, p.height, c);
      const x = cw <= p.width ? clamp(c.x, cw / 2 / p.width, 1 - cw / 2 / p.width) : c.x;
      const y = ch <= p.height ? clamp(c.y, ch / 2 / p.height, 1 - ch / 2 / p.height) : c.y;
      if (x !== c.x || y !== c.y) this.doc.crop = { ...this.doc.crop, x, y };
    }
    this.commit('Crop to screen');
  }

  setInvert(on: boolean) {
    this.doc.tone.invert = on;
    this.commit('Invert');
  }

  say(kind: Notice['kind'], text: string, action?: Notice['action']) {
    this.notice = { kind, text, action };
  }
}

export const app = new AppState();
