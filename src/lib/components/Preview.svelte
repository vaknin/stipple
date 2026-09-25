<script lang="ts">
  // The wallpaper at the window's size: the output's aspect, drawn in device pixels. When the
  // canvas would be as large as the output, it is the output (and CSS shrinks it).
  import { onMount, untrack } from 'svelte';
  import { boxPx, clampBox, type Box } from '../layout';
  import { drawPreview, schedule, setPreviewCanvas } from '../pipeline';
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';
  import ThemeBar from './ThemeBar.svelte';

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

  // ---- the art's rectangle (Wallpaper > Art area > Custom): drag inside it to move it, drag an
  // edge or corner to resize it, scroll over it to scale it, double-click it to centre it
  const boxCss = $derived.by(() => {
    const b = app.wall.box;
    if (!b || !app.loaded) return null;
    return boxPx(b, fitted.cssW, fitted.cssH);
  });

  /** Which edges a pointer grabs: none of them = move. */
  interface Grip { l: boolean; t: boolean; r: boolean; b: boolean }
  /** How close to an edge (CSS px) grabs it. */
  const EDGE = 8;

  let drag: { px: number; py: number; start: Box; grip: Grip } | null = $state(null);
  let grip: Grip | null = $state(null);
  const minBox = () => 16 / Math.min(app.wall.width, app.wall.height);

  /** The grip at a pointer: null outside the rectangle (and its edge band). */
  function gripAt(e: PointerEvent | WheelEvent | MouseEvent): Grip | null {
    const r = boxCss;
    if (!r || app.cropping) return null;
    const c = canvas.getBoundingClientRect();
    const x = e.clientX - c.left, y = e.clientY - c.top;
    if (x < r.x - EDGE || y < r.y - EDGE || x > r.x + r.w + EDGE || y > r.y + r.h + EDGE) return null;
    // a small rectangle keeps a middle to move it by
    const e2 = Math.min(EDGE, r.w / 4, r.h / 4);
    return { l: x < r.x + e2, t: y < r.y + e2, r: x > r.x + r.w - e2, b: y > r.y + r.h - e2 };
  }

  const CURSORS: Record<string, string> = {
    '': 'move', l: 'ew-resize', r: 'ew-resize', t: 'ns-resize', b: 'ns-resize',
    lt: 'nwse-resize', rb: 'nwse-resize', rt: 'nesw-resize', lb: 'nesw-resize',
  };
  const cursor = $derived.by(() => {
    const g = drag?.grip ?? grip;
    if (!g) return '';
    return CURSORS[(g.l ? 'l' : '') + (g.r ? 'r' : '') + (g.t ? 't' : '') + (g.b ? 'b' : '')] ?? 'move';
  });

  function onDown(e: PointerEvent) {
    const b = app.wall.box, g = gripAt(e);
    if (!b || e.button !== 0 || !g) return;
    drag = { px: e.clientX, py: e.clientY, start: { ...b }, grip: g };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onMove(e: PointerEvent) {
    if (!drag) { grip = gripAt(e); return; }
    const { start: s, grip: g } = drag;
    const dx = (e.clientX - drag.px) / fitted.cssW, dy = (e.clientY - drag.py) / fitted.cssH;
    const min = minBox();
    if (!g.l && !g.r && !g.t && !g.b) {
      app.wall.box = clampBox({ ...s, x: s.x + dx, y: s.y + dy }, min);
      return;
    }
    // move the grabbed edges, on the canvas and never closer than `min`
    let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
    if (g.l) x0 = Math.max(0, Math.min(x1 - min, x0 + dx));
    if (g.r) x1 = Math.min(1, Math.max(x0 + min, x1 + dx));
    if (g.t) y0 = Math.max(0, Math.min(y1 - min, y0 + dy));
    if (g.b) y1 = Math.min(1, Math.max(y0 + min, y1 + dy));
    app.wall.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function onUp(e: PointerEvent) {
    if (!drag) return;
    const { start: s, grip: g } = drag, b = app.wall.box;
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (!b || (b.x === s.x && b.y === s.y && b.w === s.w && b.h === s.h)) return;
    app.setBox(b, g.l || g.r || g.t || g.b ? 'Resize art' : 'Move art');
  }

  function onWheel(e: WheelEvent) {
    const b = app.wall.box;
    if (!b || !gripAt(e)) return;
    e.preventDefault();
    const k = Math.exp(-Math.sign(e.deltaY) * 0.06);
    const nw = Math.min(1, b.w * k), nh = Math.min(1, b.h * k);
    if (nw < minBox() || nh < minBox()) return;
    app.setBox({ x: b.x + (b.w - nw) / 2, y: b.y + (b.h - nh) / 2, w: nw, h: nh }, 'Resize art');
  }

  function onDblClick(e: MouseEvent) {
    const b = app.wall.box;
    if (!b || !gripAt(e)) return;
    app.setBox({ ...b, x: (1 - b.w) / 2, y: (1 - b.h) / 2 }, 'Centre art');
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
        style="width: {fitted.cssW}px; height: {fitted.cssH}px; cursor: {cursor || 'auto'}"
        onpointerdown={onDown}
        onpointermove={onMove}
        onpointerup={onUp}
        onpointercancel={onUp}
        onpointerleave={() => { if (!drag) grip = null; }}
        onwheel={onWheel}
        ondblclick={onDblClick}
      ></canvas>
      {#if app.themeShown && app.loaded && !app.cropping && !app.peeking}
        <!-- about the height of Omarchy's bar on the screen -->
        <ThemeBar palette={app.themed.palette} date={app.previewDate} height={Math.max(14, Math.round(fitted.cssH * 0.045))} />
      {/if}
      {#if boxCss && !app.cropping}
        <div class="box-outline" class:active={grip || drag} aria-hidden="true"
          style="left: {boxCss.x}px; top: {boxCss.y}px; width: {boxCss.w}px; height: {boxCss.h}px">
          {#if grip || drag}
            {#each ['lt', 'rt', 'lb', 'rb'] as k (k)}<i class="handle {k}"></i>{/each}
          {/if}
        </div>
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
      <p class="hint">PNG, JPEG, WebP or Canon CR3. The wallpaper is made at {app.wall.width}×{app.wall.height}.</p>
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
  .box-outline {
    position: absolute;
    box-sizing: border-box;
    border: 1px dashed color-mix(in srgb, var(--accent) 45%, transparent);
    pointer-events: none;
  }
  .box-outline.active {
    border-color: var(--accent);
    outline: 1px dashed color-mix(in srgb, var(--bg) 70%, transparent);
    outline-offset: -2px;
  }
  .handle {
    position: absolute;
    width: 8px;
    height: 8px;
    border: 1px solid var(--bg);
    border-radius: 2px;
    background: var(--accent);
  }
  .handle.lt { left: -5px; top: -5px; }
  .handle.rt { right: -5px; top: -5px; }
  .handle.lb { left: -5px; bottom: -5px; }
  .handle.rb { right: -5px; bottom: -5px; }
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
