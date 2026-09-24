<script lang="ts">
  import type { AsciiMethod } from '$typist/convert.js';
  import { app, type Style } from '../state.svelte';
  import Seg from './Seg.svelte';

  const d = $derived(app.doc);

  function setMode(m: Style) {
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
    ]}
    onpick={setMode}
  />
</div>

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

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
</style>
