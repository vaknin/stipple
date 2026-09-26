// Set as wallpaper: the one way out. A wallpaper that was reopened (app.target) is rewritten in
// place; a new photo is saved as ~/.config/omarchy/backgrounds/<theme>/<photo>-stipple-<W>x<H>.png
// (-2, -3… on collision), so the background switcher lists it, and is the target from then on.
// Beside it goes <same name>.stipple.json, the grid and every setting, so a later renderer (an
// animated one, an SVG export) can redraw or re-characterise the art without the photo. Columns
// motion gets its keyframes and glyphs in .stipple/<same name>/ (frames.png, glyphs.png), which
// the shell plugin animates.
// When the Theme settings take the colours across each other at some hour (Custom's night, say),
// the art is also drawn the other way round, so the night is a positive picture too: its coverage
// (night.png) and its keyframes (frames.png's G). The plugin switches
// over where ink and paper meet (palette.mjs flipAt).
// Changing only the motion of a saved wallpaper rewrites its sidecar: the plugin picks it up live.
// So does the Theme block (only it changed: just that block is rewritten), which the plugin turns
// into the desktop's colours.

import { needsNight } from '$palette';
import { gridLines, type Grid } from '$typist/convert.js';
import { version as APP_VERSION } from '../../package.json';
import { CELL_ASPECT } from './engine/engine';
import { atlasLevels, glyphAtlas, packFrames } from './letterframes';
import { baseName, columnFrames, currentGrid, layoutFor, schedule } from './pipeline';
import type { Layout } from './layout';
import type { Motion } from './motion';
import { FONT, renderCoverage, renderPng, type Colours } from './render';
import { app, effectiveCrop, type Snapshot } from './state.svelte';
import {
  errorText, readSidecar, removeMotionFiles, saveField, savePng, saveSidecar, setWallpaper, useStippleTheme,
  type MotionFile,
} from './tauri';

export const ENGINE = { name: 'typist', repo: 'https://github.com/winchxyz/typist', commit: '7081dce' };
export const FORMAT = 'stipple/3';

/** `.stipple/<stem>/<name>.png`, relative to the wallpaper's folder. */
const motionFile = (pngPath: string, name: string) => `.stipple/${baseName(pngPath).replace(/\.png$/i, '')}/${name}.png`;

/** The Columns keyframes of one side, showing how far along they are instead of a bare "Saving…". */
async function framesOf(side: 'day' | 'night') {
  const progress = () => {
    const p = app.framesProgress;
    if (p) app.busy = `Rendering ${side === 'night' ? 'night ' : ''}frames ${p.done}/${p.total}…`;
  };
  progress();
  const tick = window.setInterval(progress, 100);
  try {
    return await columnFrames(side);
  } finally {
    clearInterval(tick);
    app.busy = 'Saving…';
  }
}

/**
 * Write frames.png and glyphs.png for Columns motion and return the sidecar's `columns` (see
 * letterframes.ts): every keyframe's layout and place in frames.png, the glyph atlas levels, and
 * whether frames.png's G holds the night's keyframes.
 */
async function saveColumns(pngPath: string, wall: Snapshot['wall'], night: boolean) {
  const { grids, start } = await framesOf('day');
  const nightGrids = night ? (await framesOf('night')).grids : null;
  const layouts = grids.map(g => layoutFor(g, wall.width, wall.height, wall));
  const packed = packFrames(grids, layouts, undefined, nightGrids);
  const atlas = glyphAtlas(packed.glyphs, CELL_ASPECT, atlasLevels(layouts.map(l => l.cellH)), FONT);
  await saveField(pngPath, packed.rgb, packed.width, packed.height, 'frames');
  await saveField(pngPath, atlas.rgb, atlas.width, atlas.height, 'glyphs');
  return {
    start,
    frames: packed.frames,
    /** frames.png's G: the same keyframes drawn the other way round. */
    night: !!nightGrids,
    framesFile: motionFile(pngPath, 'frames'),
    glyphsFile: motionFile(pngPath, 'glyphs'),
    glyphs: { count: packed.glyphs.length, cp: packed.glyphs, width: atlas.width, height: atlas.height, levels: atlas.levels },
  };
}

