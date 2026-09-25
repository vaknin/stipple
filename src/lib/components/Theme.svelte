<script lang="ts">
  // The Stipple theme: the desktop's colours (bar, menus, terminals, borders) made from this
  // wallpaper's ink and paper and shifted with the real sun by the kivan.stipple shell plugin
  // (palette.mjs). While this tab is open the preview shows the wallpaper at the chosen time, with a
  // mock bar in the palette; Save only ever writes the day's colours into the PNG.
  import { defaultTheme, sunTimes, type DayMode, type Surface } from '$palette';
  import { onMount } from 'svelte';
  import { save } from '../actions';
  import { baseName } from '../pipeline';
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';
  import RisoInks, { type InkPair } from './RisoInks.svelte';
  import Seg from './Seg.svelte';
  import Slider from './Slider.svelte';
  import Switch from './Switch.svelte';

  const DEF = defaultTheme();
  const t = $derived(app.themeOpts);

  // the tab drives the preview: the hour's colours while it is open, now unless a time is picked
  onMount(() => {
    app.clock = Date.now();
    app.themeShown = true;
    const tick = window.setInterval(() => (app.clock = Date.now()), 20_000);
    return () => {
      clearInterval(tick);
      app.themeShown = false;
      app.previewMinute = null;
    };
  });

  const DAYS: { value: DayMode; label: string; hint: string }[] = [
    { value: 'off', label: 'Off', hint: 'The colours stay the wallpaper’s own all day.' },
    { value: 'sky', label: 'Sky', hint: 'The hue follows the sky: cool at night, a blue hour, a warm golden hour, the wallpaper’s own colours by day.' },
    { value: 'light', label: 'Light', hint: 'The hue stays; only the lightness and contrast follow the sun.' },
    { value: 'warm', label: 'Warm', hint: 'A warm evening and a darker night; the wallpaper’s own colours by day.' },
    { value: 'custom', label: 'Custom', hint: 'Your own night colours, blended in as the sun goes down.' },
  ];
  const SURFACES: { value: Surface; label: string; hint: string }[] = [
    { value: 'paper', label: 'Paper', hint: 'The bar and panels are drawn on the paper colour' },
    { value: 'deep', label: 'Deep', hint: 'On a paper a little deeper than the wallpaper’s' },
    { value: 'tinted', label: 'Tinted', hint: 'On the paper tinted with the ink' },
  ];

  const dayHint = $derived(DAYS.find(d => d.value === t.day)?.hint ?? '');

  function set<K extends keyof typeof t>(k: K, v: (typeof t)[K], label: string) {
    if (app.themeOpts[k] === v) return;
    app.themeOpts[k] = v;
    app.commit(label);
  }

  const strength = {
    oninput: (v: number) => { app.themeOpts.strength = v; },
    oncommit: (v: number) => { app.themeOpts.strength = v; app.commit('Theme strength'); },
  };

  // ---- night colours (Custom): null is the day's colours swapped
  const nightInk = $derived(t.nightInk ?? app.colours.paper);
  const nightPaper = $derived(t.nightPaper ?? app.colours.ink);

  function useNightInks(p: InkPair) {
    app.themeOpts.nightInk = p.ink;
    app.themeOpts.nightPaper = p.paper;
    app.commit('Night colours');
  }

  function swapNight() {
    app.themeOpts.nightInk = null;
    app.themeOpts.nightPaper = null;
    app.commit('Night colours');
  }

  // ---- the time previewed
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;
  const clockTime = (d: Date) => hhmm(d.getHours() * 60 + d.getMinutes());
  const nowMinute = $derived.by(() => { const d = new Date(app.clock); return d.getHours() * 60 + d.getMinutes(); });
  const minute = $derived(app.previewMinute ?? nowMinute);
  const at = {
    oninput: (v: number) => { app.previewMinute = Math.round(v); },
    oncommit: (v: number) => { app.previewMinute = Math.round(v); },
  };

  const place = $derived(app.sunPlace);
  const hasCoords = $derived(place?.latitude != null && place.longitude != null);
  const placeName = $derived(place?.name ? place.name.replace(/\b\w/g, c => c.toUpperCase()) : 'Here');
  const times = $derived(hasCoords ? sunTimes(app.previewDate, place!.latitude!, place!.longitude!) : null);
  const sunLine = $derived.by(() => {
    const s = app.sunNow;
    const rise = times?.sunrise ? clockTime(times.sunrise) : '—';
    const set = times?.sunset ? clockTime(times.sunset) : '—';
    return `${placeName} · sunrise ${rise} · sunset ${set} · sun ${Math.round(s.elevation)}° ${s.rising ? '↑' : '↓'}`;
  });

  const SWATCHES = ['background', 'foreground', 'accent', 'red', 'yellow', 'green', 'cyan', 'blue', 'magenta'];
  const palette = $derived(app.themed.palette);

  // ---- a saved wallpaper whose sidecar has other Theme settings: Save updates it in place
  const themeKey = $derived(JSON.stringify(t));
  const behind = $derived(!!app.saved && !!app.loaded && app.saved.theme !== themeKey && app.saved.key === app.imageKey());
