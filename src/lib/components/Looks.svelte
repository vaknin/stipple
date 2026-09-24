<script lang="ts">
  import { LOOKS, type LookId } from '$typist/tone.js';
  import { untrack } from 'svelte';
  import { requestThumbs, thumbs } from '../pipeline';
  import { app } from '../state.svelte';

  function thumb(cv: HTMLCanvasElement, look: LookId) {
    thumbs.canvases.set(look, cv);
    return { destroy: () => { thumbs.canvases.delete(look); } };
  }

  // rebuilt after commits only (and for a new photo), never during a drag
  $effect(() => {
    void app.commits;
    void app.loaded;
    untrack(requestThumbs);
  });

  function pick(look: LookId) {
    if (look === app.doc.look) return;
    app.doc.look = look;
    app.commit('Look');
  }
</script>

<div class="looks" role="radiogroup" aria-label="Look">
  {#each LOOKS as l (l.id)}
    <button
      type="button"
      role="radio"
      aria-checked={app.doc.look === l.id}
      disabled={!app.loaded || app.colourBlocks}
      onclick={() => pick(l.id)}
    >
      <canvas use:thumb={l.id} aria-hidden="true"></canvas>
      <span>{l.name}</span>
    </button>
  {/each}
</div>
{#if app.colourBlocks}
  <p class="hint">Colour blocks always use the Soft look, so the colours stay true.</p>
{/if}

<style>
  .looks { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
  button {
    flex-direction: column;
    gap: 3px;
    height: auto;
    padding: 3px 3px 4px;
    border-color: var(--border);
    background: var(--surface);
    font-size: 11px;
    color: var(--text-muted);
    min-width: 0;
  }
  button[aria-checked='true'] {
    border-color: var(--accent);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--accent);
    background: var(--accent-soft);
  }
  canvas {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 4px;
    background: var(--checker);
  }
  p { margin: 6px 0 0; }
</style>
