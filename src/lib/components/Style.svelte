<script lang="ts">
  import type { AsciiMethod, BlocksKind, Dither, Mode } from '$typist/convert.js';
  import { app } from '../state.svelte';
  import Seg from './Seg.svelte';
  import Switch from './Switch.svelte';

  const d = $derived(app.doc);

  function setMode(m: Mode) {
    app.doc.mode = m;
    app.doc.cols = null; // each style has its own auto width
    app.commit('Style');
  }
</script>

<div class="field">
  <div class="label">Style</div>
  <Seg
    label="Style"
    value={d.mode}
    options={[
      { value: 'braille', label: 'Dots', hint: 'Braille dots' },
      { value: 'ascii', label: 'Letters', hint: 'ASCII letters in Geist Mono' },
      { value: 'blocks', label: 'Blocks', hint: 'Quarter and half blocks' },
    ]}
    onpick={setMode}
  />
</div>

{#if d.mode === 'braille' || (d.mode === 'blocks' && !d.color)}
  <div class="field">
    <div class="label">Dithering</div>
    <Seg
      label="Dithering"
      small
      columns={2}
      value={d.dither}
      options={[
        { value: 'atkinson', label: 'Atkinson' },
        { value: 'floyd', label: 'Floyd–Steinberg' },
        { value: 'bayer', label: 'Ordered', hint: 'Bayer ordered dither' },
        { value: 'threshold', label: 'Threshold' },
      ] satisfies { value: Dither; label: string; hint?: string }[]}
      onpick={v => { app.doc.dither = v; app.commit('Dithering'); }}
    />
  </div>
{/if}

{#if d.mode === 'ascii'}
  <div class="field">
    <div class="label">Letters</div>
    <Seg
      label="Letters"
      small
      value={d.ascii}
      options={[
        { value: 'shape', label: 'Shape-aware', hint: 'Letters chosen by their shape (Typist’s default)' },
        { value: 'ramp', label: 'Density', hint: 'Letters chosen by ink only' },
      ] satisfies { value: AsciiMethod; label: string; hint?: string }[]}
      onpick={v => { app.doc.ascii = v; app.commit('Letters'); }}
    />
  </div>
{/if}

{#if d.mode === 'blocks'}
  <div class="field">
    <div class="label">Blocks</div>
    <Seg
      label="Blocks"
      small
      value={d.blocks}
      options={[
        { value: 'quad', label: 'Quarters' },
        { value: 'half', label: 'Halves' },
      ] satisfies { value: BlocksKind; label: string }[]}
      onpick={v => { app.doc.blocks = v; app.commit('Blocks'); }}
    />
    <Switch
      label="Colour"
      hint="Colours sampled from the photo"
      checked={d.color}
      onchange={on => { app.doc.color = on; app.commit('Colour'); }}
    />
  </div>
{/if}

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
</style>
