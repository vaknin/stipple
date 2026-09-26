<script lang="ts">
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { open } from '@tauri-apps/plugin-dialog';
  import { onMount, untrack } from 'svelte';
  import { save } from '$lib/actions';
  import Actions from '$lib/components/Actions.svelte';
  import CropModal from '$lib/components/CropModal.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Motion from '$lib/components/Motion.svelte';
  import Notice from '$lib/components/Notice.svelte';
  import PerfOverlay from '$lib/components/PerfOverlay.svelte';
  import Preview from '$lib/components/Preview.svelte';
  import Size from '$lib/components/Size.svelte';
  import Style from '$lib/components/Style.svelte';
  import Theme from '$lib/components/Theme.svelte';
  import Tone from '$lib/components/Tone.svelte';
  import Wallpaper from '$lib/components/Wallpaper.svelte';
  import { boxPx } from '$lib/layout';
  import { fontsReady, IMAGE_EXTS, openPath, schedule, syncMotion } from '$lib/pipeline';
  import * as session from '$lib/session';
  import { app } from '$lib/state.svelte';
  import { errorText, inTauri, monitors, sunLocation, themeColors } from '$lib/tauri';

  type Tab = 'look' | 'tone' | 'wall' | 'theme' | 'motion';
  let tab: Tab = $state('look');
  const TABS: { id: Tab; label: string; hint?: string }[] = [
    { id: 'look', label: 'Look' },
    { id: 'tone', label: 'Tone' },
    { id: 'wall', label: 'Wall', hint: 'Wallpaper: art area, colours, screen' },
    { id: 'theme', label: 'Theme', hint: 'The Stipple theme: desktop colours that follow the sun' },
    { id: 'motion', label: 'Motion' },
  ];
  const dev = import.meta.env.DEV;

  /** "500×200 box" for the status line. */
  function boxLabel(w: typeof app.wall) {
    const r = w.box ? boxPx(w.box, w.width, w.height) : null;
    return r ? `${r.w}×${r.h} box` : '';
  }

  // anything that changes the picture schedules one render for the next frame
  $effect(() => {
    JSON.stringify(app.doc);
    JSON.stringify(app.wall);
    JSON.stringify(app.shownColours);
    void app.loaded;
    void app.peeking;
    untrack(schedule);
  });

  // every change is remembered for the next launch (session.ts)
  $effect(() => {
    JSON.stringify(app.doc);
    JSON.stringify(app.wall);
    JSON.stringify(app.motion);
    JSON.stringify(app.themeOpts);
    void app.loaded;
    untrack(session.changed);
  });

  // the preview's motion frames follow the motion settings and the play button
  $effect(() => {
    JSON.stringify(app.motion);
    void app.playing;
    void app.loaded;
    untrack(() => syncMotion(true));
  });

  async function pickFile() {
    if (!inTauri()) return;
    try {
      const path = await open({
        title: 'Open a photo',
        multiple: false,
        directory: false,
        // GTK matches patterns case-sensitively, and cameras write .JPG and .CR3
        filters: [{ name: 'Images', extensions: [...IMAGE_EXTS, ...IMAGE_EXTS.map(e => e.toUpperCase())] }],
      });
      if (typeof path === 'string') await openPath(path);
    } catch (e) {
      app.say('error', errorText(e));
    }
  }

  function startCrop() {
    if (!app.loaded || app.cropping) return;
    app.peeking = false;
    app.cropping = true;
  }

  function peek(on: boolean) {
    if (on && (!app.loaded || app.cropping)) return;
    app.peeking = on;
  }

  // app.js shortcuts: z / Shift+z / Ctrl+y, [ ], i, f, \ (hold), s; plus o to open
  function onkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (app.cropping) return;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    if ((k === 'z' || k === 'Z') && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) app.redo(); else app.undo();
      return;
    }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); app.redo(); return; }
    if (mod && (k === 'o' || k === 'O')) { e.preventDefault(); void pickFile(); return; }
    if (mod || e.altKey) return;
    if (k === 'o' || k === 'O') { e.preventDefault(); void pickFile(); return; }
    if (!app.loaded) return;
    if (k === '[') app.stepCols(-1);
    else if (k === ']') app.stepCols(1);
    else if (k === 'i' || k === 'I') app.swapColours();
    else if (k === 'f' || k === 'F') { e.preventDefault(); startCrop(); }
    else if (k === 's' || k === 'S') { e.preventDefault(); void save(); }
    else if (k === '\\') { e.preventDefault(); peek(true); }
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    if (inTauri()) {
      monitors()
        .then(ms => {
          app.monitors = ms;
          const f = ms.find(m => m.focused) ?? ms[0];
          // default to the focused screen until the user picks a size
          if (f && !app.loaded) { app.wall.width = f.width; app.wall.height = f.height; }
        })
        .catch(e => app.say('warn', `Could not read the monitors from Hyprland: ${errorText(e)}`));
      themeColors().then(t => (app.omarchy = t)).catch(() => {});
      sunLocation().then(p => (app.sunPlace = p)).catch(() => {});
      void session.start();
      getCurrentWebview()
        .onDragDropEvent(ev => {
          const p = ev.payload;
          if (p.type === 'enter') app.dragOver = true;
          else if (p.type === 'leave') app.dragOver = false;
          else if (p.type === 'drop') {
            app.dragOver = false;
            const path = p.paths.find(x => IMAGE_EXTS.includes(x.split('.').pop()?.toLowerCase() ?? ''));
            if (path) void openPath(path);
            else if (p.paths.length) app.say('error', 'That is not a PNG, JPEG, WebP or CR3 image.');
          }
        })
        .then(u => { if (alive) unlisten = u; else u(); });
    }
    if (dev) {
      void import('$lib/dev/hooks').then(m => m.install());
    }
    void fontsReady;
    return () => { alive = false; unlisten?.(); };
  });
