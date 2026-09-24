<script lang="ts">
  import { fileColours } from '../engine/engine';
  import { boxPx, clampBox, MARGIN_MAX, type Box, type Placement } from '../layout';
  import { luminance } from '../render';
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';
  import Seg from './Seg.svelte';
  import Slider from './Slider.svelte';
  import Switch from './Switch.svelte';

  const SIZE_MIN = 16, SIZE_MAX = 16384;
  const w = $derived(app.wall);

  function setSize(width: number, height: number, label = 'Output size') {
    if (width === w.width && height === w.height) return;
    app.wall.width = width;
    app.wall.height = height;
    app.commit(label);
  }

  function field(which: 'width' | 'height', raw: string) {
    const v = Math.round(Number(raw));
    if (!Number.isFinite(v)) return;
    const c = Math.max(SIZE_MIN, Math.min(SIZE_MAX, v));
    if (which === 'width') setSize(c, w.height);
    else setSize(w.width, c);
  }

  // ---- the art's box: stored as fractions of the screen, edited in pixels
  const boxRect = $derived(w.box ? boxPx(w.box, w.width, w.height) : null);

  function setBox(b: Box | null, label: string) {
    app.wall.box = b ? clampBox(b, 16 / Math.min(w.width, w.height)) : null;
    app.commit(label);
  }

  function useBox(on: boolean) {
    if (on === !!w.box) return;
    setBox(on ? { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } : null, on ? 'Art box' : 'Whole screen');
  }

  /** A pixel field of the box: size keeps the centre, position moves the top-left. */
  function boxField(which: 'w' | 'h' | 'x' | 'y', raw: string) {
    const b = w.box, r = boxRect;
    const v = Math.round(Number(raw));
    if (!b || !r || !Number.isFinite(v)) return;
    const W = w.width, H = w.height;
    if (which === 'w') setBox({ ...b, w: v / W, x: b.x + (b.w - v / W) / 2 }, 'Art box size');
    else if (which === 'h') setBox({ ...b, h: v / H, y: b.y + (b.h - v / H) / 2 }, 'Art box size');
    else if (which === 'x') setBox({ ...b, x: v / W }, 'Move art');
    else setBox({ ...b, y: v / H }, 'Move art');
  }

  function centreBox() {
    const b = w.box;
    if (b) setBox({ ...b, x: (1 - b.w) / 2, y: (1 - b.h) / 2 }, 'Centre art');
  }

  const rule = $derived(fileColours(app.doc.tone.invert));
  const custom = $derived(w.ink != null || w.paper != null);
  const customSurround = $derived(w.surround != null && w.surround !== app.colours.paper);
  // ink lighter than paper without invert (or darker with it) draws a negative of the photo
  const negative = $derived.by(() => {
    if (app.colourBlocks) return false;
    const li = luminance(app.colours.ink), lp = luminance(app.colours.paper);
    return app.doc.tone.invert ? li < lp : li > lp;
  });
  const isTheme = $derived(!!app.theme && w.ink === app.theme.foreground && w.paper === app.theme.background);

  function useTheme() {
    if (!app.theme) return;
    app.wall.ink = app.theme.foreground;
    app.wall.paper = app.theme.background;
    app.commit('Theme colours');
  }

  function resetColours() {
    app.wall.ink = null;
    app.wall.paper = null;
    app.commit('Colours');
  }
</script>

