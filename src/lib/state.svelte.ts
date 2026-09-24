// The document (every Typist option) and the wallpaper options, with undo / redo.
//
// One gesture is one history step, as in Typist: discrete controls commit right away, sliders
// commit on release (same label within 600 ms merges), a crop commits on Done. The snapshot holds
// both the doc and the wallpaper options, so a margin or colour change undoes too.

import type { AsciiMethod, BlocksKind, Dither, Grid, Mode } from '$typist/convert.js';
import { History } from '$typist/history.js';
import type { Photo } from '$typist/imageio.js';
import { CROP_DEFAULTS, cropSize, TONE_DEFAULTS, type Crop, type LookId, type Tone } from '$typist/tone.js';
import { autoCols, cellAspect, fileColours, rowsFor } from './engine/engine';
import { COLS_MAX, COLS_MIN, innerRect, type LayoutIn, type Placement } from './layout';
import type { Colours } from './render';
import type { Monitor, ThemeColors } from './tauri';

export type ToneControls = Omit<Tone, 'look'>;

export interface Doc {
  mode: Mode;
  look: LookId;
  dither: Dither;
  ascii: AsciiMethod;
  blocks: BlocksKind;
  /** Colour blocks (blocks mode only). */
  color: boolean;
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
}

export interface Snapshot { doc: Doc; wall: Wall }

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

const { look: _look, ...TONE_CONTROLS } = TONE_DEFAULTS;
export const TONE_CONTROL_DEFAULTS: Readonly<ToneControls> = Object.freeze(TONE_CONTROLS);

export const defaultDoc = (): Doc => ({
  mode: 'braille', look: 'photo', dither: 'atkinson', ascii: 'shape', blocks: 'quad', color: false,
  cols: null, tone: { ...TONE_CONTROL_DEFAULTS }, crop: { ...CROP_DEFAULTS },
});

export const defaultWall = (): Wall => ({
  width: 1920, height: 1080, placement: 'fit', marginPct: 0, cropToScreen: false, ink: null, paper: null,
});

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * The crop's aspect (width / height): the inner rectangle's with Crop to screen on, else 1. Rounded
 * so a size or margin change that keeps the shape keeps the converter's cached samples.
 */
export function cropAspectFor(wall: Pick<Wall, 'width' | 'height' | 'marginPct' | 'cropToScreen'>): number {
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
  /** Bumped by every commit: the look thumbnails rebuild on it. */
  commits = $state(0);

  history = new History<Snapshot>({
    onChange: h => {
      this.canUndo = h.canUndo;
      this.canRedo = h.canRedo;
      this.undoLabel = h.undoLabel;
      this.redoLabel = h.redoLabel;
    },
  });

  /** Colour blocks are on (the Colour switch only applies to Blocks). */
  colourBlocks = $derived(this.doc.mode === 'blocks' && this.doc.color);
  layoutIn: LayoutIn = $derived({
    width: this.wall.width, height: this.wall.height, marginPct: this.wall.marginPct, placement: this.wall.placement,
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
    return { ink: this.wall.ink ?? rule.ink, paper: this.wall.paper ?? rule.paper };
  });

  snapshot(): Snapshot {
    return $state.snapshot({ doc: this.doc, wall: this.wall }) as Snapshot;
  }

  /** Record a finished change (app.js commit): a merged burst ending where it began is no step. */
  commit(label: string) {
    this.commits++;
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
    this.commits++;
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