</script>

<svelte:window
  {onkeydown}
  onkeyup={e => { if (e.key === '\\') peek(false); }}
  onblur={() => peek(false)}
  onbeforeunload={session.flush}
/>

<div class="app">
  <main class="stage">
    <header class="bar">
      <button type="button" onclick={pickFile} title="Open a photo (O)"><Icon name="open" /> Open…</button>
      <span class="file" title={app.loaded?.path ?? ''}>{app.loaded ? app.loaded.path.split('/').pop() : 'No photo'}</span>
      <div class="spacer"></div>
      <button type="button" class="icon" onclick={startCrop} disabled={!app.loaded || app.cropping} aria-label="Crop" title="Crop: move, zoom, rotate (F)">
        <Icon name="crop" />
      </button>
      <button
        type="button"
        class="icon"
        disabled={!app.loaded || app.cropping}
        aria-pressed={app.peeking}
        aria-label="Hold to see the photo"
        title="Hold to see the photo (\)"
        onpointerdown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); peek(true); }}
        onpointerup={() => peek(false)}
        onpointercancel={() => peek(false)}
        onlostpointercapture={() => peek(false)}
        onkeydown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); peek(true); } }}
        onkeyup={e => { if (e.key === ' ' || e.key === 'Enter') peek(false); }}
        oncontextmenu={e => e.preventDefault()}
      >
        <Icon name="eye" />
      </button>
      <span class="sep"></span>
      <button type="button" class="icon" onclick={() => app.undo()} disabled={!app.canUndo || app.cropping} aria-label="Undo"
        title={app.undoLabel ? `Undo ${app.undoLabel.toLowerCase()} (Z)` : 'Undo (Z)'}><Icon name="undo" /></button>
      <button type="button" class="icon" onclick={() => app.redo()} disabled={!app.canRedo || app.cropping} aria-label="Redo"
        title={app.redoLabel ? `Redo ${app.redoLabel.toLowerCase()} (Shift+Z)` : 'Redo (Shift+Z)'}><Icon name="redo" /></button>
    </header>

    <div class="view">
      <Preview onopen={pickFile} />
      {#if app.cropping}<CropModal />{/if}
      <Notice />
      {#if dev && app.loaded && !app.cropping}<PerfOverlay />{/if}
    </div>

    <footer class="status num">
      {#if app.grid}
        <span>{app.grid.cols}×{app.grid.rows}</span>
      {/if}
      <span>{app.wall.width}×{app.wall.height}{app.wall.box ? `, art in ${boxLabel(app.wall)}` : ''}</span>
      {#if app.grid}<span class="dim">{app.runMs.toFixed(1)} ms</span>{/if}
    </footer>
  </main>

  <aside class="side">
    <div class="tabs" role="tablist" aria-label="Settings">
      {#each TABS as t (t.id)}
        <button type="button" role="tab" aria-selected={tab === t.id} tabindex={tab === t.id ? 0 : -1} title={t.hint ?? ''} onclick={() => (tab = t.id)}>{t.label}</button>
      {/each}
    </div>
    <div class="panel" role="tabpanel">
      {#if tab === 'look'}
        <Style />
        <Size />
      {:else if tab === 'tone'}
        <Tone />
      {:else if tab === 'wall'}
        <Wallpaper />
      {:else if tab === 'theme'}
        <Theme />
      {:else}
        <Motion />
      {/if}
    </div>
    <div class="foot"><Actions /></div>
  </aside>
  <div id="live" class="sr-only" aria-live="polite"></div>
</div>

<style>
  .app {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    height: 100vh;
  }
  .stage { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .bar {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 44px;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .file { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); }
  .spacer { flex: 1; }
  .sep { width: 1px; height: 18px; background: var(--border-strong); margin: 0 2px; }
  .view { position: relative; flex: 1; min-height: 0; }
  .status {
    flex: none;
    display: flex;
    gap: 14px;
    height: 24px;
    align-items: center;
    padding: 0 10px;
    border-top: 1px solid var(--border);
    background: var(--panel);
    color: var(--text-muted);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
  }
  .dim { color: var(--text-faint); margin-left: auto; }
  .side {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: var(--panel);
  }
  .tabs {
    flex: none;
    display: flex;
    gap: 2px;
    padding: 6px 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    flex: 1;
    height: 34px;
    border: 0;
    border-radius: 6px 6px 0 0;
    background: transparent;
    color: var(--text-muted);
    font-weight: 500;
    border-bottom: 2px solid transparent;
  }
  .tabs button[aria-selected='true'] { color: var(--text); border-bottom-color: var(--accent); }
  .panel {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    scrollbar-width: thin;
  }
  .foot { flex: none; padding: 10px 12px; border-top: 1px solid var(--border); }
</style>
