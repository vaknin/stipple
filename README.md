# Typist Wall

Turn a photo into a text-art wallpaper (Braille dots, letters or blocks) and set it as the
Omarchy background in one click. The art is made by the [Typist](https://github.com/winchxyz/typist)
engine (vendored in `src/lib/typist`, MIT), laid out at exactly your monitor's resolution.

Omarchy's background renderer always crops to fill the screen, so a square picture loses a big
part of its height on a 16:9 screen. Typist Wall draws the wallpaper at exactly the output size
instead, with the art fitted (or filled) and the rest in the paper colour, so nothing is cropped.

## Use

1. **Open a photo** (PNG, JPEG or WebP): the Open button, `O`, or drag and drop it onto the window.
2. Adjust it. The preview follows every control while you drag.
   - **Look**: Photo, Texture, Sketch, Soft, Poster (thumbnails are made from your photo).
   - **Style**: Dots, Letters or Blocks, with Dithering (Atkinson, Floyd–Steinberg, Ordered,
     Threshold), Letters (Shape-aware, Density), Blocks (Quarters, Halves, Colour).
   - **Columns**: type a number (4–200), or **Auto**. Rows follow from the crop.
   - **Tone**: Invert, Auto levels, Brightness, Contrast, Gamma, Detail, Edges. Double-click a
     slider to reset it; click its value to type one.
   - **Crop** (`F`): move, zoom (wheel, `+`/`-`), rotate (`R`), Fit; Enter applies, Escape cancels.
   - **Wallpaper**: output size (your monitors from Hyprland, or any W × H), Fit or Fill, Margin,
     **Crop to screen aspect**, Ink and Paper colours ("Invert rule" or the current Omarchy theme's
     colours).
3. **Save** (`S`) writes `~/Pictures/Wallpapers/<photo>-typist-<W>x<H>.png` (never overwriting:
   `-2`, `-3`… on collision) and a `.typist.json` next to it.
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

## Output format: PNG plus a JSON sidecar

- **PNG** is what Omarchy can set today and what `omarchy theme bg next` rotates through
  (jpg, jpeg, png, gif, bmp, webp). It is lossless, so the dots stay crisp.
- **`<name>.typist.json`** keeps everything a later version needs to redraw the art without the
  photo: the grid (mode, cols, rows, one code point per cell as `lines` and `cp`, per-cell `fg` /
  `bg` for colour blocks), every Typist setting (look, style, dither, tone, crop: with Crop to
  screen aspect on, `crop.aspect` is the width / height it was cropped at), the wallpaper options,
  the layout (cell size and position), the source path and the engine commit.
  A future animated renderer can re-render, re-characterise or animate from this file alone.
- **No SVG.** It can be regenerated from the JSON at any time; letters would need the font
  embedded; and an SVG would never be in Omarchy's rotation. (Whether `omarchy theme bg set`
  renders an SVG statically through qt6-svg was not tested.)

## How the layout works

- The canvas is exactly the output size (default: the focused monitor's physical resolution from
  `hyprctl monitors -j`; eDP-1 is 1920×1080 at scale 2 here).
- **Margin** is a share of the shorter side, kept as paper on every side.
- **Fit**: the whole art, centred in the space inside the margin (integer-pixel offsets, centred
  within 1 px). **Fill**: the art covers that space and is clipped to it.
- Cells keep Typist's File-target aspect (Dots 0.75/1.3, Letters 0.6/1.3, Blocks 0.6/1.2), so the
  art matches the Typist web app's proportions.
- **Auto columns** are derived from the output instead of Typist's fixed 48/72/56 (too coarse for a
  1080p screen): the column count whose cells come out about **15 px tall** on the wallpaper.
  Rows = art height / 15, columns = rows / cell aspect, clamped to 4–200. At 1920×1080 that is 125
  columns for Dots (the hand-made reference used about 125), 156 for Letters and 144 for Blocks.
- **Crop to screen aspect** (off by default: the crop is square, as in Typist) crops the photo to
  the shape of the space inside the margin, so the art fills the screen instead of leaving paper at
  the sides. The crop follows the output size and margin. Rows = columns × cell aspect / crop
  aspect, and Auto columns use the art's height (the inner height, or its width / aspect if that is
  smaller). On a 16:9 screen that asks for more than 200 columns, so Auto is capped there: at
  1920×1080 Dots comes out 200×65, cells ~16.6 px tall. Turning it on moves an upright crop just
  enough to keep it on the photo.
