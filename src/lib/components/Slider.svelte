<script lang="ts">
  // A labelled slider (Typist's sliderRow): input moves live, release commits, double-click on
  // the label or track resets to the default, click the value to type one.
  let { label, min, max, step = 0.01, value, def, format = (v: number) => String(v), oninput, oncommit, disabled = false }: {
    label: string;
    min: number;
    max: number;
    step?: number;
    value: number;
    def: number;
    format?: (v: number) => string;
    oninput: (v: number) => void;
    oncommit: (v: number) => void;
    disabled?: boolean;
  } = $props();

  let editing = $state(false);
  let draft = $state('');
  const id = `sl-${Math.random().toString(36).slice(2, 8)}`;
  const fill = $derived(max > min ? ((value - min) / (max - min)) * 100 : 0);
  const tick = $derived(((def - min) / (max - min)) * 100);

  function reset() {
    if (disabled) return;
    oninput(def);
    oncommit(def);
  }

  function startEdit() {
    if (disabled) return;
    draft = String(Math.round(value * 1000) / 1000);
    editing = true;
  }

  function finish(ok: boolean) {
    if (!editing) return;
    editing = false;
    if (!ok) return;
    const raw = parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(raw)) return;
    const v = Math.max(min, Math.min(max, raw));
    oninput(v);
    oncommit(v);
  }

  function focusSelect(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
</script>

<div class="slider" class:disabled>
  <div class="top">
    <label for={id} ondblclick={reset} title="Double-click to reset">{label}</label>
    {#if editing}
      <input
        class="edit num"
        type="text"
        inputmode="decimal"
        aria-label={label}
        bind:value={draft}
        use:focusSelect
        onkeydown={e => {
          if (e.key === 'Enter') { e.preventDefault(); finish(true); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        }}
        onblur={() => finish(true)}
      />
    {:else}
      <button type="button" class="val num ghost" onclick={startEdit} {disabled} aria-label="{label}: {format(value)}. Click to type a value.">{format(value)}</button>
    {/if}
  </div>
  <div class="track" style="--fill: {fill}%; --tick: {tick}%">
    <input
      {id}
      type="range"
      {min}
      {max}
      {step}
      {value}
      {disabled}
      aria-valuetext={format(value)}
      oninput={e => oninput(+e.currentTarget.value)}
      onchange={e => oncommit(+e.currentTarget.value)}
      ondblclick={reset}
    />
    <span class="tick" aria-hidden="true"></span>
  </div>
</div>

<style>
  .slider { display: flex; flex-direction: column; gap: 2px; }
  .disabled { opacity: 0.5; }
  .top { display: flex; align-items: center; justify-content: space-between; height: 22px; }
  label { cursor: default; }
  .val { height: 22px; padding: 0 6px; font-size: 12px; color: var(--text-muted); }
  .edit { width: 64px; height: 22px; text-align: right; }
  .track { position: relative; height: 18px; }
  .tick {
    position: absolute;
    top: 50%;
    left: calc(8px + (100% - 16px) * var(--tick) / 100%);
    width: 2px;
    height: 8px;
    margin: -4px 0 0 -1px;
    border-radius: 1px;
    background: var(--text-faint);
    pointer-events: none;
    opacity: 0.6;
  }
  input[type='range'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 18px;
    margin: 0;
    background: transparent;
    cursor: pointer;
    position: relative;
    z-index: 1;
  }
  input[type='range']::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--fill), var(--surface-3) var(--fill));
  }
  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border-radius: 50%;
    background: var(--text);
    border: 2px solid var(--panel);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  input[type='range']:disabled { cursor: default; }
</style>
