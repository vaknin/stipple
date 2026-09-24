<script lang="ts">
  // Columns as a typed number (Enter or leaving the field applies it; arrow keys step by one).
  // Rows follow from the cell aspect. Auto = cells about 15 px tall on the wallpaper.
  import { COLS_MAX, COLS_MIN } from '../layout';
  import { app } from '../state.svelte';

  let field: HTMLInputElement;

  function apply(raw: string) {
    const v = Math.round(Number(raw));
    if (!Number.isFinite(v) || raw.trim() === '') { field.value = String(app.cols); return; }
    const next = Math.max(COLS_MIN, Math.min(COLS_MAX, v));
    field.value = String(next);
    if (next === app.cols) return;
    app.doc.cols = next === app.autoCols ? null : next;
    app.commit('Width');
  }

  function auto() {
    if (app.doc.cols == null) return;
    app.doc.cols = null;
    app.commit('Width');
  }
</script>

<div class="field">
  <label class="label" for="cols">Columns</label>
  <div class="row">
    <input
      bind:this={field}
      id="cols"
      class="cols"
      type="number"
      inputmode="numeric"
      min={COLS_MIN}
      max={COLS_MAX}
      step="1"
      value={app.cols}
      disabled={!app.loaded}
      title="{COLS_MIN}–{COLS_MAX} columns. Enter to apply; [ and ] step by one."
      onchange={e => apply(e.currentTarget.value)}
      onkeydown={e => {
        if (e.key === 'Enter') { e.preventDefault(); apply(e.currentTarget.value); e.currentTarget.select(); }
        if (e.key === 'Escape') { e.currentTarget.value = String(app.cols); e.currentTarget.blur(); }
      }}
      onfocus={e => e.currentTarget.select()}
    />
    <span class="x">× <b class="num">{app.rows}</b> rows</span>
    <button type="button" class="auto" aria-pressed={app.isAuto} disabled={!app.loaded}
      title="Cells about 15 px tall on the wallpaper ({app.autoCols} columns)" onclick={auto}>Auto</button>
  </div>
  <p class="hint">Rows follow the crop. Auto is {app.autoCols} for {app.wall.width}×{app.wall.height}.</p>
</div>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; gap: 8px; align-items: center; }
  .cols { width: 72px; height: 30px; font-size: 13px; text-align: right; }
  .x { flex: 1; color: var(--text-muted); }
  .x b { color: var(--text); font-weight: 500; }
  .auto { flex: none; }
  p { margin: 0; }
</style>
