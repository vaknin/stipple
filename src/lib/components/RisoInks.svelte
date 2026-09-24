<script lang="ts" module>
  // Ink and paper pairs from risograph inks (close approximations of the named inks) on cream
  // paper, plus two light-on-dark pairs that suit Colour over the day's night.
  export interface InkPair { name: string; ink: string; paper: string }
  export const RISO_INKS: readonly InkPair[] = [
    { name: 'Blue on cream', ink: '#0078bf', paper: '#f2ede3' },
    { name: 'Teal on cream', ink: '#00838a', paper: '#f2ede3' },
    { name: 'Fluorescent pink on cream', ink: '#ff48b0', paper: '#f2ede3' },
    { name: 'Purple on cream', ink: '#765ba7', paper: '#f2ede3' },
    { name: 'Green on cream', ink: '#00a95c', paper: '#f2ede3' },
    { name: 'Burgundy on cream', ink: '#914e72', paper: '#f2ede3' },
    { name: 'Yellow on blue', ink: '#ffe800', paper: '#1d3b6a' },
    { name: 'Pink on midnight', ink: '#ff48b0', paper: '#1b1d2e' },
  ];
</script>

<script lang="ts">
  let { ink, paper, onpick, label = 'Riso inks', disabled = false }: {
    ink: string;
    paper: string;
    onpick: (p: InkPair) => void;
    label?: string;
    disabled?: boolean;
  } = $props();
</script>

<div class="inks" role="group" aria-label={label}>
  {#each RISO_INKS as p (p.name)}
    <button
      type="button"
      class="ghost"
      {disabled}
      title={`${p.name}: ${p.ink} on ${p.paper}`}
      aria-label={p.name}
      aria-pressed={ink === p.ink && paper === p.paper}
      onclick={() => onpick(p)}
    >
      <i style={`background:${p.paper};--dot:${p.ink}`}></i>
    </button>
  {/each}
</div>

<style>
  .inks { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
  button { height: 32px; padding: 0; }
  i {
    position: relative;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    overflow: hidden;
  }
  i::after { content: ''; position: absolute; inset: 28%; border-radius: 50%; background: var(--dot); }
</style>