- The art is always laid out at the final size, never scaled afterwards. Paper fills everything
  behind and around it, so there is no seam.

## Speed

Measured in the app's own webview (WebKitGTK 2.52, this laptop), photo 512×600, dragging
Brightness one step per frame:

| Style | Grid | Conversion p50 / p95 | Preview draw p50 | Preview updates |
| --- | --- | --- | --- | --- |
| Dots | 150×87 | 20 / 42 ms | 9 ms | ~42 / s |
| Dots | 125×72 (1080p Auto) | 15 / 23 ms | 8 ms | ~37 / s |
| Blocks | 150×75 | 9 / 10 ms | 13 ms | ~29 / s |
| Colour blocks | 150×75 | 34 / 54 ms | 20 ms | ~25 / s |
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
bun run test             # layout math (bun test)
bun run test:engine      # the vendored Typist engine tests (node --test)
bun run check            # svelte-check, strict TypeScript
(cd src-tauri && cargo test && cargo clippy --all-targets)
bun tauri build --no-bundle
```

Install for the Omarchy launcher:

```sh
install -Dm755 src-tauri/target/release/typist-wall ~/.local/bin/typist-wall
install -Dm644 src-tauri/icons/128x128@2x.png ~/.local/share/icons/hicolor/256x256/apps/typist-wall.png
install -Dm644 assets/typist-wall.desktop ~/.local/share/applications/typist-wall.desktop
```

**Dev bridge**: in `bun tauri dev` only, `dev/tw.sh 'return TW.app.doc'` runs a snippet in the app
window and prints the answer (`src/lib/dev/hooks.ts` lists what `TW` offers, including a drag
benchmark, `TW.bench('ascii', 150)`). WebKit pauses animation frames while the window is on a hidden
workspace, so timings need it visible.

## Design notes

- **Stack**: Tauri + SvelteKit (Svelte 5, static SPA) + strict TypeScript + Bun. The engine is the
  browser JS Typist ships, run in the webview, wrapped by a typed layer (`src/lib/engine`).
- **Tauri 3 (alpha)** by choice instead of Tauri 2.
- **Rust commands** (`src-tauri/src/commands.rs`), and nothing broader: `monitors`, `read_file`
  (PNG/JPEG/WebP ≤ 64 MB; the dialog and drag-and-drop give paths, not bytes), `save_png` (raw
  body, checks the PNG is exactly W×H), `save_sidecar`, `set_wallpaper` (only files in
  `~/Pictures/Wallpapers` or the theme backgrounds), `add_to_theme_backgrounds`, `theme_colors`.
  The capability grants exactly these plus drag-and-drop events and the open dialog; no fs or
  shell plugin, no `core:default`.
- `omarchy` is run from `$OMARCHY_PATH/bin` (else `/usr/share/omarchy/bin`, else PATH), with that
  directory first on the child's PATH: an app started from the launcher does not have it.
- Default colours follow Typist's rule: Invert off gives `#17171a` on `#ffffff`, Invert on gives
  `#f2f2f0` on `#111113`. The Wallpaper tab warns when custom colours would draw a negative.
- Engine changes are listed in `src/lib/typist/NOTICE`.

## Animated wallpapers later

Not in v1. What is known:

- Omarchy's background is a plain QML `Image` (not `AnimatedImage`) with `PreserveAspectCrop`
  hard-coded in `/usr/share/omarchy/shell/plugins/background/Background.qml`, so it only ever shows
  a static frame; an animated GIF or WebP would show its first frame.
- A moving wallpaper therefore needs its own renderer on the background layer, not
  `omarchy theme bg set`: a user shell plugin under `~/.config/omarchy/plugins/`, or a separate
  layer-shell process (for example a small Rust client drawing the grid).
- The `.typist.json` sidecar is the input such a renderer needs: the grid, its layout and colours,
  and the settings to re-run the engine (characters that change over time, a slow drift of the
  tone, a re-crop).
