<script lang="ts">
  // The wallpaper at the window's size: the output's aspect, drawn in device pixels. When the
  // canvas would be as large as the output, it is the output (and CSS shrinks it).
  import { onMount, untrack } from 'svelte';
  import { drawPreview, schedule, setPreviewCanvas } from '../pipeline';
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';

  let { onopen }: { onopen: () => void } = $props();

  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let box = $state({ w: 0, h: 0 });
  let dpr = $state(window.devicePixelRatio || 1);

  const PAD = 16;

  const fitted = $derived.by(() => {
    const W = app.wall.width, H = app.wall.height;
    const aw = Math.max(1, box.w - 2 * PAD), ah = Math.max(1, box.h - 2 * PAD);
    const k = Math.min(aw / W, ah / H);
    const cssW = Math.max(1, Math.floor(W * k)), cssH = Math.max(1, Math.floor(H * k));
    let bw = Math.round(cssW * dpr), bh = Math.round((bw * H) / W);
    if (bw >= W || bh >= H) { bw = W; bh = H; }
    return { cssW, cssH, bw: Math.max(1, bw), bh: Math.max(1, bh) };
  });

  $effect(() => {
    const f = fitted;
    untrack(() => {
      if (canvas.width !== f.bw || canvas.height !== f.bh) {
        canvas.width = f.bw;
        canvas.height = f.bh;
        drawPreview(); // redraw now: resizing clears the canvas
      }
      schedule();
    });
  });

  onMount(() => {
    setPreviewCanvas(canvas);
    const ro = new ResizeObserver(([e]) => {
      if (e) box = { w: e.contentRect.width, h: e.contentRect.height };
    });
    ro.observe(host);
    // the window moved to a screen with another scale
    let mq: MediaQueryList | null = null;
    const watch = () => {
      mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      mq.addEventListener('change', onDpr, { once: true });
    };
    const onDpr = () => { dpr = window.devicePixelRatio || 1; watch(); };
    watch();
    return () => {
      ro.disconnect();
      mq?.removeEventListener('change', onDpr);
      setPreviewCanvas(null);
    };
  });
</script>

<div class="host" bind:this={host}>
  <div
    class="frame"
    class:hidden={!app.loaded}
    role="img"
    aria-label={app.grid ? `Wallpaper preview, ${app.grid.cols} by ${app.grid.rows} characters` : 'Wallpaper preview'}
  >
    <canvas bind:this={canvas} class="preview-canvas" style="width: {fitted.cssW}px; height: {fitted.cssH}px"></canvas>
  </div>

  {#if !app.loaded}
    <div class="empty">
      <div class="glyph num" aria-hidden="true">⣿⣷⣄<br />⠻⣿⡿</div>
      <p>Open a photo, or drop one here.</p>
      <button type="button" class="primary" onclick={onopen} disabled={app.loading}>
        <Icon name="open" /> {app.loading ? 'Opening…' : 'Open a photo'}
      </button>
      <p class="hint">PNG, JPEG or WebP. The wallpaper is made at {app.wall.width}×{app.wall.height}.</p>
    </div>
  {:else if app.loading}
    <div class="loading">Opening…</div>
  {/if}

  {#if app.dragOver}
    <div class="drop" aria-hidden="true"><Icon name="image" size={28} /><span>Drop to open</span></div>
  {/if}
</div>

<style>
  .host {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: var(--desk);
  }
  .frame { display: contents; }
  canvas {
    display: block;
    box-shadow: 0 0 0 1px var(--border), 0 6px 24px rgba(0, 0, 0, 0.35);
    image-rendering: auto;
  }
  /* the wrapper is display: contents, so hide the canvas itself (out of the grid flow) */
  .hidden canvas { visibility: hidden; position: absolute; }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
    padding: 24px;
  }
  .empty p { margin: 0; }
  .glyph { font-size: 34px; line-height: 1; color: var(--text-faint); letter-spacing: 0.05em; }
  .loading {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: 12px;
  }
  .drop {
    position: absolute;
    inset: 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 2px dashed var(--accent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    color: var(--accent);
    font-weight: 600;
    pointer-events: none;
  }
</style>
