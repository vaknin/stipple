<script lang="ts">
  // The Theme tab's colours: the palette the desktop gets at the previewed time, each colour named
  // with what it is for, a terminal drawn in them, and any of the accent and terminal colours picked
  // by hand (theme.colors; palette.mjs keeps a picked colour readable on the background).
  import { deltaE, OWN_COLOURS, protan, type OwnColour, type Palette } from '$palette';
  import { app } from '../state.svelte';
  import Icon from './Icon.svelte';

  let { palette: p, at }: { palette: Palette; at: string } = $props();

  interface Row { key: string; label: string; use: string; from?: string }
  const ROWS: Row[] = [
    { key: 'background', label: 'Background', use: 'Bar, menus, terminals', from: 'From the paper (Surface)' },
    { key: 'foreground', label: 'Text', use: 'Text everywhere', from: 'A quiet colour of the ink’s hue' },
    { key: 'accent', label: 'Accent', use: 'Active workspace, selection, borders' },
    { key: 'red', label: 'Red', use: 'Errors, deleted lines, bar alerts' },
    { key: 'orange', label: 'Orange', use: 'Changed lines, numbers in editors' },
    { key: 'yellow', label: 'Yellow', use: 'Warnings, busy states' },
    { key: 'green', label: 'Green', use: 'Success, added lines' },
    { key: 'cyan', label: 'Cyan', use: 'Info, links' },
    { key: 'blue', label: 'Blue', use: 'Directories, prompts' },
    { key: 'magenta', label: 'Magenta', use: 'Keywords, branches' },
  ];
  const ownable = (k: string): k is OwnColour => (OWN_COLOURS as string[]).includes(k);
  const own = $derived(app.themeOpts.colors);

  /** Picks (or with null, lets the palette derive again) one colour; keys stay in OWN_COLOURS order. */
  function pick(k: OwnColour, v: string | null, commit: boolean) {
    const next: Partial<Record<OwnColour, string>> = {};
    for (const c of OWN_COLOURS) {
      const x = c === k ? v : app.themeOpts.colors[c];
      if (x) next[c] = x;
    }
    app.themeOpts.colors = next;
    if (commit) app.commit(v ? `Theme colour: ${k}` : `Theme colour: ${k} derived`);
  }

  /** How the colour came about, for the tooltip; `tag` is the short form shown for a picked one. */
  function note(r: Row): string {
    if (!ownable(r.key)) return r.from ?? '';
    const mine = own[r.key];
    if (!mine) return r.key === 'accent' ? 'The ink. Click the swatch to pick your own.' : 'Derived from the wallpaper. Click the swatch to pick your own.';
    return mine === p[r.key] ? 'Picked by you.' : `Picked by you (${mine}), its lightness moved to read on the background.`;
  }
  function tag(k: string): string | null {
    if (!ownable(k) || !own[k]) return null;
    return own[k] === p[k] ? 'yours' : 'yours, adjusted';
  }

  // pairs that carry meaning, as they look with protanopia at this time
  const PAIRS = [
    ['red', 'green'], ['yellow', 'green'], ['red', 'yellow'], ['orange', 'green'], ['orange', 'red'],
    ['orange', 'yellow'], ['green', 'cyan'], ['cyan', 'blue'], ['blue', 'magenta'],
  ] as const;
  const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);
  const alike = $derived(PAIRS.filter(([x, y]) => deltaE(protan(p[x]!), protan(p[y]!)) < 0.04).map(([x, y]) => `${cap(x)} and ${y}`));

  const reset = () => { app.themeOpts.colors = {}; app.commit('Theme colours derived'); };
</script>

