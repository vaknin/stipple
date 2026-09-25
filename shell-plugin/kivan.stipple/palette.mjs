// The Stipple theme's colours: a wallpaper's ink and paper, shifted with the sun, and the whole
// Omarchy palette (colors.toml, the shell's shell.toml) derived from them.
//
// One module for everyone: the shell plugin imports it (`import "palette.mjs" as Palette`), the
// app imports it through $palette, and src/lib/palette.test.ts checks it. Pure functions only, no
// I/O, and plain ES2017 so Qt's JS engine runs it too (no optional chaining, no object spread).
//
// Colour work is in OKLab / OKLCH (Björn Ottosson), so a shift of hue or lightness looks even.
// The time of day is the sun's elevation (NOAA's low-precision formula, ~0.1 deg), not the clock:
// dusk comes at dusk in every season.

// ------------------------------------------------------------------- options

export const DAY_MODES = ['off', 'sky', 'light', 'warm', 'custom'];
export const SURFACES = ['paper', 'deep', 'tinted'];

/**
 * The Theme settings a wallpaper's sidecar carries.
 *   day        how the colours follow the sun (DAY_MODES)
 *   strength   0-1, how far they go
 *   nightInk, nightPaper   Custom: the colours at night (null: the day colours swapped)
 *   surface    the bar and panels: the paper, a deeper paper, or paper tinted with the ink
 *   wallpaper  the wallpaper follows the sun too (false: only the desktop's colours do)
 *   apply      Set as wallpaper also switches Omarchy to the Stipple theme
 */
export function defaultTheme() {
  return { day: 'sky', strength: 0.7, nightInk: null, nightPaper: null, surface: 'paper', wallpaper: true, apply: true };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Theme settings from a sidecar (any older or partial form) over the defaults. */
export function cleanTheme(raw) {
  const d = defaultTheme();
  if (!raw || typeof raw !== 'object') return d;
  const hex = v => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null);
  const s = Number(raw.strength);
  return {
    day: DAY_MODES.indexOf(raw.day) >= 0 ? raw.day : d.day,
    strength: Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : d.strength,
    nightInk: hex(raw.nightInk),
    nightPaper: hex(raw.nightPaper),
    surface: SURFACES.indexOf(raw.surface) >= 0 ? raw.surface : d.surface,
    wallpaper: typeof raw.wallpaper === 'boolean' ? raw.wallpaper : d.wallpaper,
    apply: typeof raw.apply === 'boolean' ? raw.apply : d.apply,
  };
}

// ------------------------------------------------------------------ colour maths

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const RAD = Math.PI / 180;

export function hexRgb(h) {
  const n = parseInt(String(h).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbHex(c) {
  const b = x => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0');
  return '#' + b(c[0]) + b(c[1]) + b(c[2]);
}

const toLin = x => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const toGam = x => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

function linToLab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

function labToLin(L, a, b) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

/** OKLab [L, a, b] of a #rrggbb. */
export function lab(h) {
  const c = hexRgb(h);
  return linToLab(toLin(c[0]), toLin(c[1]), toLin(c[2]));
}

const inGamut = c => c[0] >= -1e-4 && c[0] <= 1.0001 && c[1] >= -1e-4 && c[1] <= 1.0001 && c[2] >= -1e-4 && c[2] <= 1.0001;

/** #rrggbb of an OKLab colour, keeping L and hue and giving up chroma until it fits sRGB. */
export function labHex(L, a, b) {
  L = clamp(L, 0, 1);
  let lin = labToLin(L, a, b);
  if (!inGamut(lin)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const k = (lo + hi) / 2;
      if (inGamut(labToLin(L, a * k, b * k))) lo = k; else hi = k;
    }
    lin = labToLin(L, a * lo, b * lo);
  }
  return rgbHex([toGam(clamp(lin[0], 0, 1)), toGam(clamp(lin[1], 0, 1)), toGam(clamp(lin[2], 0, 1))]);
}

/** OKLCH [L, C, h (deg)] of a #rrggbb. */
export function lch(h) {
  const c = lab(h);
  return [c[0], Math.hypot(c[1], c[2]), ((Math.atan2(c[2], c[1]) / RAD) + 360) % 360];
}

export function lchHex(L, C, h) {
  return labHex(L, C * Math.cos(h * RAD), C * Math.sin(h * RAD));
}

/** a mixed toward b by t, in OKLab. */
export function mixLab(a, b, t) {
  const x = lab(a), y = lab(b);
  return labHex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t));
}

