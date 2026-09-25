// Draws a wallpaper: paper over the whole canvas, then the grid at its layout (clipped to its area).
// The export draws at the output size; the preview draws the same thing at its own pixel size.
// Everything is laid out in device pixels. The grid itself is rasterised in JS (rasterize.ts):
// canvas drawing calls are too slow in WebKitGTK for tens of thousands of dots or glyphs.

import type { Grid } from '$typist/convert.js';
import { cropSize, type Crop } from '$typist/tone.js';
import type { Layout } from './layout';
import { rasterize, Surface } from './rasterize';

/** Typist's PNG export font stack (export.js MONO_STACK: the bundled Geist Mono first). */
export const FONT = '"Geist Mono", ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, '
  + '"DejaVu Sans Mono", "Liberation Mono", monospace';
/** Braille dot radius relative to the column pitch, as Typist exports it. */
export const DOT_R = 0.32;

export interface Colours {
  ink: string;
  paper: string;
  /** Outside the art's rectangle (around the box); missing = paper. */
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
  ctx.beginPath();
  ctx.rect(layout.clip.x, layout.clip.y, layout.clip.w, layout.clip.h);
  ctx.clip();
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

/**
 * The art's ink coverage at the output size, as RGB (R = G = B = coverage, 0 around the art): the
 * night's mask, which the plugin colours with the hour's ink and paper (wall.frag mode 0).
 */
export function renderCoverage(grid: Grid, layout: Layout, width: number, height: number): Uint8Array {
  const img = rasterize(new Surface(width, height), grid, layout, { ink: '#ffffff', paper: '#000000' }, { font: FONT, dotR: DOT_R });
  const d = img.data, out = new Uint8Array(width * height * 3);
  for (let i = 0, n = width * height; i < n; i++) out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = d[i * 4]!;
  return out;
}
