<script lang="ts">
  // A mock of Omarchy's bar in the Stipple palette at the previewed time (Theme tab): workspaces
  // with the active one in the accent, the clock, a few tray colours.
  import type { Palette } from '$palette';

  let { palette, date, height }: { palette: Palette; date: Date; height: number } = $props();

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = $derived(`${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`);
  const time = $derived(`${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`);
</script>

<div class="bar num" aria-hidden="true"
  style:height="{height}px" style:font-size="{Math.round(height * 0.55)}px"
  style:background={palette.background} style:color={palette.foreground}>
  <span class="ws"><b style:color={palette.accent}>1</b><span>2</span><span style:color={palette.muted}>3</span></span>
  <span class="clock">{day} {time}</span>
  <span class="tray">
    {#each ['green', 'yellow', 'blue'] as k (k)}<i style:background={palette[k]}></i>{/each}
    <span>72%</span>
  </span>
</div>

<style>
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    padding: 0 0.8em;
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    pointer-events: none;
  }
  .ws { display: flex; gap: 0.9em; }
  .ws b { font-weight: 700; }
  .tray { display: flex; justify-content: flex-end; align-items: center; gap: 0.6em; }
  .tray i { width: 0.6em; height: 0.6em; border-radius: 50%; }
</style>