type Columns = Awaited<ReturnType<typeof saveColumns>>;

/**
 * The texture that goes with the still picture: the night's coverage. Written before the sidecar:
 * the plugin loads it when the sidecar appears.
 */
async function saveTextures(pngPath: string, night: Grid | null, layout: Layout, wall: Snapshot['wall']) {
  if (night) await saveField(pngPath, renderCoverage(night, layout, wall.width, wall.height), wall.width, wall.height, 'night');
}

/**
 * After the sidecar: remove the textures it no longer names (Columns turned off, say, or an older
 * Dots wallpaper's field.png).
 */
function dropUnused(pngPath: string, columns: Columns | null, night: Grid | null) {
  const keep: MotionFile[] = [];
  if (columns) keep.push('frames', 'glyphs');
  if (night) keep.push('night');
  return removeMotionFiles(pngPath, keep);
}

function sidecar(grid: Grid, snap: Snapshot, motion: Motion, colours: Colours, pngPath: string, layout: Layout,
  columns: Columns | null, night: Grid | null) {
  const loaded = app.loaded!;
  const { width, height } = snap.wall;
  return {
    format: FORMAT,
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
    /** Wallpaper options; ink / paper null = the default colours, surround null = paper. */
    wallpaper: snap.wall,
    colours,
    /** What the shell plugin plays. */
    motion,
    /** The Motion tab as it was left (reopening restores it). */
    motionSettings: snap.motion,
    /** The Stipple theme (palette.mjs ThemeOpts): how the plugin shifts these colours with the sun. */
    theme: snap.theme,
    /** Columns motion: the keyframes the plugin draws, see letterframes.ts. */
    columns,
    /**
     * The art drawn the other way round, for the hours whose colours cross over (palette.mjs
     * needsNight; null when none do): its coverage and its cells.
     */
    night: night ? {
      file: motionFile(pngPath, 'night'),
      grid: { lines: gridLines(night), cp: Array.from(night.cp) },
    } : null,
    layout: {
      cellW: layout.cellW, cellH: layout.cellH, x: layout.x, y: layout.y, artW: layout.artW, artH: layout.artH,
      inner: layout.inner, clip: layout.clip, cellAspect: CELL_ASPECT, font: FONT,
    },
    grid: {
      mode: grid.mode,
      cols: grid.cols,
      rows: grid.rows,
      /** Rows as text: one code point per cell (blanks are U+0020). */
      lines: gridLines(grid),
      /** The same cells as code points, row-major. */
      cp: Array.from(grid.cp),
      /** Always null: Typist's colour blocks, which Stipple does not draw. */
      fg: null,
      bg: null,
      ink: grid.ink,
    },
  };
}

/**
 * Rewrite only the `theme` block of a saved sidecar (the motion files stay as they are). False
 * when the file is not a sidecar this can patch: the caller rewrites it whole.
 */
async function saveTheme(path: string, theme: Snapshot['theme']): Promise<boolean> {
  const side = await readSidecar(path).catch(() => null);
  let json: Record<string, unknown>;
  try {
    json = side ? JSON.parse(side.json) : null;
  } catch {
    return false;
  }
  if (!json || typeof json !== 'object' || json.format !== FORMAT) return false;
  // the new settings cross the colours over where the old ones did not (or the other way): the
  // night's textures change, so the whole file is rewritten
  const colours = json.colours as Colours | undefined;
  if (!colours || needsNight(colours, theme) !== !!json.night) return false;
  await saveSidecar(path, JSON.stringify({ ...json, theme }));
  return true;
}

/**
 * Save the wallpaper (or return the file saved for these exact settings). When only the motion
 * or the Theme settings changed since, that file's sidecar is rewritten instead; other changes
 * redraw app.target in place, or save a new background when there is none.
 */
