<script lang="ts" generics="T extends string">
  // Segmented radio group (roving tabindex, arrow keys), like Typist's .seg.
  interface Option { value: T; label: string; hint?: string; disabled?: boolean }
  let { options, value, label, onpick, small = false, columns = 0 }: {
    options: Option[];
    value: T;
    label: string;
    onpick: (v: T) => void;
    small?: boolean;
    /** Wrap into a grid of this many columns (0 = one row). */
    columns?: number;
  } = $props();

  let host: HTMLDivElement;

  function key(e: KeyboardEvent) {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const live = options.filter(o => !o.disabled);
    const i = live.findIndex(o => o.value === value);
    const next = live[(i + d + live.length) % live.length];
    if (!next) return;
    onpick(next.value);
    queueMicrotask(() => host.querySelector<HTMLButtonElement>(`[data-v="${next.value}"]`)?.focus());
  }
</script>

<div
  class="seg"
  class:small
  class:grid={columns > 0}
  style={columns > 0 ? `grid-template-columns: repeat(${columns}, 1fr)` : undefined}
  role="radiogroup"
  aria-label={label}
  bind:this={host}
  onkeydown={key}
  tabindex="-1"
>
  {#each options as o (o.value)}
    <button
      type="button"
      role="radio"
      data-v={o.value}
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      disabled={o.disabled}
      title={o.hint ?? ''}
      onclick={() => o.value !== value && onpick(o.value)}
    >{o.label}</button>
  {/each}
</div>

<style>
  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: calc(var(--radius-ctl) + 2px);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .seg:focus { outline: none; }
  .grid { display: grid; }
  button {
    flex: 1 1 0;
    min-width: 0;
    height: 28px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    padding: 0 6px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .small button { height: 24px; font-size: 12px; }
  button:hover:not(:disabled) { background: var(--surface-3); color: var(--text); }
  button[aria-checked='true'] {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), inset 0 0 0 1px var(--border-strong);
  }
</style>
