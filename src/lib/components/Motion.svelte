<script lang="ts">
  // Motion for the animated wallpaper (the kivan.stipple shell plugin plays it; the PNG stays the
  // still). The preview plays what will be saved (pipeline.previewMotion).
  import { COLS_MAX, COLS_MIN } from '../layout';
  import { anyMotion, columnRate, defaultMotion, motionFps, type Motion } from '../motion';
  import { currentPlan, previewMotion } from '../pipeline';
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';
  import Slider from './Slider.svelte';
  import Switch from './Switch.svelte';

  const DEF = defaultMotion();
  const m = $derived(app.motion);
  const saved = $derived(previewMotion());
  const fps = $derived(motionFps(saved));

  const secs = (v: number) => (v >= 120 ? `${Math.round(v / 6) / 10} min` : `${Math.round(v)} s`);

  function toggle(on: boolean) {
    app.motion.columns.on = on;
    app.commit('Columns');
  }

  type NumKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

  /** A slider bound to one Columns setting: live while dragging, one history step on release. */
  function slide(k: NumKey<Motion['columns']>, label: string) {
    const set = (v: number) => { app.motion.columns[k] = v; };
    return { oninput: set, oncommit: (v: number) => { set(v); app.commit(label); } };
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

  const plan = $derived(m.columns.on ? currentPlan() : null);
  /** Each keyframe's time (motion.ts columnRate). */
  const stepMs = (n: number, period: number) => Math.round(1000 / Math.max(columnRate(n, period), 1e-3));

  const status = $derived.by(() => {
    const p = app.framesProgress;
    if (saved.columns.on && p) return `Rendering frames ${p.done}/${p.total}…`;
    if (!anyMotion(saved)) return 'No motion: the wallpaper stays still';
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
  <div class="fx">
    <Switch label="Columns" checked={m.columns.on}
      hint="The column count sweeps from one number to another and back" onchange={toggle} />
    {#if m.columns.on}
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
        format={v => `${v} frames`} {...slide('frames', 'Columns smoothness')} />
      <Slider label="One cycle" min={2} max={600} step={1} value={m.columns.period} def={DEF.columns.period}
        format={secs} {...slide('period', 'Columns cycle')} />
      {#if plan}
        <p class="hint">{plan.cols.length} frames from {plan.cols[0]} to {plan.cols[plan.cols.length - 1]} columns
          and back, a new one every {stepMs(plan.cols.length, m.columns.period)} ms. More frames take longer to
          render; a new frame more often costs more battery. It starts on the saved picture's {app.cols} columns{plan.cols.includes(app.cols) ? '' : ' (outside the range: the nearer end)'}.
          {#if plan.capped}Fewer frames than Smoothness asks for: all of them must fit one texture. A lower To makes room for more.{/if}</p>
      {/if}
    {/if}
  </div>
</div>

<p class="hint">Motion plays through the Stipple shell plugin (see the README); without it the wallpaper stays
  still. It slows to 2 frames a second while windows are open, and stops behind a fullscreen window, after a
  minute idle and while the screen is locked.</p>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  .head { display: flex; align-items: center; gap: 8px; }
  .head .hint { flex: 1; }
  .fx { display: flex; flex-direction: column; gap: 4px; }
  .dim { color: var(--text-muted); }
  p { margin: 0; }
  .ends { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .ends label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  .ends input { height: 28px; font-size: 13px; text-align: right; }
</style>
