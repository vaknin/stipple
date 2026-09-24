<script lang="ts">
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';

  const n = $derived(app.notice);
  let running = $state(false);

  // short confirmations fade out; errors, warnings and anything with a button stay
  $effect(() => {
    const cur = n;
    if (!cur || cur.action || cur.kind === 'error' || cur.kind === 'warn') return;
    const t = setTimeout(() => { if (app.notice === cur) app.notice = null; }, 5000);
    return () => clearTimeout(t);
  });

  async function act() {
    if (!n?.action || running) return;
    running = true;
    try { await n.action.run(); } finally { running = false; }
  }
</script>

{#if n}
  <div class="notice {n.kind}" role={n.kind === 'error' ? 'alert' : 'status'}>
    <Icon name={n.kind === 'ok' ? 'check' : n.kind === 'info' ? 'image' : 'alert'} />
    <span class="text">{n.text}</span>
    {#if n.action}
      <button type="button" disabled={running} onclick={act}>{n.action.label}</button>
    {/if}
    <button type="button" class="icon ghost" aria-label="Dismiss" onclick={() => (app.notice = null)}><Icon name="close" size={14} /></button>
  </div>
{/if}

<style>
  .notice {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 24px);
    padding: 6px 6px 6px 10px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4);
    font-size: 12px;
  }
  .text { flex: 1; min-width: 0; }
  .ok :global(.ic) { color: var(--ok); }
  .warn :global(.ic) { color: var(--warn); }
  .error { border-color: color-mix(in srgb, var(--danger) 50%, transparent); }
  .error :global(.ic) { color: var(--danger); }
  button { height: 26px; font-size: 12px; flex: none; }
  .icon { width: 26px; }
</style>
