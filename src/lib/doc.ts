// The document (every Typist option Stipple shows) and the wallpaper options: their shapes,
// defaults, and reading them back from a sidecar or session of any age. No runes here, so the
// tests can import it; state.svelte.ts holds the live copies.

import type { AsciiMethod, Mode } from '$typist/convert.js';
import { cleanCrop } from '$typist/crop.js';
import { CROP_DEFAULTS, TONE_DEFAULTS, type Crop, type Tone } from '$typist/tone.js';
import { clampBox, COLS_MAX, COLS_MIN, innerRect, type Box } from './layout';

/** The styles Stipple offers (Typist's Blocks is not one of them). */
export type Style = Exclude<Mode, 'blocks'>;

/**
 * The tone controls Stipple shows; the rest of Typist's tone stays at its defaults. Invert is not
 * one: which way the art is drawn follows the colours (pipeline.ts requestFor).
 */
export type ToneControls = Pick<Tone, 'auto' | 'brightness' | 'contrast'>;

export interface Doc {
  mode: Style;
  ascii: AsciiMethod;
  /** null = auto (from the output size). */
  cols: number | null;
  tone: ToneControls;
  crop: Crop;
}

export interface Wall {
  /** The output size: the monitor's. */
  width: number;
  height: number;
  /** null = DEFAULT_COLOURS. */
  ink: string | null;
  paper: string | null;
  /** The art's rectangle on the screen (fractions, Custom); null = the whole screen (Fill). */
  box: Box | null;
  /** Colour outside the art's box; null = the paper colour. */
  surround: string | null;
}

/** The colours without picks: light ink on near-black (Typist's inverted file colours). */
export const DEFAULT_COLOURS: Readonly<{ ink: string; paper: string }> = Object.freeze({ ink: '#f2f2f0', paper: '#111113' });
/** Typist's file colours without invert: what an older file with Invert off and no picks drew. */
const OLD_UPRIGHT = { ink: '#17171a', paper: '#ffffff' };

const { auto, brightness, contrast } = TONE_DEFAULTS;
export const TONE_CONTROL_DEFAULTS: Readonly<ToneControls> = Object.freeze({ auto, brightness, contrast });

export const defaultDoc = (): Doc => ({
  mode: 'ascii', ascii: 'shape', cols: null, tone: { ...TONE_CONTROL_DEFAULTS }, crop: { ...CROP_DEFAULTS },
});

export const defaultWall = (): Wall => ({
  width: 1920, height: 1080, ink: null, paper: null, box: null, surround: null,
});

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === 'object' ? (v as Raw) : {});
const oneOf = <T extends string>(v: unknown, ok: readonly T[], def: T): T => (ok.includes(v as T) ? (v as T) : def);
const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const hex = (v: unknown): string | null => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

/** A document from a sidecar's `doc` (older or partial ones get the defaults; an old invert is dropped). */
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

/**
 * Wallpaper options from a sidecar's `wallpaper` (an older one's margin and Fit are dropped).
 * `rawDoc` is the same file's `doc`: an older file without its own ink or paper drew Typist's
 * colours for its Invert setting, and gets them written in so it looks as it did.
 */
export function wallFrom(raw: unknown, rawDoc?: unknown): Wall {
  const r = obj(raw), d = defaultWall();
  const b = r.box ? obj(r.box) : null;
  const size = (v: unknown, def: number) => clamp(Math.round(num(v, def)), 16, 16384);
  let ink = hex(r.ink), paper = hex(r.paper);
  const invert = obj(obj(rawDoc).tone).invert;
  if (typeof invert === 'boolean' && (ink == null || paper == null)) {
    const rule = invert ? DEFAULT_COLOURS : OLD_UPRIGHT;
    ink ??= rule.ink;
    paper ??= rule.paper;
  }
  return {
    width: size(r.width, d.width),
    height: size(r.height, d.height),
    ink,
    paper,
    box: b ? clampBox({ x: num(b.x, NaN), y: num(b.y, NaN), w: num(b.w, NaN), h: num(b.h, NaN) }) : null,
    surround: hex(r.surround),
  };
}

/**
 * The crop's aspect (width / height): the art's rectangle's, so the art fills it. Rounded so a
 * change that keeps the shape keeps the converter's cached samples.
 */
export function cropAspectFor(wall: Pick<Wall, 'width' | 'height' | 'box'>): number {
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
