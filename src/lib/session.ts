// The session: the photo and settings the app was left with, kept in
// ~/.local/state/stipple/session.json (src-tauri files::session_path) so the next launch
// resumes there. It is written at every history step (a closing window gets no chance to save
// later) and, as a backstop, shortly after any other change; never before the last one was read
// back (start() first). It holds settings only: the photo is reopened from its path, and the undo
// history starts again.

import { resume } from './pipeline';
import { app } from './state.svelte';
import { errorText, readSession, saveSession } from './tauri';

export const SESSION_FORMAT = 'stipple-session/1';
/** Quiet time after a change that is not a history step before it is written. */
const DELAY_MS = 400;

let ready = false;
let timer = 0;
let last = '';
/** Writes run one after another, so an older one never lands after a newer one. */
let queue: Promise<void> = Promise.resolve();

/** The session file for the current photo and settings (null: no photo open). */
function current(): string | null {
  const l = app.loaded;
  if (!l) return null;
  const { doc, wall, motion, theme } = app.snapshot();
  return JSON.stringify({
    format: SESSION_FORMAT,
    source: { path: l.path, name: l.name },
    doc,
    wallpaper: wall,
    motion,
    theme,
  });
}

function write() {
  timer = 0;
  queue = queue.then(store);
}

/** Store the current settings (read when this write's turn comes). */
async function store() {
  const json = current();
  if (!json || json === last) return;
  last = json;
  try {
    await saveSession(json);
  } catch (e) {
    last = '';
    console.warn(`could not save the session: ${errorText(e)}`);
  }
}

/** Resume the last session (once, at launch); changes are saved from then on. */
export async function start() {
  try {
    const json = await readSession();
    if (json) {
      last = json;
      await resume(json);
    }
  } catch (e) {
    console.warn(`could not read the session: ${errorText(e)}`);
  } finally {
    ready = true;
    app.afterStep = now;
  }
}

/** Save now (a history step). */
function now() {
  clearTimeout(timer);
  write();
}

/** Something changed: save it once things are quiet. */
export function changed() {
  if (!ready) return;
  clearTimeout(timer);
  timer = window.setTimeout(write, DELAY_MS);
}

/** Save what is pending (the page is unloading). */
export function flush() {
  if (ready && timer) now();
}
