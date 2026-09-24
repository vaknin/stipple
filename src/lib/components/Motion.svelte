<script lang="ts">
  // Motion for the animated wallpaper (the kivan.stipple shell plugin plays it; the PNG stays the
  // still). Each effect keeps its settings when the style cannot play it, so switching back to
  // Dots or Ordered brings it back. The preview plays what will be saved (pipeline.previewMotion).
  import { anyMotion, defaultMotion, hhmm, motionFps, nightColours, type BatteryRule, type Motion, type Rate } from '../motion';
  import { previewMotion } from '../pipeline';
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
  const night = $derived(nightColours(m, app.colours));

  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  const perSec = (v: number) => `${v}/s`;
  const secs = (v: number) => (v >= 120 ? `${Math.round(v / 6) / 10} min` : `${Math.round(v)} s`);

  type Effect = 'twinkle' | 'shimmer' | 'pan' | 'day';
  const NAMES: Record<Effect, string> = { twinkle: 'Twinkle', shimmer: 'Shimmer', pan: 'Pan and zoom', day: 'Colour over the day' };

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

  const toMinutes = (v: string) => {
    const [h, mm] = v.split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(mm) ? (((h! * 60 + mm!) % 1440) + 1440) % 1440 : null;
  };

  function setTime(k: 'nightStart' | 'nightEnd', raw: string) {
    const v = toMinutes(raw);
    if (v == null || v === app.motion.day[k]) return;
    app.motion.day[k] = v;
    app.commit(k === 'nightStart' ? 'Night starts' : 'Night ends');
  }

  const nowMinute = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  let clock = $state(nowMinute());
  $effect(() => {
    const t = setInterval(() => (clock = nowMinute()), 30000);
    return () => clearInterval(t);
  });
  const shownMinute = $derived(app.previewMinute ?? clock);

  const status = $derived.by(() => {
    if (!anyMotion(saved)) return anyMotion(m) ? 'This style cannot play the chosen effects' : 'No motion: the wallpaper stays still';
    if (fps > 0) return `Animated at ${fps} fps`;
    return 'Still between colour changes';
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
  <div class="label">Colours</div>
  <div class="fx">
    <Switch label="Colour over the day" checked={m.day.on && s.mono} disabled={!s.mono}
      hint={s.mono ? 'Ink and paper turn to night colours after dark' : 'Colour blocks take their colours from the photo'}
      onchange={on => toggle('day', on)} />
    {#if m.day.on && s.mono}
      <div class="colours">
        <label class="swatch" title="Ink at night">
          <input type="color" value={night.ink}
            oninput={e => { app.motion.day.nightInk = e.currentTarget.value; }}
            onchange={e => { app.motion.day.nightInk = e.currentTarget.value; app.commit('Night ink'); }} />
          <span>Night ink</span>
          <span class="num dim">{night.ink}</span>
        </label>
        <label class="swatch" title="Paper at night">
          <input type="color" value={night.paper}
            oninput={e => { app.motion.day.nightPaper = e.currentTarget.value; }}
            onchange={e => { app.motion.day.nightPaper = e.currentTarget.value; app.commit('Night paper'); }} />
          <span>Night paper</span>
          <span class="num dim">{night.paper}</span>
        </label>
      </div>
      <button type="button" class="small" disabled={m.day.nightInk == null && m.day.nightPaper == null}
        title="Night is the day's ink and paper swapped: a negative of the day picture"
        onclick={() => { app.motion.day.nightInk = null; app.motion.day.nightPaper = null; app.commit('Night colours'); }}>
        <Icon name="reset" size={14} /> Swap the day colours
      </button>
      <div class="times">
        <label>
          <span class="dim">Night from</span>
          <input type="time" value={hhmm(m.day.nightStart)} onchange={e => setTime('nightStart', e.currentTarget.value)} />
        </label>
        <label>
          <span class="dim">to</span>
          <input type="time" value={hhmm(m.day.nightEnd)} onchange={e => setTime('nightEnd', e.currentTarget.value)} />
        </label>
      </div>
      <Slider label="Fade" min={0} max={240} step={5} value={m.day.fade} def={DEF.day.fade}
        format={v => (v ? `${v} min` : 'none')} {...slide('day', 'fade', 'Fade')} />
      <div class="scrub">
        <Slider label="Preview at" min={0} max={1435} step={5} value={shownMinute} def={clock} format={hhmm}
          oninput={v => { app.previewMinute = v; }} oncommit={v => { app.previewMinute = v; }} />
        <button type="button" class="small" aria-pressed={app.previewMinute == null}
          title="Show the colours of the current time" onclick={() => (app.previewMinute = null)}>Now</button>
      </div>
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
  .row button, .small { height: 26px; font-size: 12px; }
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
  .times { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .times label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
  input[type='time'] {
    height: 28px;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-ctl);
    background: var(--surface);
    padding: 0 8px;
    font-family: var(--mono);
    font-size: 12px;
    user-select: text;
    -webkit-user-select: text;
  }
  .scrub { display: flex; align-items: flex-end; gap: 8px; }
  .scrub > :global(.slider) { flex: 1; }
  .sub { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
</style>
