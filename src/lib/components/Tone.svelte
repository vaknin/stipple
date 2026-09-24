<script lang="ts">
  import { app, TONE_CONTROL_DEFAULTS, type ToneControls } from '../state.svelte';
  import Slider from './Slider.svelte';
  import Switch from './Switch.svelte';

  type Key = 'brightness' | 'contrast';
  const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
  // app.js buildTone: labels, ranges and formats
  const SLIDERS: { key: Key; label: string; min: number; max: number; format: (v: number) => string }[] = [
    { key: 'brightness', label: 'Brightness', min: -1, max: 1, format: pct },
    { key: 'contrast', label: 'Contrast', min: -1, max: 1, format: pct },
  ];

  const set = (k: Key, v: number) => { (app.doc.tone as ToneControls)[k] = v; };
</script>

<Switch
  label="Invert (light art on dark)"
  hint="Dots stand for the light parts: light art on a dark wallpaper (I)"
  checked={app.doc.tone.invert}
  onchange={on => app.setInvert(on)}
/>
<Switch
  label="Auto levels"
  hint="Stretch the photo's levels and aim for a steady amount of ink"
  checked={app.doc.tone.auto}
  onchange={on => { app.doc.tone.auto = on; app.commit('Auto levels'); }}
/>
<div class="sliders">
  {#each SLIDERS as s (s.key)}
    <Slider
      label={s.label}
      min={s.min}
      max={s.max}
      step={0.01}
      value={app.doc.tone[s.key]}
      def={TONE_CONTROL_DEFAULTS[s.key]}
      format={s.format}
      oninput={v => set(s.key, v)}
      oncommit={v => { set(s.key, v); app.commit(s.label); }}
    />
  {/each}
</div>

<style>
  .sliders { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
</style>