/** a mixed toward b by t per sRGB channel, rounded as omarchy-theme-set-templates' mix_color. */
export function mixHex(a, b, t) {
  const x = hexRgb(a), y = hexRgb(b);
  const c = i => Math.floor(Math.round(x[i] * 255) * (1 - t) + Math.round(y[i] * 255) * t + 0.5);
  const h = v => clamp(v, 0, 255).toString(16).padStart(2, '0');
  return '#' + h(c(0)) + h(c(1)) + h(c(2));
}

/** WCAG relative luminance and contrast ratio. */
export function luminance(h) {
  const c = hexRgb(h);
  return 0.2126 * toLin(c[0]) + 0.7152 * toLin(c[1]) + 0.0722 * toLin(c[2]);
}

export function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Distance between two colours in OKLab (about 0.02 is just visible). */
export function deltaE(a, b) {
  const x = lab(a), y = lab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * `fg` with its lightness moved away from `bg` (keeping hue and chroma) until it reaches `ratio`,
 * toward white (`toward` 1) or black (0) first; by default away from the background.
 */
export function readable(fg, bg, ratio, toward, oneSide) {
  if (contrast(fg, bg) >= ratio) return fg;
  const f = lch(fg);
  const first = toward === 0 || toward === 1 ? toward : luminance(bg) < 0.18 ? 1 : 0;
  // move the lightness toward white or black, least move first: the side away from the background
  // first, the other side if that never gets there (a mid-tone background, unless `oneSide`), else
  // the best seen
  let best = fg, bestC = contrast(fg, bg);
  for (const end of oneSide ? [first] : [first, 1 - first]) {
    for (let i = 1; i <= 50; i++) {
      const c = lchHex(lerp(f[0], end, i / 50), f[1] * (1 - i / 100), f[2]);
      const k = contrast(c, bg);
      if (k >= ratio) return c;
      if (k > bestC) { best = c; bestC = k; }
    }
  }
  return best;
}

/** The shortest turn from hue a to hue b, in degrees. */
const turn = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

// ----------------------------------------------------------------------- sun

/**
 * The sun's elevation (deg) seen from lat, lon at `date`, and whether it is rising (morning).
 * NOAA's low-precision formula: good to about 0.1 deg, which is minutes at the horizon.
 */
export function sun(date, lat, lon) {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmst = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const ha = ((((gmst * 15 + lon - ra) % 360) + 540) % 360) - 180;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha * RAD)) / RAD;
  return { elevation: el, rising: ha < 0 };
}

/** Without a location: a sun that rises at 06:00 and sets at 18:00 local time, 60 deg at noon. */
export function clockSun(date) {
  const h = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  return { elevation: 60 * Math.sin(Math.PI * (h - 6) / 12), rising: h < 12 };
}

/** Sunrise and sunset (the upper limb at the horizon, -0.833 deg) on the local day of `date`; null when the sun stays up or down. */
export function sunTimes(date, lat, lon) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const at = m => sun(new Date(day + m * 60000), lat, lon).elevation + 0.833;
  const find = (a, b) => {
    for (let i = 0; i < 30; i++) {
      const m = (a + b) / 2;
      if ((at(a) < 0) === (at(m) < 0)) a = m; else b = m;
    }
    return new Date(day + ((a + b) / 2) * 60000);
  };
  let rise = null, set = null;
  for (let m = 0; m < 1440; m += 10) {
    const a = at(m), b = at(m + 10);
    if (a < 0 && b >= 0 && !rise) rise = find(m, m + 10);
    if (a >= 0 && b < 0 && !set) set = find(m, m + 10);
  }
  return { sunrise: rise, sunset: set };
}

// ------------------------------------------------------------ colours of the hour

