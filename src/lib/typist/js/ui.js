// Stipple: upstream js/ui.js trimmed to the two primitives js/crop.js imports (paintRange,
// announce). Both are copied verbatim from upstream 7081dce; the rest of ui.js (slider rows,
// segmented controls, popovers, toasts) is replaced by Svelte components. announce() writes to an
// element with id "live" when the page has one and is a no-op otherwise.

/** Keep the filled part of a range track in sync (WebKit has no ::range-progress). */
export function paintRange(input) {
  const min = +input.min || 0, max = +input.max || 100;
  const p = max > min ? ((+input.value - min) / (max - min)) * 100 : 0;
  input.style.setProperty('--fill', `${p}%`);
}

export function announce(message, assertive = false) {
  const el = document.getElementById(assertive ? 'liveAssert' : 'live');
  if (!el) return;
  el.textContent = '';
  // next frame so repeated messages are re-announced
  requestAnimationFrame(() => { el.textContent = message; });
}
