<script lang="ts">
  // The wallpaper at the window's size: the output's aspect, drawn in device pixels. When the
  // canvas would be as large as the output, it is the output (and CSS shrinks it).
  import { onMount, untrack } from 'svelte';
  import { boxPx, clampBox } from '../layout';
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

  // ---- the art's box: drag to move it, scroll to resize it (Wallpaper > Art area > Box)
  const boxCss = $derived.by(() => {
    const b = app.wall.box;
    if (!b || !app.loaded) return null;
    const r = boxPx(b, fitted.cssW, fitted.cssH);
    return r;
  });
  let drag: { px: number; py: number; x: number; y: number } | null = $state(null);
  let hover = $state(false);
  const minBox = () => 16 / Math.min(app.wall.width, app.wall.height);

  function inBox(e: PointerEvent | WheelEvent) {
    const r = boxCss;
    if (!r || app.cropping) return false;
    const c = canvas.getBoundingClientRect();
    const x = e.clientX - c.left, y = e.clientY - c.top;
    return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
  }

  function onDown(e: PointerEvent) {
    const b = app.wall.box;
    if (!b || e.button !== 0 || !inBox(e)) return;
    drag = { px: e.clientX, py: e.clientY, x: b.x, y: b.y };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onMove(e: PointerEvent) {
    hover = inBox(e);
    const b = app.wall.box;
    if (!drag || !b) return;
    const dx = (e.clientX - drag.px) / fitted.cssW, dy = (e.clientY - drag.py) / fitted.cssH;
    app.wall.box = clampBox({ ...b, x: drag.x + dx, y: drag.y + dy }, minBox());
  }

  function onUp(e: PointerEvent) {
    if (!drag) return;
    const moved = app.wall.box && (app.wall.box.x !== drag.x || app.wall.box.y !== drag.y);
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (moved) app.commit('Move art');
  }

  function onWheel(e: WheelEvent) {
    const b = app.wall.box;
    if (!b || !inBox(e)) return;
    e.preventDefault();
    const k = Math.exp(-Math.sign(e.deltaY) * 0.06);
    const nw = Math.min(1, b.w * k), nh = Math.min(1, b.h * k);
    if (nw < minBox() || nh < minBox()) return;
    app.wall.box = clampBox({ x: b.x + (b.w - nw) / 2, y: b.y + (b.h - nh) / 2, w: nw, h: nh }, minBox());
    app.commit('Art box size');
  }

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
    <div class="stage" style="width: {fitted.cssW}px; height: {fitted.cssH}px">
      <canvas
        bind:this={canvas}
        class="preview-canvas"
        class:movable={hover || drag}
        style="width: {fitted.cssW}px; height: {fitted.cssH}px"
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
        onpointerleave={() => { if (!drag) hover = false; }}
        onwheel={onWheel}
      ></canvas>
      {#if boxCss && (hover || drag)}
        <div class="box-outline" aria-hidden="true"
          style="left: {boxCss.x}px; top: {boxCss.y}px; width: {boxCss.w}px; height: {boxCss.h}px"></div>
      {/if}
    </div>
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
  .stage { position: relative; }
  .movable { cursor: move; }
  .box-outline {
    position: absolute;
    box-sizing: border-box;
    border: 1px dashed var(--accent);
    outline: 1px dashed color-mix(in srgb, var(--bg) 70%, transparent);
    outline-offset: -2px;
    pointer-events: none;
  }
  canvas {
    display: block;
    box-shadow: 0 0 0 1px var(--border), 0 6px 24px rgba(0, 0, 0, 0.35);
    image-rendering: auto;
  }
  /* the wrapper is display: contents, so hide the canvas itself (out of the grid flow) */
  .hidden .stage { visibility: hidden; position: absolute; }
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