// A shift is how a key moment of the day changes the colours:
//   pl, il   lightness multiplier of the paper and of the ink
//   ph, pa   the hue the paper is tinted toward and how far (0-1)
//   ih, ia   the same for the ink
//   c        chroma multiplier of both
// Every mode lists shifts at a few sun elevations; between two the shift is interpolated, and above
// the last one the colours are the wallpaper's own. Dawn and dusk (rising or not) have their own lists.
const ID = { pl: 1, il: 1, ph: 0, pa: 0, ih: 0, ia: 0, c: 1 };
const S = o => Object.assign({}, ID, o);

const KEYS = {
  sky: {
    dawn: [
      [-18, S({ pl: 0.72, il: 0.74, ph: 265, pa: 0.55, ih: 250, ia: 0.35, c: 0.85 })],
      [-8, S({ pl: 0.84, il: 0.88, ph: 280, pa: 0.45, ih: 300, ia: 0.25, c: 0.9 })],
      [0, S({ pl: 1.0, il: 1.02, ph: 10, pa: 0.35, ih: 30, ia: 0.3 })],
      [8, S({ pl: 1.02, il: 1.03, ph: 60, pa: 0.15, ih: 50, ia: 0.12 })],
      [18, ID],
    ],
    dusk: [
      [-18, S({ pl: 0.72, il: 0.74, ph: 265, pa: 0.55, ih: 250, ia: 0.35, c: 0.85 })],
      [-8, S({ pl: 0.82, il: 0.86, ph: 290, pa: 0.5, ih: 320, ia: 0.3, c: 0.95 })],
      [0, S({ pl: 0.96, il: 1.0, ph: 35, pa: 0.4, ih: 50, ia: 0.4, c: 1.05 })],
      [8, S({ pl: 1.0, il: 1.02, ph: 60, pa: 0.2, ih: 60, ia: 0.18 })],
      [18, ID],
    ],
  },
  light: {
    dawn: [[-14, S({ pl: 0.72, il: 0.7, c: 0.8 })], [-4, S({ pl: 0.85, il: 0.85, c: 0.9 })], [6, S({ pl: 0.95, il: 0.96 })], [16, ID]],
    dusk: [[-14, S({ pl: 0.72, il: 0.7, c: 0.8 })], [-4, S({ pl: 0.85, il: 0.85, c: 0.9 })], [6, S({ pl: 0.95, il: 0.96 })], [16, ID]],
  },
  warm: {
    dawn: [[-14, S({ pl: 0.8, il: 0.82, ph: 55, pa: 0.12, ih: 60, ia: 0.18 })], [-2, S({ pl: 0.92, il: 0.95, ph: 55, pa: 0.06, ih: 60, ia: 0.08 })], [10, ID]],
    dusk: [[-14, S({ pl: 0.8, il: 0.82, ph: 55, pa: 0.15, ih: 60, ia: 0.22 })], [-2, S({ pl: 0.94, il: 0.97, ph: 50, pa: 0.18, ih: 60, ia: 0.3 })], [10, S({ ph: 55, pa: 0.06, ih: 60, ia: 0.1 })], [20, ID]],
  },
};

/** The shift for a sun elevation from a mode's list. */
function shiftAt(keys, el) {
  if (el <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (el <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      const t = smooth((el - a[0]) / (b[0] - a[0]));
      const x = a[1], y = b[1];
      // a key with no tint takes the other's hue, so a fading tint never swings through the wheel
      const hue = (h0, a0, h1, a1) => (a0 === 0 ? h1 : a1 === 0 ? h0 : h0 + turn(h0, h1) * t);
      return {
        pl: lerp(x.pl, y.pl, t), il: lerp(x.il, y.il, t), c: lerp(x.c, y.c, t),
        ph: hue(x.ph, x.pa, y.ph, y.pa), pa: lerp(x.pa, y.pa, t),
        ih: hue(x.ih, x.ia, y.ih, y.ia), ia: lerp(x.ia, y.ia, t),
      };
    }
  }
  return ID;
}