export async function save(): Promise<string | null> {
  if (!app.loaded || app.busy) return null;
  const key = app.imageKey();
  const prev = app.saved && app.saved.key === key ? app.saved : null;
  const motionKey = JSON.stringify(app.motion);
  const themeKey = JSON.stringify(app.themeOpts);
  if (prev && prev.motion === motionKey && prev.theme === themeKey) return prev.path;
  app.busy = 'Saving…';
  try {
    // everything is read before the first await: an edit during the save belongs to the next one
    const snap = app.snapshot();
    const colours = { ...app.colours };
    const motion = snap.motion;
    const name = app.loaded.name;
    if (prev && prev.motion === motionKey && await saveTheme(prev.path, snap.theme)) {
      app.say('ok', `Updated the theme of ${baseName(prev.path)}.`);
      app.saved = { ...prev, theme: themeKey };
      return prev.path;
    }
    const grid = await currentGrid();
    const night = needsNight(colours, snap.theme) ? await currentGrid('night') : null;
    const { width, height } = snap.wall;
    const layout = layoutFor(grid, width, height, snap.wall);
    let path: string;
    if (prev) {
      path = prev.path;
      await saveTextures(path, night, layout, snap.wall);
      const columns = motion.columns.on ? await saveColumns(path, snap.wall, !!night) : null;
      await saveSidecar(path, JSON.stringify(sidecar(grid, snap, motion, colours, path, layout, columns, night)));
      await dropUnused(path, columns, night);
      const what = [prev.motion !== motionKey && 'motion', prev.theme !== themeKey && 'theme'].filter(Boolean).join(' and ');
      app.say('ok', `Updated the ${what || 'motion'} of ${baseName(path)}.`);
    } else {
      const png = new Uint8Array(await (await renderPng(grid, layout, colours, width, height)).arrayBuffer());
      const target = app.target;
      let note = '';
      try {
        path = await savePng(png, name, width, height, target);
      } catch (e) {
        if (!target) throw e;
        // renamed or deleted since it was opened: keep the work as a new background
        path = await savePng(png, name, width, height, null);
        note = ` (${baseName(target)} could not be updated: ${errorText(e)})`;
      }
      await saveTextures(path, night, layout, snap.wall);
      const columns = motion.columns.on ? await saveColumns(path, snap.wall, !!night) : null;
      await saveSidecar(path, JSON.stringify(sidecar(grid, snap, motion, colours, path, layout, columns, night)));
      await dropUnused(path, columns, night);
      app.target = path;
      app.say('ok', target && !note ? `Updated ${baseName(path)}.` : `Saved ${baseName(path)} to the backgrounds${note}.`);
    }
    app.saved = { path, key, motion: motionKey, theme: themeKey };
    return path;
  } catch (e) {
    app.say('error', `Could not save: ${errorText(e)}`);
    return null;
  } finally {
    app.busy = null;
    schedule();
  }
}

/**
 * Save if needed, then `omarchy theme bg set` it and check that it took. With the Theme tab's
 * "Use the Stipple theme", Omarchy then switches to the Stipple theme (keeping this background).
 */
export async function setAsWallpaper() {
  const apply = app.themeOpts.apply;
  const path = await save();
  if (!path) return;
  app.busy = 'Setting…';
  try {
    const res = await setWallpaper(path);
    let theme = '';
    if (apply) {
      try {
        if (await useStippleTheme()) theme = ' Omarchy now uses the Stipple theme.';
      } catch (e) {
        app.say('warn', `Wallpaper set: “${res.current_name}”, but the Stipple theme could not be applied: ${errorText(e)}`);
        return;
      }
    }
    if (res.ok) {
      app.say('ok', `Wallpaper set: “${res.current_name}”.${theme}`);
    } else {
      app.say('warn', `The background points at the new file, but Omarchy reports “${res.current_name}”`
        + `${res.warning ? ` (${res.warning})` : ''}.${theme}`);
    }
  } catch (e) {
    app.say('error', `Could not set the wallpaper: ${errorText(e)}`);
  } finally {
    app.busy = null;
  }
}
