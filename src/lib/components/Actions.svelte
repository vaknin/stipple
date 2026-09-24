<script lang="ts">
  import { save, setAsWallpaper } from '../actions';
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';

  const off = $derived(!app.loaded || !!app.busy || app.cropping);
</script>

<div class="actions">
  <button type="button" disabled={off} onclick={() => save()} title="Save to ~/Pictures/Wallpapers (S)">
    <Icon name="save" /> {app.busy === 'Saving…' ? 'Saving…' : 'Save'}
  </button>
  <button type="button" class="primary" disabled={off} onclick={() => setAsWallpaper()} title="Save and set as the Omarchy background">
    <Icon name="wall" /> {app.busy === 'Setting…' ? 'Setting…' : 'Set as wallpaper'}
  </button>
</div>

<style>
  .actions { display: grid; grid-template-columns: auto 1fr; gap: 8px; }
  button { height: 36px; }
</style>
