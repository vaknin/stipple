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

/** Writes `<dir>/.stipple/<stem>/field.png` from a packed RGB dot field (motion.packField). */
export const saveField = (pngPath: string, rgb: Uint8Array, width: number, height: number) =>
  invoke<string>('save_field', rgb, {
    headers: { 'x-png-path': encodeURIComponent(pngPath), 'x-size': `${width}x${height}` },
  });

export interface SidecarFile {
  json: string;
  /** In the output folder or the theme backgrounds: Save may update its sidecar in place. */
  editable: boolean;
}

/** The sidecar of a PNG, or null when it has none. */
export const readSidecar = (path: string) => invoke<SidecarFile | null>('read_sidecar', { path });

export const setWallpaper = (path: string) => invoke<SetResult>('set_wallpaper', { path });

export const addToThemeBackgrounds = (path: string) => invoke<string>('add_to_theme_backgrounds', { path });

export const themeColors = () => invoke<ThemeColors>('theme_colors');

/** True inside the Tauri webview (false in a plain browser tab of the dev server). */
export const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
