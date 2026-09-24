// Thin typed wrapper around the vendored Typist converter.
//
// convert() is async on purpose: the conversion can run on this thread or in a worker without the
// callers noticing. Requests are latest-wins: a request that is superseded before it runs
// resolves to null. Look thumbnails use a second converter over the same decoded photo, so they
// never evict the main preview's cached samples and tones.

import { createConverter, gridLines, type Converter, type ConvertOpts, type Grid, type Mode } from '$typist/convert.js';
import { cellAspect as typistCellAspect, rowsFor as typistRowsFor } from '$typist/targets.js';
import type { Crop } from '$typist/tone.js';
import { autoColumns, type LayoutIn } from '../layout';

export type { Grid, Mode };
export { gridLines };

/** Typist's File-target cell aspect (cell width / height): braille 0.577, ascii 0.462, blocks 0.5. */
export const cellAspect = (mode: Mode): number => typistCellAspect('plain', mode);

/**
 * Rows that keep the crop's aspect (width / height): a square crop's as Typist's File target
 * computes them, else round(cols * cellAspect / aspect).
 */
export const rowsFor = (cols: number, mode: Mode, aspect = 1): number =>
  aspect === 1 ? typistRowsFor(cols, cellAspect(mode)) : Math.max(1, Math.round((cols * cellAspect(mode)) / aspect));

/** Auto columns for the output and crop aspect (see layout.autoColumns). */
export const autoCols = (mode: Mode, o: LayoutIn, aspect = 1): number => autoColumns(cellAspect(mode), o, aspect);

/** Typist's file colours: dark ink on white, or (invert) light ink on near-black. */
export function fileColours(invert: boolean): { ink: string; paper: string } {
  return invert ? { ink: '#f2f2f0', paper: '#111113' } : { ink: '#17171a', paper: '#ffffff' };
}

/** Look thumbnails never use more columns than this. */
export const THUMB_COLS = 64;

export interface ConvertRequest { crop: Crop; opts: ConvertOpts }
export interface ConvertResult { grid: Grid; ms: number }

export type Lane = 'main' | 'thumb';
const LANES = ['main', 'thumb'] as const;

/** What a conversion backend does: inline (this thread) or in convert.worker.ts. */
export interface Backend {
  setSource(canvas: HTMLCanvasElement): Promise<void>;
  /** Resolves null when a newer request on the same lane replaced this one before it ran. */
  run(req: ConvertRequest, lane: Lane): Promise<ConvertResult | null>;
  dispose(): void;
}

/** Both converters on this thread. */
export function inlineBackend(): Backend {
  let main: Converter = createConverter();
  let thumb: Converter = createConverter();
  return {
    async setSource(canvas) {
      main.setSource(canvas);
      // the thumbnails share the decoded photo (and its summed-area tables)
      thumb.setSource(main.decoded);
    },
    async run(req, lane) {
      const conv = lane === 'main' ? main : thumb;
      const t0 = performance.now();
      const grid = conv.run(req.crop, req.opts);
      return { grid, ms: performance.now() - t0 };
    },
    dispose() {
      main = createConverter();
      thumb = createConverter();
    },
  };
}

/**
 * Both converters in a module worker. One job runs at a time; the preview lane goes first, and a
 * new request replaces the queued one of its lane (a slider drag never builds a backlog).
 */
export function workerBackend(): Backend {
  const worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
  type Job = { lane: Lane; req: ConvertRequest; resolve: (r: ConvertResult | null) => void; reject: (e: Error) => void };
  const pending: Partial<Record<Lane, Job>> = {};
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let busy = false;
  let seq = 0;

  worker.onmessage = (e: MessageEvent) => {
    const m = e.data as { type: string; id: number; grid?: Grid; ms?: number; error?: string };
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.type === 'error') w?.reject(new Error(m.error));
    else if (m.type === 'result') w?.resolve({ grid: m.grid!, ms: m.ms! });
    else w?.resolve(undefined);
  };

  const call = <T>(msg: object, transfer: Transferable[] = []) =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ ...msg, id }, transfer);
    });

  async function pump() {
    if (busy) return;
    const job = pending.main ?? pending.thumb;
    if (!job) return;
    delete pending[job.lane];
    busy = true;
    try {
      job.resolve(await call<ConvertResult>({ type: 'run', lane: job.lane, crop: job.req.crop, opts: job.req.opts }));
    } catch (e) {
      job.reject(e instanceof Error ? e : new Error(String(e)));
    } finally {
      busy = false;
      void pump();
    }
  }

  return {
    async setSource(canvas) {
      for (const lane of LANES) { pending[lane]?.resolve(null); delete pending[lane]; }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2D canvas');
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      await call({ type: 'source', width, height, data: data.buffer }, [data.buffer]);
    },
    run(req, lane) {
      return new Promise((resolve, reject) => {
        pending[lane]?.resolve(null);
        pending[lane] = { lane, req: structuredClone(req), resolve, reject };
        void pump();
      });
    },
    dispose() { worker.terminate(); },
  };
}

/** The worker backend where module workers work, else inline. */
export function defaultBackend(): Backend {
  try {
    return workerBackend();
  } catch (e) {
    console.warn('conversion worker unavailable, converting on the main thread', e);
    return inlineBackend();
  }
}

