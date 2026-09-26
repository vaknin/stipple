// The Typist converter off the main thread. Messages from engine.ts workerBackend; FramePool runs
// several of these workers for the Columns keyframes.

import { createConverter, type ConvertOpts, type Grid, type Pixels } from '$typist/convert.js';
import type { Crop } from '$typist/tone.js';

type In =
  | { type: 'source'; id: number; width: number; height: number; data: ArrayBuffer }
  | { type: 'run'; id: number; crop: Crop; opts: ConvertOpts };

let conv = createConverter();

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    if (m.type === 'source') {
      conv = createConverter();
      conv.setSource({ width: m.width, height: m.height, data: new Uint8ClampedArray(m.data) } satisfies Pixels);
      post({ type: 'source', id: m.id });
      return;
    }
    const t0 = performance.now();
    const g: Grid = conv.run(m.crop, m.opts);
    const ms = performance.now() - t0;
    // copies: the converter's tone cache may hold on to nothing of these, but be safe to transfer
    const grid: Grid = { ...g, cp: g.cp.slice() };
    post({ type: 'result', id: m.id, grid, ms }, [grid.cp.buffer]);
  } catch (err) {
    post({ type: 'error', id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