/** A colour with its lightness scaled, chroma scaled, and tinted toward `hue` by `amount`. */
function shifted(h, lMul, cMul, hue, amount) {
  const c = lab(h);
  let a = c[1] * cMul, b = c[2] * cMul;
  if (amount > 0) {
    // tint in the a/b plane: works for greys too, which have no hue of their own
    const chroma = Math.max(Math.hypot(a, b), 0.05);
    a = lerp(a, chroma * Math.cos(hue * RAD), amount);
    b = lerp(b, chroma * Math.sin(hue * RAD), amount);
  }
  return labHex(c[0] * lMul, a, b);
}

/** How much of the night it is for Custom: 1 below -12 deg, 0 above +6, eased in between. */
export function nightWeight(el) {
  return 1 - smooth((el + 12) / 18);
}

/**
 * Which way the art is drawn for these colours: true for ink lighter than the paper (the ink stands
 * for the photo's light parts: the engine's invert), false for darker ink (the dark parts).
 */
export function lightInk(ink, paper) {
  return lab(ink)[0] > lab(paper)[0];
}

/**
 * How far the hour's colours have turned the art over (0: the day's grid, 1: the one drawn the
 * other way round): a smoothstep over a narrow band of lightness where ink and paper cross, so
 * the switch happens while there is almost no contrast to see it by.
 */
export function flipAt(day, hour) {
  const d0 = lab(day.ink)[0] - lab(day.paper)[0];
  const band = Math.min(0.04, Math.abs(d0) / 2);
  if (band < 1e-4) return 0;
  const d = (lab(hour.ink)[0] - lab(hour.paper)[0]) * (d0 > 0 ? 1 : -1);
  return 1 - smooth((d + band) / (2 * band));
}

/**
 * The wallpaper's colours at a sun position: { ink, paper, surround } from the wallpaper's own
 * (surround null or equal to the paper follows the paper) and the Theme settings.
 */
export function dayColours(colours, theme, sunNow) {
  const t = cleanTheme(theme);
  const ink = colours.ink, paper = colours.paper;
  const surround = colours.surround && String(colours.surround).toLowerCase() !== String(paper).toLowerCase() ? colours.surround : null;
  const s = t.strength;
  let out;
  if (t.day === 'custom') {
    const w = nightWeight(sunNow.elevation) * s;
    const nInk = t.nightInk || paper, nPaper = t.nightPaper || ink;
    out = { ink: mixLab(ink, nInk, w), paper: mixLab(paper, nPaper, w), surround: surround ? mixLab(surround, nPaper, w) : null };
  } else if (KEYS[t.day]) {
    const k = shiftAt(sunNow.rising ? KEYS[t.day].dawn : KEYS[t.day].dusk, sunNow.elevation);
    const pl = lerp(1, k.pl, s), il = lerp(1, k.il, s), c = lerp(1, k.c, s);
    out = {
      ink: shifted(ink, il, c, k.ih, k.ia * s),
      paper: shifted(paper, pl, c, k.ph, k.pa * s),
      surround: surround ? shifted(surround, pl, c, k.ph, k.pa * s) : null,
    };
  } else {
    out = { ink: ink.toLowerCase(), paper: paper.toLowerCase(), surround: surround ? surround.toLowerCase() : null };
  }
  // the art must stay legible: keep at least the day's contrast, up to 3:1, on the day's side of the
  // paper (the art never turns over). Not for Custom: a night on the other side of the day's colours
  // crosses them, and the plugin switches to the grid drawn the other way round there (flipAt)
  out.ink = t.day === 'custom' ? out.ink
    : readable(out.ink, out.paper, Math.min(3, contrast(ink, paper)), lightInk(ink, paper) ? 1 : 0, true);
  if (!out.surround) out.surround = out.paper;
  return out;
}

// ------------------------------------------------------------------- palette

// The terminal colours: named hues, re-toned for the paper and turned a little toward the ink.
const ANSI = [
  ['red', 25], ['orange', 55], ['yellow', 90], ['green', 145],
  ['cyan', 195], ['blue', 250], ['magenta', 330],
];

/**
 * The whole Omarchy palette (colors.toml keys) for a wallpaper's ink and paper, already shifted
 * for the hour. The ink is the accent; text is a quiet colour of the ink's hue that reads at 7:1.
 * Light or dark follows the paper: when the hour takes it across a mid grey (Custom between a
 * light day and a dark night) the palette switches over once, as a light / dark theme change would;
 * no text colour reads on a mid grey, so there is no smooth way across.
 */
