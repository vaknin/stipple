// Rolling timings of the conversion (run) and the preview draw, for the dev overlay and the README
// measurements. Recording is cheap; the overlay reads p50 / p95 a few times a second.

const WINDOW = 120;

function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

export type Lane = 'run' | 'draw' | 'frame';

class Perf {
  #data: Record<Lane, number[]> = { run: [], draw: [], frame: [] };
  /** Bumped (throttled) when new samples arrive, so the overlay re-reads. */
  version = $state(0);
  #pending = false;

  add(lane: Lane, ms: number) {
    const a = this.#data[lane];
    a.push(ms);
    if (a.length > WINDOW) a.shift();
    if (!this.#pending) {
      this.#pending = true;
      setTimeout(() => { this.#pending = false; this.version++; }, 250);
    }
  }

  stats(lane: Lane) {
    const a = this.#data[lane];
    return { n: a.length, p50: quantile(a, 0.5), p95: quantile(a, 0.95), max: a.length ? Math.max(...a) : 0 };
  }

  reset() {
    this.#data = { run: [], draw: [], frame: [] };
    this.version++;
  }
}

export const perf = new Perf();
