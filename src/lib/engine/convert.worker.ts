// The Typist converters off the main thread: one for the preview, one for the look thumbnails
// (sharing the decoded photo). Messages from engine.ts workerBackend.

import { createConverter, type ConvertOpts, type Grid, type Pixels } from '$typist/convert.js';
import type { Crop } from '$typist/tone.js';

type In =
  | { type: 'source'; id: number; width: number; height: number; data: ArrayBuffer }
  | { type: 'run'; id: number; lane: 'main' | 'thumb'; crop: Crop; opts: ConvertOpts };

let main = createConverter();
let thumb = createConverter();

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === 'source') {
      main = createConverter();
      thumb = createConverter();
      const px: Pixels = { width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) };
      main.setSource(px);
      thumb.setSource(main.decoded);
      post({ type: 'source', id: m.id });
      return;
    }
    const conv = m.lane === 'main' ? main : thumb;
    const t0 = performance.now();
    const g: Grid = conv.run(m.crop, m.opts);
    const ms = performance.now() - t0;
    // copies: the converter's tone cache may hold on to nothing of these, but be safe to transfer
    const f = g.field;
    const grid: Grid = {
      ...g, cp: g.cp.slice(), fg: g.fg ? g.fg.slice() : null, bg: g.bg ? g.bg.slice() : null,
      field: f ? { width: f.width, height: f.height, L: f.L, dots: f.dots, forced: f.forced } : null,
    };
    const transfer: Transferable[] = [grid.cp.buffer];
    if (f) transfer.push(f.L.buffer, f.dots.buffer, f.forced.buffer);
    if (grid.fg) transfer.push(grid.fg.buffer);
    if (grid.bg) transfer.push(grid.bg.buffer);
    post({ type: 'result', id: m.id, grid, ms }, transfer);
  } catch (err) {
    post({ type: 'error', id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
