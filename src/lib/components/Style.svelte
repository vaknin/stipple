<script lang="ts">
  import type { AsciiMethod } from '$typist/convert.js';
  import { app } from '../state.svelte';
  import Seg from './Seg.svelte';

  const d = $derived(app.doc);
</script>

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

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
</style>