export class Engine {
  #backend: Backend;
  #seq = { main: 0, thumb: 0 };
  /** Newest request whose result was handed out, per lane. */
  #shown = { main: 0, thumb: 0 };
  #source = 0;
  /** Columns keyframes, converted in parallel on workers of their own. */
  readonly frames = new FramePool();

  constructor(backend: Backend = defaultBackend()) {
    this.#backend = backend;
  }

  /** A new photo: every request made before it resolves to null. */
  async setSource(canvas: HTMLCanvasElement): Promise<void> {
    const id = ++this.#source;
    this.frames.setSource(canvas);
    await this.#backend.setSource(canvas);
    if (id !== this.#source) throw new Error('superseded');
  }

  /**
   * Convert. Resolves null when the result is older than one already handed out (or the photo
   * changed); a result that is merely not the newest request still comes back, so a drag that
   * outpaces the converter shows intermediate frames instead of none.
   */
  async convert(req: ConvertRequest, lane: Lane = 'main'): Promise<ConvertResult | null> {
    const id = ++this.#seq[lane], source = this.#source;
    const res = await this.#backend.run(req, lane);
    if (!res || source !== this.#source || id <= this.#shown[lane]) return null;
    this.#shown[lane] = id;
    return res;
  }

  /** Drop queued thumbnail work (a newer main request or thumbnail batch is coming). */
  cancelThumbs() {
    this.#shown.thumb = ++this.#seq.thumb;
  }

  dispose() {
    this.#backend.dispose();
    this.frames.cancel();
  }
}

/**
 * The Columns keyframes: a batch of conversions spread over several workers (convert.worker.ts,
 * each with its own copy of the photo), so it neither waits behind the preview nor slows it. The
 * workers exist only while a batch runs: each holds the decoded photo and its tables.
 */
export class FramePool {
  #canvas: HTMLCanvasElement | null = null;
  #batch = 0;
  #workers: Worker[] = [];
  /** Rejects the calls in flight (terminated workers never answer). */
  #stops = new Set<(e: Error) => void>();
  readonly size = Math.max(1, Math.min(6, (globalThis.navigator?.hardwareConcurrency ?? 4) - 2));

  setSource(canvas: HTMLCanvasElement) {
    this.cancel();
    this.#canvas = canvas;
  }

  /** Stop the running batch (it resolves null). */
  cancel() {
    this.#batch++;
    for (const w of this.#workers) w.terminate();
    this.#workers = [];
    for (const stop of this.#stops) stop(new Error('cancelled'));
    this.#stops.clear();
  }

  /**
   * Convert every request, largest first (the batch ends sooner). `onEach` hears of each result.
   * Resolves null when cancelled or when a newer batch starts.
   */
  async run(reqs: ConvertRequest[], onEach: (index: number, grid: Grid) => void): Promise<Grid[] | null> {
    this.cancel();
    const batch = this.#batch;
    const canvas = this.#canvas;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2D canvas');
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const order = reqs.map((_, i) => i).sort((a, b) => cellsOf(reqs[b]!) - cellsOf(reqs[a]!));
    const out: Grid[] = new Array(reqs.length);
    let next = 0;

    let workers: Worker[];
    try {
      workers = Array.from({ length: Math.min(this.size, reqs.length) }, () =>
        new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' }));
    } catch {
      // no module workers: one converter on this thread
      const conv = createConverter();
      conv.setSource(canvas);
      for (const i of order) {
        await new Promise(r => setTimeout(r, 0));
        if (batch !== this.#batch) return null;
        out[i] = conv.run(reqs[i]!.crop, reqs[i]!.opts);
        onEach(i, out[i]!);
      }
      return out;
    }
    this.#workers = workers;

    type Reply = { type: string; grid?: Grid; error?: string };
    const call = (w: Worker, msg: object) => new Promise<Reply>((resolve, reject) => {
      const done = () => this.#stops.delete(reject);
      this.#stops.add(reject);
      w.onmessage = e => { done(); resolve(e.data as Reply); };
      w.onerror = e => { done(); reject(new Error(e.message || 'the conversion worker failed')); };
      w.postMessage({ ...msg, id: 1 });
    });

    const lane = async (w: Worker) => {
      // a copy of the photo per worker (structured clone)
      await call(w, { type: 'source', width, height, data: data.buffer.slice(0) });
      while (next < order.length && batch === this.#batch) {
        const i = order[next++]!;
        const m = await call(w, { type: 'run', lane: 'main', crop: reqs[i]!.crop, opts: reqs[i]!.opts });
        if (batch !== this.#batch) return;
        if (m.type === 'error' || !m.grid) throw new Error(m.error ?? 'the conversion failed');
        out[i] = m.grid;
        onEach(i, m.grid);
      }
    };

    let ok = false;
    try {
      await Promise.all(workers.map(lane));
      ok = batch === this.#batch;
    } catch (e) {
      if (batch === this.#batch) throw e;
    } finally {
      if (batch === this.#batch) this.cancel();
    }
    return ok ? out : null;
  }
}

const cellsOf = (r: ConvertRequest) => r.opts.cols * r.opts.rows;
