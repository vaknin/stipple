<script lang="ts">
  // Dev only: rolling p50 / p95 of the conversion (run), the preview draw and the frame interval.
  import { perf } from '../perf.svelte';
  import { app } from '../state.svelte';

  const rows = $derived.by(() => {
    void perf.version;
    return (['run', 'draw', 'frame'] as const).map(l => ({ l, ...perf.stats(l) }));
  });
  const f = (v: number) => v.toFixed(1).padStart(5);
</script>

<div class="perf num" aria-hidden="true" title="Click to reset" onclick={() => perf.reset()}>
  <div>{app.grid ? `${app.grid.mode} ${app.grid.cols}×${app.grid.rows}` : '—'}</div>
  {#each rows as r (r.l)}
    <div>{r.l.padEnd(5)} p50 {f(r.p50)} p95 {f(r.p95)} ms</div>
  {/each}
</div>

<style>
  .perf {
    position: absolute;
    bottom: 8px;
    left: 8px;
    z-index: 20;
    padding: 4px 6px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.62);
    color: #cfe8cf;
    font-size: 10px;
    line-height: 1.35;
    white-space: pre;
    cursor: pointer;
  }
</style>
