// Types for palette.mjs (the app imports it as $palette; the shell plugin uses the .mjs directly).

export type DayMode = 'off' | 'sky' | 'light' | 'warm' | 'custom';
export type Surface = 'paper' | 'deep' | 'tinted';

export interface ThemeOpts {
  day: DayMode;
  strength: number;
  nightInk: string | null;
  nightPaper: string | null;
  surface: Surface;
  wallpaper: boolean;
  apply: boolean;
}

export interface Sun { elevation: number; rising: boolean }
export interface WallColours { ink: string; paper: string; surround: string }
/** The hour's wallpaper colours and how far the art has turned over (flipAt). */
export interface HourColours extends WallColours { flip: number }
/** colors.toml keys: `mode` is 'light' | 'dark', every other value a colour string. */
export type Palette = Record<string, string>;

export const DAY_MODES: DayMode[];
export const SURFACES: Surface[];
export function defaultTheme(): ThemeOpts;
export function cleanTheme(raw: unknown): ThemeOpts;

export function hexRgb(h: string): [number, number, number];
export function rgbHex(c: [number, number, number]): string;
export function lab(h: string): [number, number, number];
export function labHex(L: number, a: number, b: number): string;
export function lch(h: string): [number, number, number];
export function lchHex(L: number, C: number, h: number): string;
export function mixLab(a: string, b: string, t: number): string;
export function mixHex(a: string, b: string, t: number): string;
export function luminance(h: string): number;
export function contrast(a: string, b: string): number;
export function deltaE(a: string, b: string): number;
export function readable(fg: string, bg: string, ratio: number, toward?: 0 | 1, oneSide?: boolean): string;

export function sun(date: Date, lat: number, lon: number): Sun;
export function clockSun(date: Date): Sun;
export function sunTimes(date: Date, lat: number, lon: number): { sunrise: Date | null; sunset: Date | null };
export function nightWeight(elevation: number): number;

export function lightInk(ink: string, paper: string): boolean;
export function flipAt(day: { ink: string; paper: string }, hour: { ink: string; paper: string }): number;
export function dayColours(colours: { ink: string; paper: string; surround?: string | null }, theme: unknown, sun: Sun): WallColours;
export function paletteFor(colours: { ink: string; paper: string }, theme: unknown): Palette;
export function colorsToml(p: Palette): string;
export function renderTemplate(tpl: string, p: Palette): string;
export function paletteDistance(p: Palette | null, q: Palette | null): number;
export function themeAt(colours: { ink: string; paper: string; surround?: string | null }, theme: unknown, sun: Sun): { wall: HourColours; palette: Palette };
export function needsNight(colours: { ink: string; paper: string; surround?: string | null }, theme: unknown): boolean;
