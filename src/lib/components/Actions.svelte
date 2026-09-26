<script lang="ts">
  import { setAsWallpaper } from '../actions';
  import { baseName } from '../pipeline';
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';

  const off = $derived(!app.loaded || !!app.busy || app.cropping);
  const title = $derived(app.target
    ? `Update ${baseName(app.target)} and set it as the Omarchy background (S)`
    : 'Save to the theme\'s backgrounds and set it as the Omarchy background (S)');
</script>

<div class="actions">
  <button type="button" class="primary" disabled={off} onclick={() => setAsWallpaper()} {title}>
    <Icon name="wall" /> {app.busy ?? 'Set as wallpaper'}
  </button>
</div>

<style>
  .actions { display: grid; }
  button { height: 36px; }
</style>
