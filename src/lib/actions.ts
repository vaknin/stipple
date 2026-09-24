// Save, Set as wallpaper, Add to theme backgrounds.
//
// Output: ~/Pictures/Wallpapers/<photo>-stipple-<W>x<H>.png (never overwritten; -2, -3… on
// collision) plus <same name>.stipple.json, the grid and every setting, so a later renderer (an
// animated one, an SVG export) can redraw or re-characterise the art without the photo.

import { gridLines, type Grid } from '$typist/convert.js';
import { cellAspect } from './engine/engine';
import { baseName, currentGrid, layoutFor, schedule } from './pipeline';
import type { Layout } from './layout';
import { DOT_R, FONT, renderPng, type Colours } from './render';
import { app, effectiveCrop, type Snapshot } from './state.svelte';
import { addToThemeBackgrounds, errorText, savePng, saveSidecar, setWallpaper } from './tauri';

export const ENGINE = { name: 'typist', repo: 'https://github.com/winchxyz/typist', commit: '7081dce' };
const APP_VERSION = '0.1.0';

let saved: { path: string; key: string } | null = null;

/** Everything that changes the saved image. */
function saveKey(): string {
  return JSON.stringify([app.loaded?.path, app.snapshot(), app.colours]);
}

function sidecar(grid: Grid, snap: Snapshot, colours: Colours, pngPath: string, layout: Layout) {
  const loaded = app.loaded!;
  const { width, height } = snap.wall;
  return {
    format: 'stipple/1',
    created: new Date().toISOString(),
    app: { name: 'Stipple', version: APP_VERSION },
    engine: ENGINE,
    source: {
      path: loaded.path,
      name: loaded.name,
      // the working image the engine sampled (EXIF-rotated, long side <= 2048)
      width: loaded.photo.width,
      height: loaded.photo.height,
    },
    image: { file: baseName(pngPath), width, height },
    /** Every Typist option; cols null = auto. crop is the one sampled (with aspect when not square). */
    doc: { ...snap.doc, crop: effectiveCrop(snap.doc, snap.wall) },
    /** Wallpaper options; ink / paper null = Typist's invert rule. */
    wallpaper: snap.wall,
    colours,
    layout: {
      cellW: layout.cellW, cellH: layout.cellH, x: layout.x, y: layout.y, artW: layout.artW, artH: layout.artH,
      clip: layout.clip, cellAspect: cellAspect(grid.mode), font: FONT, dotR: DOT_R,
    },
    grid: {
      mode: grid.mode,
      cols: grid.cols,
      rows: grid.rows,
      /** Rows as text: one code point per cell (Braille blanks are U+2800, others U+0020). */
      lines: gridLines(grid),
      /** The same cells as code points, row-major. */
      cp: Array.from(grid.cp),
      /** 0xRRGGBB per cell, colour blocks only. */
      fg: grid.fg ? Array.from(grid.fg) : null,
      bg: grid.bg ? Array.from(grid.bg) : null,
      ink: grid.ink,
    },
  };
}

/** Save the wallpaper (or return the file saved for these exact settings). */
export async function save(): Promise<string | null> {
  if (!app.loaded || app.busy) return null;
  const key = saveKey();
  if (saved && saved.key === key) return saved.path;
  app.busy = 'Saving…';
  try {
    // everything is read before the first await: an edit during the save belongs to the next one
    const snap = app.snapshot();
    const colours = { ...app.colours };
    const name = app.loaded.name;
    const grid = await currentGrid();
    const { width, height } = snap.wall;
    const layout = layoutFor(grid, width, height, snap.wall);
    const png = await renderPng(grid, layout, colours, width, height);
    const path = await savePng(new Uint8Array(await png.arrayBuffer()), name, width, height);
    await saveSidecar(path, JSON.stringify(sidecar(grid, snap, colours, path, layout)));
    saved = { path, key };
    app.say('ok', `Saved ${baseName(path)} in ~/Pictures/Wallpapers.`);
    return path;
  } catch (e) {
    app.say('error', `Could not save: ${errorText(e)}`);
    return null;
  } finally {
    app.busy = null;
    schedule();
  }
}

/** Save if needed, then `omarchy theme bg set` it and check that it took. */
export async function setAsWallpaper() {
  const path = await save();
  if (!path) return;
  app.busy = 'Setting…';
  try {
    const res = await setWallpaper(path);
    const add = { label: 'Add to theme backgrounds', run: () => addToTheme(path) };
    if (res.ok) {
      app.say('ok', `Wallpaper set: “${res.current_name}”. A theme change or cycling backgrounds replaces it.`, add);
    } else {
      app.say('warn', `The background points at the new file, but Omarchy reports “${res.current_name}”`
        + `${res.warning ? ` (${res.warning})` : ''}.`, add);
    }
  } catch (e) {
    app.say('error', `Could not set the wallpaper: ${errorText(e)}`);
  } finally {
    app.busy = null;
  }
}

export async function addToTheme(path: string) {
  try {
    const dest = await addToThemeBackgrounds(path);
    app.say('ok', `Added to the theme's backgrounds: ${dest.replace(/^\/home\/[^/]+/, '~')}`);
  } catch (e) {
    app.say('error', `Could not add it to the theme backgrounds: ${errorText(e)}`);
  }
}
