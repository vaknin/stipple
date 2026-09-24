<script lang="ts">
  let { label, checked, onchange, disabled = false, hint = '' }: {
    label: string;
    checked: boolean;
    onchange: (on: boolean) => void;
    disabled?: boolean;
    hint?: string;
  } = $props();
</script>

<label class="row" class:disabled title={hint}>
  <span>{label}</span>
  <input type="checkbox" role="switch" {checked} {disabled} onchange={e => onchange(e.currentTarget.checked)} />
</label>

<style>
  .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 30px; cursor: pointer; }
  .disabled { opacity: 0.5; cursor: default; }
  input {
    appearance: none;
    -webkit-appearance: none;
    flex: none;
    width: 34px;
    height: 20px;
    margin: 0;
    border-radius: 999px;
    background: var(--surface-3);
    border: 1px solid var(--border-strong);
    position: relative;
    cursor: inherit;
    transition: background 0.15s var(--ease);
  }
  input::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--text);
    transition: transform 0.15s var(--ease);
  }
  input:checked { background: var(--accent); border-color: transparent; }
  input:checked::after { transform: translateX(14px); background: var(--accent-ink); }
</style>