export function paletteFor(colours, theme) {
  const t = cleanTheme(theme);
  const paper = lch(colours.paper);
  const light = paper[0] > 0.62;
  const dir = light ? -1 : 1; // toward more contrast

  let bg;
  if (t.surface === 'deep') bg = lchHex(paper[0] - dir * 0.05, paper[1] * 0.9, paper[2]);
  else if (t.surface === 'tinted') bg = mixLab(colours.paper, colours.ink, 0.12);
  else bg = colours.paper.toLowerCase();
  // a mid-tone paper cannot carry 7:1 text: deepen (or, light, lighten) the surface until white (or
  // black) text can, so the surface moves smoothly with the paper until the switch-over
  for (let i = 0; i < 40 && contrast(light ? '#000000' : '#ffffff', bg) < 7.6; i++) {
    const c = lch(bg);
    bg = lchHex(c[0] - dir * 0.015, c[1], c[2]);
  }
  const b = lch(bg);
  const bgShade = d => lchHex(b[0] + d, b[1], b[2]);

  const up = light ? 0 : 1;
  const accent = readable(colours.ink.toLowerCase(), bg, 3, up);
  const a = lch(accent);
  const fg = readable(lchHex(light ? 0.28 : 0.9, Math.min(a[1], 0.035), a[2]), bg, 7, up);
  const f = lch(fg);

  const p = {
    mode: light ? 'light' : 'dark',
    accent: accent,
    selection: mixLab(bg, accent, 0.28),
    muted: mixLab(fg, bg, 0.55),
    background: bg,
    dark_background: bgShade(light ? -0.04 : -0.025),
    darker_background: bgShade(light ? -0.08 : -0.05),
    lighter_background: mixLab(bgShade(dir * 0.06), accent, 0.08),
    foreground: fg,
    dark_foreground: mixLab(fg, bg, 0.45),
    light_foreground: mixLab(fg, accent, 0.3),
    bright_foreground: lchHex(f[0] + dir * 0.05, f[1], f[2]),
  };

  const baseL = light ? 0.5 : 0.72, baseC = 0.13;
  for (let i = 0; i < ANSI.length; i++) {
    const name = ANSI[i][0], hue = ANSI[i][1] + turn(ANSI[i][1], a[2]) * 0.12;
    p[name] = readable(lchHex(baseL, baseC, hue), bg, 4.5, up);
    if (name !== 'orange') p['bright_' + name] = readable(lchHex(baseL + dir * 0.08, baseC + 0.02, hue), bg, 4.5, up);
  }
  p.brown = lchHex(light ? 0.42 : 0.4, 0.07, 50);
  p.hyprland_inactive_border = 'rgba(' + mixLab(bg, fg, 0.25).slice(1) + 'aa)';
  return p;
}

/** The order colors.toml lists its keys in (as the stock themes do). */
const ORDER = [
  'mode', null, 'accent', 'selection', 'muted', null,
  'background', 'dark_background', 'darker_background', 'lighter_background', null,
  'foreground', 'dark_foreground', 'light_foreground', 'bright_foreground', null,
  'red', 'yellow', 'orange', 'green', 'cyan', 'blue', 'magenta', 'brown', null,
  'bright_red', 'bright_yellow', 'bright_green', 'bright_cyan', 'bright_blue', 'bright_magenta', null,
  'hyprland_inactive_border',
];

/** A palette as colors.toml. */
export function colorsToml(p) {
  const lines = ['# Written by Stipple (kivan.stipple) from the current wallpaper and the sun.', '# It is rewritten through the day: edit the wallpaper\'s Theme tab instead.', ''];
  for (let i = 0; i < ORDER.length; i++) {
    const k = ORDER[i];
    if (k === null) lines.push('');
    else if (p[k] !== undefined) lines.push(k + ' = "' + p[k] + '"');
  }
  return lines.join('\n') + '\n';
}

/**
 * An Omarchy template (default/themed/*.tpl) filled from a palette, as omarchy-theme-set-templates
 * does: {{ key }}, {{ key_strip }}, {{ key_rgb }}, {{ mix a b N% }} (and _strip, _rgb) and the
 * gradient functions. Enough for shell.toml.tpl, which is what the plugin renders live.
 */