<div class="field">
  <div class="label">Output size</div>
  {#if app.monitors.length}
    <div class="presets">
      {#each app.monitors as m (m.name)}
        <button
          type="button"
          aria-pressed={w.width === m.width && w.height === m.height}
          title={`${m.description || m.name} · ${m.width}×${m.height} physical pixels at scale ${m.scale}${m.focused ? ' · focused' : ''}`}
          onclick={() => setSize(m.width, m.height, 'Screen')}
        >
          <Icon name="monitor" size={14} />
          <span>{m.name}</span>
          <span class="num dim">{m.width}×{m.height}</span>
        </button>
      {/each}
    </div>
  {/if}
  <div class="wh">
    <input
      type="number"
      aria-label="Width in pixels"
      min={SIZE_MIN}
      max={SIZE_MAX}
      value={w.width}
      onchange={e => field('width', e.currentTarget.value)}
    />
    <span class="dim">×</span>
    <input
      type="number"
      aria-label="Height in pixels"
      min={SIZE_MIN}
      max={SIZE_MAX}
      value={w.height}
      onchange={e => field('height', e.currentTarget.value)}
    />
    <span class="dim">px</span>
  </div>
</div>

<div class="field">
  <div class="label">Art area</div>
  <Seg
    label="Art area"
    value={w.box ? 'box' : 'screen'}
    options={[
      { value: 'screen', label: 'Whole screen', hint: 'The art uses the screen inside the margin' },
      { value: 'box', label: 'Box', hint: 'The art sits in a box you size and place; the surround colour is around it' },
    ]}
    onpick={v => useBox(v === 'box')}
  />
  {#if w.box && boxRect}
    <div class="grid2">
      <label class="lf">
        <span class="dim">Size</span>
        <span class="wh">
          <input type="number" aria-label="Box width in pixels" min="16" max={w.width} value={boxRect.w}
            onchange={e => boxField('w', e.currentTarget.value)} />
          <span class="dim">×</span>
          <input type="number" aria-label="Box height in pixels" min="16" max={w.height} value={boxRect.h}
            onchange={e => boxField('h', e.currentTarget.value)} />
        </span>
      </label>
      <label class="lf">
        <span class="dim">Position</span>
        <span class="wh">
          <input type="number" aria-label="Box left edge in pixels" min="0" max={w.width - boxRect.w} value={boxRect.x}
            onchange={e => boxField('x', e.currentTarget.value)} />
          <span class="dim">,</span>
          <input type="number" aria-label="Box top edge in pixels" min="0" max={w.height - boxRect.h} value={boxRect.y}
            onchange={e => boxField('y', e.currentTarget.value)} />
        </span>
      </label>
    </div>
    <div class="row">
      <button type="button" onclick={centreBox}><Icon name="monitor" size={14} /> Centre</button>
    </div>
    <p class="hint">Drag the art in the preview to move it. Scroll over it to resize.</p>
  {/if}
</div>

<div class="field">
  <div class="label">Placement</div>
  <Seg
    label="Placement"
    value={w.placement}
    options={[
      { value: 'fit', label: 'Fit', hint: 'The whole art, centred, paper around it' },
      { value: 'fill', label: 'Fill', hint: 'Cover the screen, cropping the art' },
    ] satisfies { value: Placement; label: string; hint: string }[]}
    onpick={v => { app.wall.placement = v; app.commit('Placement'); }}
  />
  {#if !w.box}
  <Slider
    label="Margin"
    min={0}
    max={MARGIN_MAX}
    step={0.5}
    value={w.marginPct}
    def={0}
    format={v => `${v}%`}
    oninput={v => { app.wall.marginPct = v; }}
    oncommit={v => { app.wall.marginPct = v; app.commit('Margin'); }}
  />
  {/if}
  <Switch
    label="Crop to screen aspect"
    checked={w.cropToScreen}
    disabled={app.cropping}
    hint={w.box ? "Crop the photo to the box's shape so the art fills it; square when off" : "Crop the photo to the screen's shape (inside the margin) so the art fills it; square when off"}
    onchange={on => app.setCropToScreen(on)}
  />
</div>

<div class="field">
  <div class="label">Colours</div>
  <div class="colours">
    <label class="swatch" class:off={app.colourBlocks} title={app.colourBlocks ? 'Colour blocks take their colours from the photo' : 'Ink'}>
      <input
        type="color"
        value={app.colours.ink}
        disabled={app.colourBlocks}
        oninput={e => { app.wall.ink = e.currentTarget.value; }}
        onchange={e => { app.wall.ink = e.currentTarget.value; app.commit('Ink'); }}
      />
      <span>Ink</span>
      <span class="num dim">{app.colours.ink}</span>
    </label>
    <label class="swatch" title="Paper: the background around and behind the art">
      <input
        type="color"
        value={app.colours.paper}
        oninput={e => { app.wall.paper = e.currentTarget.value; }}
        onchange={e => { app.wall.paper = e.currentTarget.value; app.commit('Paper'); }}
      />
      <span>Paper</span>
      <span class="num dim">{app.colours.paper}</span>
    </label>
    <label class="swatch" title="Surround: outside the art's box or margin">
      <input
        type="color"
        value={app.colours.surround}
        oninput={e => { app.wall.surround = e.currentTarget.value; }}
        onchange={e => { app.wall.surround = e.currentTarget.value; app.commit('Surround'); }}
      />
      <span>Surround</span>
      <span class="num dim">{customSurround ? app.colours.surround : 'paper'}</span>
    </label>
    <button type="button" class="same" disabled={w.surround == null}
      onclick={() => { app.wall.surround = null; app.commit('Surround'); }}
      title="Use the paper colour outside the art too">Same as paper</button>
  </div>
  <div class="row">
    <button type="button" disabled={!custom} onclick={resetColours} title={`Invert ${app.doc.tone.invert ? 'on' : 'off'}: ${rule.ink} on ${rule.paper}`}>
      <Icon name="reset" size={14} /> Invert rule
    </button>
    <button type="button" disabled={!app.theme} aria-pressed={isTheme} onclick={useTheme}
      title={app.theme ? `Omarchy theme: ${app.theme.foreground} on ${app.theme.background}` : 'No Omarchy theme colours found'}>
      <Icon name="palette" size={14} /> Theme colours
    </button>
  </div>
  {#if negative}
    <p class="warn" role="status">
      <Icon name="alert" size={14} />
      <span>
        The ink is {app.doc.tone.invert ? 'darker' : 'lighter'} than the paper with Invert {app.doc.tone.invert ? 'on' : 'off'},
        so the art comes out as a negative.
        <button type="button" class="link" onclick={() => app.setInvert(!app.doc.tone.invert)}>
          Turn Invert {app.doc.tone.invert ? 'off' : 'on'}
        </button>
      </span>
    </p>
  {/if}
</div>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .presets button { height: 28px; font-size: 12px; }
  .dim { color: var(--text-muted); }
  .wh { display: flex; align-items: center; gap: 6px; }
  .wh input { width: 84px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .lf { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .lf .wh input { width: 100%; min-width: 0; }
  .hint { margin: 0; font-size: 12px; color: var(--text-muted); }
  .same { font-size: 12px; }
  .colours { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .swatch {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 8px;
    align-items: center;
    padding: 5px 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-ctl);
    background: var(--surface);
    cursor: pointer;
  }
  .swatch.off { opacity: 0.5; cursor: default; }
  .swatch input {
    grid-row: span 2;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    background: none;
    cursor: inherit;
  }
  .swatch input::-webkit-color-swatch-wrapper { padding: 0; }
  .swatch input::-webkit-color-swatch { border: 0; border-radius: 4px; }
  .swatch .num { font-size: 11px; }
  .row { display: flex; gap: 6px; }
  .row button { flex: 1; font-size: 12px; }
  .warn {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 6px 8px;
    border-radius: var(--radius-ctl);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    color: var(--warn);
    font-size: 12px;
  }
  .warn :global(.ic) { margin-top: 2px; }
  .link {
    display: inline;
    height: auto;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    text-decoration: underline;
    font-size: inherit;
  }
  .link:hover:not(:disabled) { background: none; }
</style>
