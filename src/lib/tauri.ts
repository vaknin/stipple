// Typed wrappers for the Rust commands (src-tauri/src/commands.rs). Every call can reject with a
// user-facing message string.

import { invoke } from '@tauri-apps/api/core';

export interface Monitor {
  name: string;
  description: string;
  /** Physical pixels as the screen shows them. */
  width: number;
  height: number;
  scale: number;
  focused: boolean;
}

export interface SetResult {
  ok: boolean;
  current_link: string;
  current_name: string;
  expected_name: string;
  warning: string | null;
}

export interface ThemeColors {
  mode: string;
  background: string;
  foreground: string;
  accent: string;
}

/** The weather location (omarchy-weather-location); no coordinates when it was set by name only. */
export interface SunLocation {
  name: string;
  latitude: number | null;
  longitude: number | null;
}

/** Tauri rejects with the command's error string; anything else becomes one. */
export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

export const monitors = () => invoke<Monitor[]>('monitors');

export const readFile = (path: string) => invoke<ArrayBuffer>('read_file', { path });

/** Saves ~/Pictures/Wallpapers/<stem>-stipple-<W>x<H>.png (suffixed on collision); the path back. */
export const savePng = (png: Uint8Array, stem: string, width: number, height: number) =>
  invoke<string>('save_png', png, {
    headers: { 'x-stem': encodeURIComponent(stem), 'x-size': `${width}x${height}` },
  });

/** Writes (or replaces) `<png stem>.stipple.json` next to a saved wallpaper. */
export const saveSidecar = (pngPath: string, json: string) =>
  invoke<string>('save_sidecar', { pngPath, json });

/** The textures under `.stipple/<stem>/` (src-tauri files.rs MOTION_FILES). */
export type MotionFile = 'frames' | 'glyphs' | 'night';

/** One motion texture of a saved wallpaper: `.stipple/<stem>/<name>.png`. */
export const saveField = (pngPath: string, rgb: Uint8Array, width: number, height: number, name: MotionFile) =>
  invoke<string>('save_field', rgb, {
    headers: { 'x-png-path': encodeURIComponent(pngPath), 'x-size': `${width}x${height}`, 'x-name': name },
  });

/** Remove the motion textures of a saved wallpaper other than `keep`. */
export const removeMotionFiles = (pngPath: string, keep: MotionFile[]) =>
  invoke<void>('remove_motion_files', { path: pngPath, keep });

export interface SidecarFile {
  json: string;
  /** In the output folder or the theme backgrounds: Save may update its sidecar in place. */
  editable: boolean;
}

/** The sidecar of a PNG, or null when it has none. */
export const readSidecar = (path: string) => invoke<SidecarFile | null>('read_sidecar', { path });

/** Remember the photo and settings the app is left with (~/.local/state/stipple/session.json). */
export const saveSession = (json: string) => invoke<void>('save_session', { json });

/** The session the app was last left with, or null. */
export const readSession = () => invoke<string | null>('read_session');

export const setWallpaper = (path: string) => invoke<SetResult>('set_wallpaper', { path });

export const addToThemeBackgrounds = (path: string) => invoke<string>('add_to_theme_backgrounds', { path });

export const themeColors = () => invoke<ThemeColors>('theme_colors');

/** The weather location for the Theme tab's sun, or null when none is set. */
export const sunLocation = () => invoke<SunLocation | null>('sun_location');

/** Switch Omarchy to the Stipple theme (keeping the background); true when it switched. */
export const useStippleTheme = () => invoke<boolean>('use_stipple_theme');

/** True inside the Tauri webview (false in a plain browser tab of the dev server). */
export const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
