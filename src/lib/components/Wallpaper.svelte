<script lang="ts">
  import { app, DEFAULT_COLOURS } from '../state.svelte';
  import type { Monitor } from '../tauri';
  import Icon from './Icon.svelte';
  import RisoInks, { type InkPair } from './RisoInks.svelte';
  import Seg from './Seg.svelte';

  const w = $derived(app.wall);

  /** The wallpaper is made at a monitor's size. */
  function useScreen(m: Monitor) {
    if (m.width === w.width && m.height === w.height) return;
    app.wall.width = m.width;
    app.wall.height = m.height;
    app.keepCropOnPhoto();
    app.commit('Screen');
  }

  function useCustom(on: boolean) {
    if (on === !!w.box) return;
    app.setBox(on ? { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } : null, on ? 'Custom art area' : 'Fill the screen');
  }

  const custom = $derived(w.ink != null || w.paper != null);
  const customSurround = $derived(w.surround != null && w.surround !== app.colours.paper);
  const isTheme = $derived(!!app.omarchy && w.ink === app.omarchy.foreground && w.paper === app.omarchy.background);

  function useTheme() {
    if (!app.omarchy) return;
    app.wall.ink = app.omarchy.foreground;
    app.wall.paper = app.omarchy.background;
    app.commit('Theme colours');
  }

  /** A riso pair (light ink on dark paper draws the art the other way round: still a positive). */
  function useInks(p: InkPair) {
    app.wall.ink = p.ink;
    app.wall.paper = p.paper;
    app.commit('Riso inks');
  }

  function resetColours() {
    app.wall.ink = null;
    app.wall.paper = null;
    app.commit('Colours');
  }
</script>

<!-- one screen, and the wallpaper is already its size: nothing to choose -->
{#if app.monitors.length > 1 || (app.monitors.length && !app.monitors.some(m => m.width === w.width && m.height === w.height))}
  <div class="field">
    <div class="label">Screen</div>
    <div class="presets">
      {#each app.monitors as m (m.name)}
        <button
          type="button"
          aria-pressed={w.width === m.width && w.height === m.height}
          title={`${m.description || m.name} · ${m.width}×${m.height} physical pixels at scale ${m.scale}${m.focused ? ' · focused' : ''}`}
          onclick={() => useScreen(m)}
        >
          <Icon name="monitor" size={14} />
          <span>{m.name}</span>
          <span class="num dim">{m.width}×{m.height}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<div class="field">
  <div class="label">Art area</div>
  <Seg
    label="Art area"
    value={w.box ? 'custom' : 'fill'}
    options={[
      { value: 'fill', label: 'Fill', hint: 'The art covers the whole screen' },
      { value: 'custom', label: 'Custom', hint: 'The art fills a rectangle you place on the screen; the surround colour is around it' },
    ]}
    onpick={v => useCustom(v === 'custom')}
  />
  {#if w.box}
    <p class="hint">Drag the rectangle in the preview to move it, and its edges or corners to resize it.
      Double-click it to centre it.</p>
  {/if}
</div>

<div class="field">
  <div class="label">Colours</div>
  <div class="colours">
    <label class="swatch" title="Ink">
      <input
        type="color"
        value={app.colours.ink}
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
    {#if w.box}
    <label class="swatch" title="Surround: outside the art's rectangle">
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
    {/if}
  </div>
  <div class="row">
    <button type="button" disabled={!custom} onclick={resetColours} title={`${DEFAULT_COLOURS.ink} on ${DEFAULT_COLOURS.paper}`}>
      <Icon name="reset" size={14} /> Default colours
    </button>
    <button type="button" onclick={() => app.swapColours()}
      title="Swap ink and paper: the art is drawn the other way round, so it stays a positive picture (I)">
      <Icon name="swap" size={14} /> Swap
    </button>
    <button type="button" disabled={!app.omarchy} aria-pressed={isTheme} onclick={useTheme}
      title={app.omarchy ? `Omarchy theme: ${app.omarchy.foreground} on ${app.omarchy.background}` : 'No Omarchy theme colours found'}>
      <Icon name="palette" size={14} /> Theme colours
    </button>
  </div>
  <div class="sub">
    <span class="dim">Riso inks</span>
    <RisoInks ink={app.colours.ink} paper={app.colours.paper} onpick={useInks} />
  </div>
</div>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .presets button { height: 28px; font-size: 12px; }
  .dim { color: var(--text-muted); }
  .hint { margin: 0; font-size: 12px; color: var(--text-muted); }
  .same { font-size: 12px; }
  .sub { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
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
</style>
