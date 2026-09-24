<script lang="ts">
  // Motion for the animated wallpaper (the kivan.stipple shell plugin plays it; the PNG stays the
  // still). Each effect keeps its settings when the style cannot play it, so switching back to
  // Dots or Ordered brings it back. The preview plays what will be saved (pipeline.previewMotion).
  import { COLS_MAX, COLS_MIN } from '../layout';
  import { anyMotion, columnRate, defaultMotion, motionFps, type BatteryRule, type Motion, type Rate } from '../motion';
  import { currentPlan, previewMotion } from '../pipeline';
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';
  import Seg from './Seg.svelte';
  import Slider from './Slider.svelte';
  import Switch from './Switch.svelte';

  const DEF = defaultMotion();
  const m = $derived(app.motion);
  const s = $derived(app.support);
  const saved = $derived(previewMotion());
  const fps = $derived(motionFps(saved));

  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  const perSec = (v: number) => `${v}/s`;
  const secs = (v: number) => (v >= 120 ? `${Math.round(v / 6) / 10} min` : `${Math.round(v)} s`);

  type Effect = 'twinkle' | 'shimmer' | 'pan' | 'columns';
  const NAMES: Record<Effect, string> = {
    twinkle: 'Twinkle', shimmer: 'Shimmer', pan: 'Pan and zoom', columns: 'Columns',
  };

  function toggle(e: Effect, on: boolean) {
    app.motion[e].on = on;
    app.commit(NAMES[e]);
  }

  type NumKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

  /** A slider bound to one motion setting: live while dragging, one history step on release. */
  function slide<E extends Effect>(e: E, k: NumKey<Motion[E]>, label: string) {
    const set = (v: number) => { (app.motion[e] as Record<string, unknown>)[k as string] = v; };
    return { oninput: set, oncommit: (v: number) => { set(v); app.commit(label); } };
  }

  function useDots() {
    app.doc.mode = 'braille';
    app.doc.cols = null;
    app.commit('Style');
  }

  function useLetters() {
    app.doc.mode = 'ascii';
    app.commit('Style');
  }

  /** From / To as typed numbers (Enter or leaving the field applies). */
  function setEnd(k: 'from' | 'to', el: HTMLInputElement) {
    const v = Math.round(Number(el.value));
    if (!Number.isFinite(v) || el.value.trim() === '') { el.value = String(app.motion.columns[k]); return; }
    const next = Math.max(COLS_MIN, Math.min(COLS_MAX, v));
    el.value = String(next);
    if (next === app.motion.columns[k]) return;
    app.motion.columns[k] = next;
    app.commit(k === 'from' ? 'Columns from' : 'Columns to');
  }

  const plan = $derived(m.columns.on && s.letters ? currentPlan() : null);
  /** Each keyframe's time (motion.ts columnRate). */
  const stepMs = (n: number, period: number) => Math.round(1000 / Math.max(columnRate(n, period), 1e-3));

  function useOrdered() {
    app.doc.dither = 'bayer';
    app.commit('Dithering');
  }

  function reroll() {
    let seed = m.seed;
    while (seed === m.seed) seed = 1 + Math.floor(Math.random() * 65535);
    app.motion.seed = seed;
    app.commit('Pattern');
  }

  const status = $derived.by(() => {
    const p = app.framesProgress;
    if (saved.columns.on && p) return `Rendering frames ${p.done}/${p.total}…`;
    if (!anyMotion(saved)) return anyMotion(m) ? 'This style cannot play the chosen effects' : 'No motion: the wallpaper stays still';
    return `Animated at ${Math.round(fps * 10) / 10} fps`;
  });
</script>

<div class="field">
  <div class="head">
    <button type="button" class="icon" aria-pressed={app.playing} disabled={!app.loaded}
      aria-label={app.playing ? 'Pause the preview' : 'Play the preview'}
      title={app.playing ? 'Pause the preview (the still picture shows)' : 'Play the motion in the preview'}
      onclick={() => (app.playing = !app.playing)}>
      <Icon name={app.playing ? 'pause' : 'play'} />
    </button>
    <span class="hint">{status}</span>
  </div>
