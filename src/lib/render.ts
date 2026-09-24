// Draws a wallpaper: paper over the whole canvas, then the grid at its layout (clipped in fill).
// The export draws at the output size; the preview draws the same thing at its own pixel size.
// Everything is laid out in device pixels. The grid itself is rasterised in JS (rasterize.ts):
// canvas drawing calls are too slow in WebKitGTK for tens of thousands of dots or glyphs.

import type { Grid } from '$typist/convert.js';
import { MONO_STACK } from '$typist/export.js';
import { cropSize, type Crop } from '$typist/tone.js';
import type { Layout } from './layout';
import { rasterize, Surface } from './rasterize';

/** Typist's PNG export font stack (the bundled Geist Mono first). */
export const FONT = MONO_STACK;
/** Braille dot radius relative to the column pitch, as Typist exports it. */
export const DOT_R = 0.32;

export interface Colours {
  ink: string;
  paper: string;
  /** Outside the art's rectangle (the margin or around the box); missing = paper. */
  surround?: string;
}

type Ctx = CanvasRenderingContext2D;

/** Draw the whole wallpaper onto a canvas of exactly the surface's size. */
export function renderWallpaper(ctx: Ctx, grid: Grid, layout: Layout, colours: Colours, surface: Surface) {
  ctx.putImageData(rasterize(surface, grid, layout, colours, { font: FONT, dotR: DOT_R }), 0, 0);
}

/**
 * The photo inside the art's rectangle, framed exactly as the sampler reads it (app.js
 * drawCropped): the crop (square, or of its aspect), turned clockwise, over white paper. For "hold to
 * see the photo".
 */
export function drawPhotoCrop(ctx: Ctx, photo: HTMLCanvasElement, crop: Crop, layout: Layout, paper: string,
  width: number, height: number, surround?: string) {
  const w = photo.width, h = photo.height;
  const [sw, sh] = cropSize(w, h, crop);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = surround ?? paper;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = paper;
  ctx.fillRect(layout.inner.x, layout.inner.y, layout.inner.w, layout.inner.h);
  if (layout.clip) {
    ctx.beginPath();
    ctx.rect(layout.clip.x, layout.clip.y, layout.clip.w, layout.clip.h);
    ctx.clip();
  }
  ctx.beginPath();
  ctx.rect(layout.x, layout.y, layout.artW, layout.artH);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(layout.x, layout.y, layout.artW, layout.artH);
  ctx.translate(layout.x + layout.artW / 2, layout.y + layout.artH / 2);
  ctx.scale(layout.artW / sw, layout.artH / sh);
  ctx.rotate(((crop.rotation || 0) * Math.PI) / 180);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo, -crop.x * w, -crop.y * h);
  ctx.restore();
}

/** A PNG of the wallpaper at its exact output size. */
export async function renderPng(grid: Grid, layout: Layout, colours: Colours, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  renderWallpaper(ctx, grid, layout, colours, new Surface(width, height));
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 0;
  if (!blob) throw new Error('the PNG could not be encoded');
  return blob;
}

/** Relative luminance of #rrggbb (WCAG), for the "art comes out negative" warning. */
export function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
