# Stipple

Turn a photo into a text-art wallpaper (Braille dots or letters) and set it as the
Omarchy background in one click. The art is made by the [Typist](https://github.com/winchxyz/typist)
engine (vendored in `src/lib/typist`, MIT), laid out at exactly your monitor's resolution.

Omarchy's background renderer always crops to fill the screen, so a square picture loses a big
part of its height on a 16:9 screen. Stipple draws the wallpaper at exactly the output size
instead: the photo is cropped to the screen's shape (or to a rectangle you place) and the art
fills it exactly.

## Use

1. **Open a photo** (PNG, JPEG, WebP or Canon CR3 raw): the Open button, `O`, or drag and drop it onto the window.
2. Adjust it. The preview follows every control while you drag.
   - **Style**: Dots (Atkinson dithering) or Letters (Shape-aware or Density).
   - **Columns**: type a number (4–4096), or **Auto**. Rows follow from the crop.
   - **Tone**: Invert, Auto levels, Brightness, Contrast. Double-click a slider to reset it; click
     its value to type one.
   - **Crop** (`F`): move, zoom (wheel, `+`/`-`), rotate (`R`), Fit; Enter applies, Escape cancels.
   - **Wallpaper**: **Art area**: **Fill** (the whole screen) or **Custom**, a rectangle on the
     preview: drag it to move it, drag its edges or corners to resize it, scroll over it to scale
     it, double-click it to centre it. Ink, Paper and (Custom) Surround colours ("Invert rule" or
     the current Omarchy theme's colours), and eight **Riso inks** presets: light risograph inks on
     dark paper. With several monitors, which one the wallpaper is made for.
   - **Motion**: Twinkle, Columns (see
     [Animated wallpapers](#animated-wallpapers)). The preview plays it; the pause button shows
     the still.
3. **Save** (`S`) writes `~/Pictures/Wallpapers/<photo>-stipple-<W>x<H>.png` (never overwriting:
   `-2`, `-3`… on collision) and a `.stipple.json` next to it.
   Saving again after changing only the motion updates that file instead of making a new one.
   **Set as wallpaper** saves if needed and runs `omarchy theme bg set`, then checks that
   `omarchy theme bg current` names the new file.

A theme change or cycling backgrounds (`omarchy theme bg next`) replaces the wallpaper. After
Set, **Add to theme backgrounds** copies it into `~/.config/omarchy/backgrounds/<theme>/` so it
joins that theme's rotation.

| Key | Action |
| --- | --- |
| `O`, `Ctrl+O` | Open a photo |
| `Z` / `Shift+Z`, `Ctrl+Y` | Undo / redo |
| `[` `]` | One column fewer / more |
| `I` | Invert |
| `F` | Crop |
| `\` (hold) | Show the photo instead of the art |
| `S` | Save |

**Picks up where you left off**: Stipple remembers the open photo and every setting (in
`~/.local/state/stipple/session.json`, written at each change) and reopens them at the next launch.
The undo history starts fresh. If the photo has moved since, it starts empty and says so.

**Reopen** a saved wallpaper by opening its PNG: Stipple loads the photo it was made from with every
setting and the motion, so you can change the motion later (Save updates the file in place) or
make a new version from it (any other change saves a new file).

## Output format: PNG plus a JSON sidecar

- **PNG** is what Omarchy can set today and what `omarchy theme bg next` rotates through
  (jpg, jpeg, png, gif, bmp, webp). It is lossless, so the dots stay crisp.
- **`<name>.stipple.json`** keeps everything a later version needs to redraw the art without the
  photo: the grid (mode, cols, rows, one code point per cell as `lines` and `cp`), every setting
  (style, tone, crop: `crop.aspect` is the width / height it was cropped at), the wallpaper options,
  the layout (cell size and position), the source path and the engine commit.
  A future animated renderer can re-render, re-characterise or animate from this file alone.
- **`.stipple/<name>/field.png`** (Dots only) is the dot field the animated wallpaper reads: one
  pixel per dot, the saved dot in the red channel. It sits in a hidden
  folder so `omarchy theme bg next` never shows it. The sidecar (format `stipple/2`) also holds the
  motion.
- **`.stipple/<name>/frames.png`** and **`glyphs.png`** (Letters with Columns motion) are the
  keyframes: the engine converts the photo at **Smoothness** column counts spaced geometrically
  from From to To (fewer if all the cells would not fit a 4096 × 6000 texture), plus the saved
  count so the sweep starts on the PNG. The conversions run in parallel on up to 6 workers, and
  the app keeps each count it converted: a new From, To or Smoothness converts only the counts it
  adds, and **One cycle** (the pace) converts nothing. The sweep goes there and back at an even pace,
  so every keyframe shows for the same time. `frames.png` holds every
  keyframe's cells as one byte each (1 + the glyph's index, 0 blank), in shelves; `glyphs.png` has
  each letter used drawn once per power-of-two cell height (up to 256 px), three letters per texel
  (R, G, B). The shader draws any keyframe at full resolution from these two small images, looking
  at each pixel's cell and its 8 neighbours (letters overhang). The sidecar's `columns` holds each
  keyframe's layout and place in `frames.png`, and the atlas levels.
- **No SVG.** It can be regenerated from the JSON at any time; letters would need the font
  embedded; and an SVG would never be in Omarchy's rotation. (Whether `omarchy theme bg set`
  renders an SVG statically through qt6-svg was not tested.)

## How the layout works

- The canvas is exactly the output size: the monitor's physical resolution from
  `hyprctl monitors -j` (eDP-1 is 1920×1080 at scale 2 here).
- The art's area is the whole canvas (**Fill**) or the Custom rectangle. The photo is cropped to
  that area's shape, so the art covers it exactly (centred, integer-pixel offsets, clipped to it:
  only the rounding of the rows is cut). Around a Custom rectangle is the surround colour.
- Cells keep Typist's File-target aspect (Dots 0.75/1.3, Letters 0.6/1.3), so the art matches the
  Typist web app's proportions.
- **Auto columns** are derived from the output instead of Typist's fixed 48/72/56 (too coarse for a
  1080p screen): the column count whose cells come out about **15 px tall** on the wallpaper.
  Rows = art height / 15, columns = rows × crop aspect / cell aspect, clamped to 4–4096 (the saved
  dot field's 8192 px side). At 1920×1080 that is 222 columns for Dots.
- A change of the area's shape moves an upright crop just enough to keep it on the photo.
- The art is always laid out at the final size, never scaled afterwards. Paper fills everything
  behind and around it, so there is no seam.

## Speed

Measured in the app's own webview (WebKitGTK 2.52, this laptop), photo 512×600, dragging
Brightness one step per frame:

| Style | Grid | Conversion p50 / p95 | Preview draw p50 | Preview updates |
| --- | --- | --- | --- | --- |
| Dots | 150×87 | 20 / 42 ms | 9 ms | ~42 / s |
| Dots | 125×72 (1080p Auto) | 15 / 23 ms | 8 ms | ~37 / s |
| Letters | 150×69 | 61 / 379 ms | 5 ms | ~13 / s |

The window itself stays at ~57 fps in every style: conversion runs in a Web Worker
(`src/lib/engine/convert.worker.ts`), one job at a time, newest request first, and each finished
result is shown even if a newer one is on its way. Opening a photo shows the first Dots preview in
about 0.7 s.

What it took, measured, not guessed:

- **Drawing**: every canvas call is slow in WebKitGTK (about 7.5 µs per `fillText`, 150 µs per
  `drawImage`, and one path of 50,000 dots took 20 s to fill). The grid is rasterised in plain JS
  instead (`src/lib/rasterize.ts`, Typist's exact geometry) and put on the canvas once.
- **Tone**: Typist's looks recomputed their heavy filters on every slider step. They are now
  memoised per sample (`tone.js`, bit-identical output): a 150-column Dots drag went from 63 to
  20 ms per conversion.
- **Letters**: the glyph matcher's resample is folded into its circle weights (`ascii.js`).
- Letters is the slowest style. If it needs to be smoother, the Letters matcher and tone pipeline
  are the parts worth porting to Rust or WebAssembly.

## Build and run

Toolchain comes from the project's `mise.toml` (Rust stable, Bun 1.4.2).

```sh
bun install
bun tauri dev            # dev window with hot reload (and the dev bridge below)
bun run test             # layout math and the shader's JS mirror (bun test)
bun run test:engine      # the vendored Typist engine tests (node --test)
bun run check            # svelte-check, strict TypeScript
(cd src-tauri && cargo test && cargo clippy --all-targets)
bun tauri build --no-bundle
```

Install for the Omarchy launcher:

```sh
install -Dm755 src-tauri/target/release/stipple ~/.local/bin/stipple
install -Dm644 src-tauri/icons/128x128@2x.png ~/.local/share/icons/hicolor/256x256/apps/stipple.png
install -Dm644 assets/stipple.desktop ~/.local/share/applications/stipple.desktop
```

**Dev bridge**: in `bun tauri dev` only, `dev/tw.sh 'return TW.app.doc'` runs a snippet in the app
window and prints the answer (`src/lib/dev/hooks.ts` lists what `TW` offers, including a drag
benchmark, `TW.bench('ascii', 150)`). WebKit pauses animation frames while the window is on a hidden
workspace, so timings need it visible; `TW.timerFrames()` runs frames on a timer so scripts can
render a parked window anyway.

## Design notes

- **Stack**: Tauri + SvelteKit (Svelte 5, static SPA) + strict TypeScript + Bun. The engine is the
  browser JS Typist ships, run in the webview, wrapped by a typed layer (`src/lib/engine`).
- **Tauri 3 (alpha)** by choice instead of Tauri 2.
- **Rust commands** (`src-tauri/src/commands.rs`), and nothing broader: `monitors`, `read_file`
  (PNG/JPEG/WebP ≤ 64 MB; the dialog and drag-and-drop give paths, not bytes), `save_png` (raw
  body, checks the PNG is exactly W×H), `save_sidecar` (replaced atomically), `save_field` (raw RGB
  body, encoded as `field.png`, `frames.png` or `glyphs.png`), `remove_motion_files` (the ones a
  saved wallpaper no longer uses), `read_sidecar` (reopening), `save_session` / `read_session`
  (the last photo and settings, see above), `set_wallpaper` (only files in
  `~/Pictures/Wallpapers` or the theme backgrounds), `add_to_theme_backgrounds`, `theme_colors`.
  The capability grants exactly these plus drag-and-drop events and the open dialog; no fs or
  shell plugin, no `core:default`.
- `omarchy` is run from `$OMARCHY_PATH/bin` (else `/usr/share/omarchy/bin`, else PATH), with that
  directory first on the child's PATH: an app started from the launcher does not have it.
- Default colours follow Typist's rule: Invert off gives `#17171a` on `#ffffff`, Invert on gives
  `#f2f2f0` on `#111113`. The Wallpaper tab warns when custom colours would draw a negative.
- Engine changes are listed in `src/lib/typist/NOTICE`.

## Animated wallpapers

Omarchy's own background only shows a still picture, so the motion is drawn by a shell plugin,
`kivan.stipple` (`shell-plugin/kivan.stipple`), running inside omarchy-shell. It puts a surface on
the Bottom layer, above Omarchy's background and below every window, and ignores the mouse. It
shows only when the current background is a Stipple PNG whose sidecar turns motion on; for
anything else (`bg next`, a theme change, a plain picture, the plugin off) it hides and the PNG
underneath is the right still picture. A saved motion change reloads live.

| Effect | Needs | What moves |
| --- | --- | --- |
| Twinkle | Dots | a few dots blink, picked at random each tick |
| Columns | Letters | the column count sweeps From → To → From (any counts in 4–4096) |

Frame 0 of every effect is the saved PNG. Motion stops behind a fullscreen window, after 60 s
idle (screensaver, lock, screen off) and on `omarchy-shell stipple pause`; with windows open it
slows to 2 fps, and stops once windows and the bar cover 90% of the screen (only the gaps show).

One fragment shader draws each frame (`shaders/wall.frag`), and only when the picture changes:
on each Twinkle tick or Columns keyframe. `src/lib/motion.ts` is its JS mirror for the app's
preview, and the tests check the two agree.

Install or update the plugin (compiles the shader, links the folder into
`~/.config/omarchy/plugins`, enables it):

```sh
shell-plugin/install.sh
shell-plugin/install.sh --uninstall   # back to still wallpapers
omarchy-shell stipple status          # what it shows, fps, pause state
```

To work on it without touching the running shell:
`STIPPLE_CURRENT=<png> quickshell -p shell-plugin/dev` (stop with `quickshell kill -p shell-plugin/dev`).