export function renderTemplate(tpl, p) {
  const rgb = h => { const c = hexRgb(h); return Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255); };
  const ref = (k, fb) => (p[k] !== undefined ? p[k] : fb !== undefined && p[fb] !== undefined ? p[fb] : fb);
  const parts = spec => {
    const colors = [];
    let angle = '';
    String(spec).split(/\s+/).forEach(x => {
      if (!x) return;
      if (/^-?\d+(\.\d+)?deg$/.test(x)) angle = x.slice(0, -3);
      else colors.push(p[x] !== undefined ? p[x] : x);
    });
    return { colors: colors, angle: angle };
  };
  return String(tpl).replace(/\{\{\s*([^}]*?)\s*\}\}/g, (all, body) => {
    const w = body.split(/\s+/);
    let m;
    if ((m = /^mix(_strip|_rgb)?$/.exec(w[0])) && w.length === 4) {
      const x = p[w[1]], y = p[w[2]];
      if (!HEX.test(String(x)) || !HEX.test(String(y))) return all;
      let amt = parseFloat(w[3]);
      if (/%$/.test(w[3]) || amt > 1) amt /= 100;
      const v = mixHex(x, y, clamp(amt, 0, 1));
      return m[1] === '_strip' ? v.slice(1) : m[1] === '_rgb' ? rgb(v) : v;
    }
    if (w[0] === 'shell_gradient' || w[0] === 'hypr_gradient' || w[0] === 'gradient_start') {
      const spec = ref(w[1], w[2]);
      const g = parts(spec);
      if (!g.colors.length) return spec;
      if (w[0] === 'gradient_start') return g.colors[0];
      if (w[0] === 'shell_gradient') return g.colors.join(' ') + (g.angle ? ' ' + g.angle + 'deg' : '');
      if (g.colors.length === 1) return '"' + g.colors[0] + '"';
      return '{ colors = { ' + g.colors.map(c => '"' + c + '"').join(', ') + ' }' + (g.angle ? ', angle = ' + g.angle : '') + ' }';
    }
    if (w.length === 1) {
      const k = w[0];
      if (p[k] !== undefined) return p[k];
      const s = /^(.*)_(strip|rgb)$/.exec(k);
      if (s && p[s[1]] !== undefined) return s[2] === 'strip' ? String(p[s[1]]).replace('#', '') : HEX.test(p[s[1]]) ? rgb(p[s[1]]) : all;
    }
    return all;
  });
}

/** How far two palettes are apart: the largest OKLab distance over the colours that show most. */
export function paletteDistance(p, q) {
  if (!p || !q) return Infinity;
  const keys = ['background', 'foreground', 'accent', 'red', 'blue', 'green'];
  let d = 0;
  for (let i = 0; i < keys.length; i++) d = Math.max(d, deltaE(p[keys[i]], q[keys[i]]));
  return d;
}

/**
 * Everything at once: the wallpaper's colours for now (or its own, when the wallpaper does not
 * follow the sun) and the palette, which always follows it.
 */
export function themeAt(colours, theme, sunNow) {
  const t = cleanTheme(theme);
  const day = dayColours(colours, t, sunNow);
  const own = dayColours(colours, Object.assign({}, t, { day: 'off' }), sunNow);
  const wall = t.wallpaper ? day : own;
  return { wall: Object.assign({}, wall, { flip: t.wallpaper ? flipAt(colours, day) : 0 }), palette: paletteFor(day, t) };
}

/**
 * Whether the wallpaper's colours cross over at some hour (flipAt above 0), so it needs the grid
 * drawn the other way round too. Sampled every degree of the sun's height, morning and evening.
 */
export function needsNight(colours, theme) {
  const t = cleanTheme(theme);
  if (!t.wallpaper || t.day === 'off') return false;
  for (let el = -25; el <= 25; el++) {
    for (let r = 0; r < 2; r++) {
      if (flipAt(colours, dayColours(colours, t, { elevation: el, rising: r === 0 })) > 0) return true;
    }
  }
  return false;
}
