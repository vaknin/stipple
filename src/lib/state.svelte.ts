// The document (every Typist option) and the wallpaper options, with undo / redo.
//
// One gesture is one history step, as in Typist: discrete controls commit right away, sliders
// commit on release (same label within 600 ms merges), a crop commits on Done. The snapshot holds
// both the doc and the wallpaper options, so an art area or colour change undoes too, and the
// motion and Theme settings.

import { clockSun, defaultTheme, sun, themeAt, type HourColours, type Palette, type Sun, type ThemeOpts } from '$palette';
import type { Grid } from '$typist/convert.js';
import { History } from '$typist/history.js';
import type { Photo } from '$typist/imageio.js';
import { cropSize, type Crop } from '$typist/tone.js';
import {
  cropAspectFor, DEFAULT_COLOURS, defaultDoc, defaultWall, effectiveCrop, type Doc, type Wall,
} from './doc';
import { autoCols, rowsFor } from './engine/engine';
import { clampBox, COLS_MAX, COLS_MIN, type Box, type LayoutIn } from './layout';
import { defaultMotion, type Motion } from './motion';
import type { Colours } from './render';
import type { Monitor, SunLocation, ThemeColors } from './tauri';

export * from './doc';

export interface Snapshot { doc: Doc; wall: Wall; motion: Motion; theme: ThemeOpts }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

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

/** The sun at `date`: from the weather location's coordinates, else up from 06:00 to 18:00. */
export function sunAt(date: Date, place: SunLocation | null): Sun {
  return place?.latitude != null && place.longitude != null ? sun(date, place.latitude, place.longitude) : clockSun(date);
}

class AppState {
  doc: Doc = $state(defaultDoc());
  wall: Wall = $state(defaultWall());
  motion: Motion = $state(defaultMotion());
  /** The Stipple theme's settings (palette.mjs): how the desktop's colours follow the sun. */
  themeOpts: ThemeOpts = $state(defaultTheme());
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
  /** The current Omarchy theme's colours (Wallpaper > Theme colours). */
  omarchy: ThemeColors | null = $state.raw(null);
  /** The weather location, for the sun (null: none, or no answer yet). */
  sunPlace: SunLocation | null = $state.raw(null);
  /** The Theme tab previews this minute of today (null: now). Not a history step. */
  previewMinute: number | null = $state(null);
  /** The Theme tab is open: the preview shows the colours of the hour. */
  themeShown = $state(false);
  /** Now, to the minute, while the Theme tab is open (it ticks it). */
  clock = $state(Date.now());
  notice: Notice | null = $state.raw(null);
  canUndo = $state(false);
  canRedo = $state(false);
  undoLabel: string | null = $state(null);
  redoLabel: string | null = $state(null);

  /** Called after every history step (commit, undo, redo, a new photo): session.ts saves then. */
  afterStep: (() => void) | null = null;

  history = new History<Snapshot>({
    onChange: h => {
      this.canUndo = h.canUndo;
      this.canRedo = h.canRedo;
      this.undoLabel = h.undoLabel;
      this.redoLabel = h.redoLabel;
      // after the caller is done: undo / redo restore the snapshot once this returns
      if (this.afterStep) queueMicrotask(this.afterStep);
    },
  });

  layoutIn: LayoutIn = $derived({ width: this.wall.width, height: this.wall.height, box: this.wall.box });
  /** Crop width / height (1 = square). */
  cropAspect = $derived(cropAspectFor(this.wall));
  /** The crop the engine samples (see effectiveCrop). */
  crop: Crop = $derived(effectiveCrop(this.doc, this.wall));
  autoCols = $derived(autoCols(this.layoutIn, this.cropAspect));
  cols = $derived(clamp(this.doc.cols ?? this.autoCols, COLS_MIN, COLS_MAX));
  rows = $derived(rowsFor(this.cols, this.cropAspect));
  isAuto = $derived(this.doc.cols == null || this.doc.cols === this.autoCols);
  /** The colours drawn: custom picks, else the default colours. Which way the art goes follows them. */
  colours: Colours = $derived.by(() => {
    const paper = this.wall.paper ?? DEFAULT_COLOURS.paper;
    return { ink: this.wall.ink ?? DEFAULT_COLOURS.ink, paper, surround: this.wall.surround ?? paper };
  });

  /** The moment the Theme tab previews. */
  previewDate: Date = $derived.by(() => {
    const d = new Date(this.clock);
    if (this.previewMinute != null) d.setHours(0, this.previewMinute, 0, 0);
    return d;
  });
  sunNow: Sun = $derived(sunAt(this.previewDate, this.sunPlace));
  /** The wallpaper's colours and the desktop's palette at the previewed moment. */
  themed: { wall: HourColours; palette: Palette } = $derived(themeAt(this.colours, this.themeOpts, this.sunNow));
  /** The colours the preview draws: the hour's while the Theme tab previews, else the saved ones. */
  shownColours: Colours = $derived(this.themeShown || this.previewMinute != null ? this.themed.wall : this.colours);

  /**
   * The wallpaper file these settings were last saved to (or reopened from): `key` is everything
   * that changes the image (see imageKey), `motion` the motion saved with it. Only the motion
   * changed: Save rewrites that file's sidecar instead of making a new file. `theme` likewise
   * (the Theme settings are not part of the image: the PNG keeps the day's colours).
   */
  saved: { path: string; key: string; motion: string; theme: string } | null = $state.raw(null);

  imageKey(): string {
    const { doc, wall } = this.snapshot();
    return JSON.stringify([this.loaded?.path, doc, wall, this.colours]);
  }

  snapshot(): Snapshot {
    return $state.snapshot({ doc: this.doc, wall: this.wall, motion: this.motion, theme: this.themeOpts }) as Snapshot;
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
    this.themeOpts = s.theme;
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
   * After the art's shape changed (Fill / Custom, a resized box, another screen): an upright crop
   * that fits on the photo is moved just enough to stay on it in the new shape (a crop panned to
   * one side would otherwise widen off the photo).
   */
  keepCropOnPhoto() {
    const p = this.loaded?.photo, c = this.crop;
    if (!p || c.rotation) return;
    const [cw, ch] = cropSize(p.width, p.height, c);
    const x = cw <= p.width ? clamp(c.x, cw / 2 / p.width, 1 - cw / 2 / p.width) : c.x;
    const y = ch <= p.height ? clamp(c.y, ch / 2 / p.height, 1 - ch / 2 / p.height) : c.y;
    if (x !== c.x || y !== c.y) this.doc.crop = { ...this.doc.crop, x, y };
  }

  /** Set the art's box (null = Fill) as one history step. */
  setBox(b: Box | null, label: string) {
    this.wall.box = b ? clampBox(b, 16 / Math.min(this.wall.width, this.wall.height)) : null;
    this.keepCropOnPhoto();
    this.commit(label);
  }

  /** Ink and paper change places: the art is drawn the other way round, still a positive picture. */
  swapColours() {
    const { ink, paper } = this.colours;
    this.wall.ink = paper;
    this.wall.paper = ink;
    this.commit('Swap colours');
  }

  say(kind: Notice['kind'], text: string, action?: Notice['action']) {
    this.notice = { kind, text, action };
  }
}

export const app = new AppState();