</div>

<div class="field">
  <div class="label">Dots</div>
  {#if !s.dots}
    <p class="need" role="status">
      <Icon name="alert" size={14} />
      <span>Twinkle, Shimmer and Pan and zoom move the Braille dots, so they need the Dots style.
        <button type="button" class="link" onclick={useDots}>Use Dots</button></span>
    </p>
  {/if}

  <div class="fx">
    <Switch label="Twinkle" checked={m.twinkle.on && s.dots} disabled={!s.dots}
      hint="A few dots blink on and off" onchange={on => toggle('twinkle', on)} />
    {#if m.twinkle.on && s.dots}
      <Slider label="Amount" min={0.005} max={0.2} step={0.005} value={m.twinkle.amount} def={DEF.twinkle.amount}
        format={pct} {...slide('twinkle', 'amount', 'Twinkle amount')} />
      <Slider label="Rate" min={1} max={24} step={1} value={m.twinkle.rate} def={DEF.twinkle.rate}
        format={perSec} {...slide('twinkle', 'rate', 'Twinkle rate')} />
    {/if}
  </div>

  {#if s.dots && !s.ordered}
    <p class="need" role="status">
      <Icon name="alert" size={14} />
      <span>Shimmer and Pan and zoom re-dither the picture each frame, so they need Ordered dithering.
        <button type="button" class="link" onclick={useOrdered}>Use Ordered dithering</button></span>
    </p>
  {/if}

  <div class="fx">
    <Switch label="Shimmer" checked={m.shimmer.on && s.ordered} disabled={!s.ordered}
      hint="The shading ripples with fine noise" onchange={on => toggle('shimmer', on)} />
    {#if m.shimmer.on && s.ordered}
      <Slider label="Amount" min={0.05} max={1} step={0.01} value={m.shimmer.amount} def={DEF.shimmer.amount}
        format={pct} {...slide('shimmer', 'amount', 'Shimmer amount')} />
      <Slider label="Rate" min={1} max={24} step={1} value={m.shimmer.rate} def={DEF.shimmer.rate}
        format={perSec} {...slide('shimmer', 'rate', 'Shimmer rate')} />
    {/if}
  </div>

  <div class="fx">
    <Switch label="Pan and zoom" checked={m.pan.on && s.ordered} disabled={!s.ordered}
      hint="The view drifts and slowly zooms in and out inside the crop" onchange={on => toggle('pan', on)} />
    {#if m.pan.on && s.ordered}
      <Slider label="Zoom" min={0.02} max={0.5} step={0.01} value={m.pan.zoom} def={DEF.pan.zoom}
        format={v => `+${Math.round(v * 100)}%`} {...slide('pan', 'zoom', 'Zoom')} />
      <Slider label="One cycle" min={10} max={600} step={5} value={m.pan.period} def={DEF.pan.period}
        format={secs} {...slide('pan', 'period', 'Pan cycle')} />
      <Slider label="Frame rate" min={4} max={30} step={1} value={m.pan.fps} def={DEF.pan.fps}
        format={v => `${v} fps`} {...slide('pan', 'fps', 'Pan frame rate')} />
    {/if}
  </div>

  {#if (m.twinkle.on && s.dots) || (m.shimmer.on && s.ordered)}
    <div class="row">
      <span class="hint">Pattern <span class="num">#{m.seed}</span></span>
      <button type="button" onclick={reroll} title="Another random pattern for Twinkle and Shimmer">
        <Icon name="dice" size={14} /> Re-roll
      </button>
    </div>
  {/if}
</div>

<div class="field">
  <div class="label">Letters</div>
  {#if !s.letters}
    <p class="need" role="status">
      <Icon name="alert" size={14} />
      <span>Columns redraws the letters at another column count each frame, so it needs the Letters style.
        <button type="button" class="link" onclick={useLetters}>Use Letters</button></span>
    </p>
  {/if}

  <div class="fx">
    <Switch label="Columns" checked={m.columns.on && s.letters} disabled={!s.letters}
      hint="The column count sweeps from one number to another and back" onchange={on => toggle('columns', on)} />
    {#if m.columns.on && s.letters}
      <div class="ends">
        {#each [['from', 'From'], ['to', 'To']] as const as [k, label] (k)}
          <label>
            <span class="dim">{label}</span>
            <input type="number" inputmode="numeric" min={COLS_MIN} max={COLS_MAX} step="1" value={m.columns[k]}
              title="{COLS_MIN}–{COLS_MAX} columns. Enter to apply."
              onchange={e => setEnd(k, e.currentTarget)}
              onkeydown={e => {
                if (e.key === 'Enter') { e.preventDefault(); setEnd(k, e.currentTarget); e.currentTarget.select(); }
                if (e.key === 'Escape') { e.currentTarget.value = String(m.columns[k]); e.currentTarget.blur(); }
              }}
              onfocus={e => e.currentTarget.select()} />
          </label>
        {/each}
      </div>
      <Slider label="Smoothness" min={4} max={600} step={1} value={m.columns.frames} def={DEF.columns.frames}
        format={v => `${v} frames`} {...slide('columns', 'frames', 'Columns smoothness')} />
      <Slider label="One cycle" min={2} max={600} step={1} value={m.columns.period} def={DEF.columns.period}
        format={secs} {...slide('columns', 'period', 'Columns cycle')} />
      {#if plan}
        <p class="hint">{plan.cols.length} frames from {plan.cols[0]} to {plan.cols[plan.cols.length - 1]} columns
          and back, a new one every {stepMs(plan.cols.length, m.columns.period)} ms. More frames take longer to
          render; a new frame more often costs more battery. It starts on the saved picture's {app.cols} columns{plan.cols.includes(app.cols) ? '' : ' (outside the range: the nearer end)'}.
          {#if plan.capped}Fewer frames than Smoothness asks for: all of them must fit one texture. A lower To makes room for more.{/if}</p>
      {/if}
    {/if}
  </div>
</div>

<div class="field">
  <div class="label">Saving power</div>
  <div class="sub">
    <span class="dim">With windows open</span>
    <Seg label="With windows open" small value={m.windows}
      options={[
        { value: 'keep', label: 'Keep', hint: 'Play at the full rate behind windows too' },
        { value: 'slow', label: 'Slow', hint: 'At most 2 frames a second while windows are open on that screen' },
        { value: 'still', label: 'Still', hint: 'Stop while windows are open on that screen' },
      ] satisfies { value: Rate; label: string; hint: string }[]}
      onpick={v => { app.motion.windows = v; app.commit('With windows open'); }} />
  </div>
  <div class="sub">
    <span class="dim">On battery</span>
    <Seg label="On battery" small value={m.battery}
      options={[
        { value: 'same', label: 'Same', hint: 'As on AC power' },
        { value: 'half', label: 'Half', hint: 'Half the frame rate on battery' },
        { value: 'still', label: 'Still', hint: 'Stop on battery' },
      ] satisfies { value: BatteryRule; label: string; hint: string }[]}
      onpick={v => { app.motion.battery = v; app.commit('On battery'); }} />
  </div>
  <p class="hint">Motion always stops behind a fullscreen window, after a minute idle and while the screen is locked.
    It plays through the Stipple shell plugin (see the README); without it the wallpaper stays still.</p>
</div>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  .head { display: flex; align-items: center; gap: 8px; }
  .head .hint { flex: 1; }
  .fx { display: flex; flex-direction: column; gap: 4px; }
  .fx + .fx { border-top: 1px solid var(--border); padding-top: 4px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .row button { height: 26px; font-size: 12px; }
  .dim { color: var(--text-muted); }
  p { margin: 0; }
  .need {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border-radius: var(--radius-ctl);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    color: var(--warn);
    font-size: 12px;
  }
  .need :global(.ic) { margin-top: 2px; }
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
  .ends { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .ends label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .ends input { height: 28px; font-size: 13px; text-align: right; }
  .sub { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
</style>