<div class="field">
  <div class="label">Colours at {at}</div>

  <div class="term num" aria-label="A terminal in these colours" role="img"
    style:background={p.background} style:color={p.foreground} style:border-color={p.lighter_background}>
    <div><span style:color={p.blue}>~/stipple</span> <span style:color={p.magenta}>main</span> $ bun test</div>
    <div><span style:color={p.green}>✓ 42 pass</span>  <span style:color={p.red}>✗ 1 fail</span>  <span style:color={p.yellow}>! 2 warn</span></div>
    <div><span style:color={p.green}>+ added</span>  <span style:color={p.red}>- deleted</span>  <span style:color={p.orange}>~ changed</span></div>
    <div><span style:color={p.cyan}>info:</span> <span style:color={p.muted}># a comment</span> <span class="sel" style:background={p.selection}>selected</span></div>
    <div class="ws">
      <span>1 <b style:color={p.yellow}>●</b></span><span>2 <b style:color={p.cyan}>●</b></span><span>3 <b style:color={p.green}>○</b></span>
      <span class="cur" style:background={p.accent}></span>
    </div>
  </div>

  <ul class="rows">
    {#each ROWS as r (r.key)}
      {@const k = r.key}
      {@const edit = ownable(k)}
      <li title="{r.label}: {r.use}. {note(r)}">
        <label class="chip" class:edit style:background={p.background}>
          <i style:background={p[k]}></i>
          {#if edit}
            <input type="color" aria-label="{r.label} colour" value={own[k as OwnColour] ?? p[k]}
              oninput={e => pick(k as OwnColour, e.currentTarget.value, false)}
              onchange={e => pick(k as OwnColour, e.currentTarget.value, true)} />
          {/if}
        </label>
        <span class="name">
          <span><b>{r.label}</b>{#if tag(k)}<em>{tag(k)}</em>{/if}</span>
          <span class="dim">{r.use}</span>
        </span>
        <code>{p[k]}</code>
        {#if edit && own[k as OwnColour]}
          <button type="button" class="ghost" title="Derive {r.label.toLowerCase()} from the wallpaper again"
            aria-label="Derive {r.label.toLowerCase()} again" onclick={() => pick(k as OwnColour, null, true)}>
            <Icon name="reset" size={13} />
          </button>
        {:else}
          <span></span>
        {/if}
      </li>
    {/each}
  </ul>

  {#if alike.length}
    <p class="warn" role="status">
      <Icon name="alert" size={14} />
      <span>With protanopia these look alike at this time: {alike.join('; ')}. Pick one of them by hand to part them.</span>
    </p>
  {/if}
  {#if Object.keys(own).length}
    <button type="button" onclick={reset}><Icon name="reset" size={14} /> Derive all colours again</button>
  {/if}
  <p class="hint">Click a swatch to pick your own. The terminal colours differ in lightness as well as hue, so they
    stay apart without red–green vision. Picked colours stay as they are all day; the rest follow the sun.</p>
</div>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; }
  p { margin: 0; }
  .dim { color: var(--text-muted); }
  .field > button { font-size: 12px; }

  .term {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid;
    border-radius: var(--radius-ctl);
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.35;
    white-space: pre;
    overflow: hidden;
  }
  .sel { padding: 0 2px; }
  .ws { display: flex; align-items: center; gap: 12px; }
  .ws b { font-weight: 400; }
  .cur { width: 7px; height: 13px; margin-left: auto; }

  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .rows li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto 22px;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
  }
  .chip {
    position: relative;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
  }
  .chip i { width: 14px; height: 14px; border-radius: 50%; }
  .chip.edit { cursor: pointer; }
  .chip.edit:hover { border-color: var(--text-muted); }
  .chip input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
  .name { display: flex; flex-direction: column; min-width: 0; font-size: 12px; line-height: 1.3; }
  .name b { font-weight: 600; }
  .name .dim { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name em { margin-left: 6px; font-style: normal; font-size: 11px; color: var(--accent); }
  code { font-family: var(--mono); font-size: 11px; color: var(--text-muted); }
  .rows button { width: 22px; height: 22px; padding: 0; }

  .warn {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
    border-radius: var(--radius-ctl);
    background: color-mix(in srgb, var(--warn) 12%, transparent);
    color: var(--warn);
    font-size: 12px;
  }
  .warn :global(.ic) { margin-top: 2px; flex: none; }
</style>