</script>

<div class="field">
  <div class="label">Day</div>
  <Seg label="Day" small value={t.day} options={DAYS.map(d => ({ value: d.value, label: d.label, hint: d.hint }))}
    onpick={v => set('day', v, 'Day mode')} />
  <p class="hint">{dayHint}</p>
  <Slider label="Strength" min={0} max={1} step={0.01} value={t.strength} def={DEF.strength} disabled={t.day === 'off'}
    format={v => `${Math.round(v * 100)}%`} {...strength} />
</div>

{#if t.day === 'custom'}
  <div class="field">
    <div class="label">Night colours</div>
    <div class="colours">
      <label class="swatch" title="Ink at night">
        <input type="color" value={nightInk}
          oninput={e => { app.themeOpts.nightInk = e.currentTarget.value; }}
          onchange={e => { app.themeOpts.nightInk = e.currentTarget.value; app.commit('Night ink'); }} />
        <span>Ink</span>
        <span class="num dim">{t.nightInk ?? 'day paper'}</span>
      </label>
      <label class="swatch" title="Paper at night">
        <input type="color" value={nightPaper}
          oninput={e => { app.themeOpts.nightPaper = e.currentTarget.value; }}
          onchange={e => { app.themeOpts.nightPaper = e.currentTarget.value; app.commit('Night paper'); }} />
        <span>Paper</span>
        <span class="num dim">{t.nightPaper ?? 'day ink'}</span>
      </label>
    </div>
    <button type="button" disabled={t.nightInk == null && t.nightPaper == null} onclick={swapNight}
      title="At night the ink becomes the day's paper and the paper the day's ink">
      <Icon name="reset" size={14} /> Day colours swapped
    </button>
    <div class="sub">
      <span class="dim">Riso inks</span>
      <RisoInks label="Night riso inks" ink={nightInk} paper={nightPaper} onpick={useNightInks} />
    </div>
  </div>
{/if}

<div class="field">
  <div class="label">Surface</div>
  <Seg label="Surface" value={t.surface} options={SURFACES} onpick={v => set('surface', v, 'Theme surface')} />
  <p class="hint">What the bar and panels are drawn on.</p>
</div>

<div class="field">
  <Switch label="Wallpaper follows the sun" checked={t.wallpaper}
    hint="Off: only the desktop's colours change through the day; the wallpaper keeps its own"
    onchange={on => set('wallpaper', on, 'Wallpaper follows the sun')} />
  <Switch label="Use the Stipple theme when set" checked={t.apply}
    hint="Set as wallpaper also switches Omarchy to the Stipple theme (the background stays)"
    onchange={on => set('apply', on, 'Use the Stipple theme')} />
</div>

<div class="field">
  <div class="label">Preview</div>
  <div class="at">
    <Slider label="At" min={0} max={1439} step={1} value={minute} def={nowMinute} format={hhmm} {...at} />
    <button type="button" aria-pressed={app.previewMinute == null} onclick={() => (app.previewMinute = null)}
      title="Preview the colours of this moment">Now</button>
  </div>
  {#if hasCoords}
    <p class="hint num">{sunLine}</p>
  {:else}
    <p class="warn" role="status">
      <Icon name="alert" size={14} />
      <span>No coordinates for the weather location: the sun is assumed to rise at 06:00 and set at 18:00.
        Set them with <code>omarchy-weather-location --set &lt;name&gt; &lt;lat&gt;,&lt;lon&gt;</code>.</span>
    </p>
  {/if}
  <div class="swatches" role="list" aria-label="Palette">
    {#each SWATCHES as k (k)}
      <i role="listitem" style:background={palette[k]} title="{k} {palette[k]}"></i>
    {/each}
  </div>
</div>

{#if behind}
  <p class="update" role="status">
    <span>{baseName(app.saved!.path)} has other Theme settings.</span>
    <button type="button" disabled={!!app.busy} onclick={() => save()}>Update it</button>
  </p>
{:else}
  <p class="hint">Save writes these settings with the wallpaper (a saved one is updated in place). The Stipple shell
    plugin reads them and recolours the desktop through the day.</p>
{/if}

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  .dim { color: var(--text-muted); }
  p { margin: 0; }
  .sub { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .field > button { font-size: 12px; }
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
  .at { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 8px; }
  .at button { height: 26px; font-size: 12px; }
  .swatches { display: grid; grid-template-columns: repeat(9, 1fr); gap: 3px; }
  .swatches i { height: 16px; border-radius: 4px; border: 1px solid var(--border-strong); }
  .warn {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border-radius: var(--radius-ctl);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    color: var(--warn);
    font-size: 12px;
  }
  .warn :global(.ic) { margin-top: 2px; }
  code { font-family: var(--mono); font-size: 11px; color: var(--text); word-break: break-word; }
  .update {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: var(--radius-ctl);
    background: var(--accent-soft);
    font-size: 12px;
  }
  .update span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .update button { height: 26px; font-size: 12px; }
</style>
