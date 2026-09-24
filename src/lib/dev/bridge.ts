// Dev-only: the page side of dev/bridge-plugin.ts. Imported behind `import.meta.env.DEV`, so a
// release build never contains it. Snippets run as async function bodies with `window.TW` in reach.

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** JSON-safe copy: typed arrays become plain arrays, errors their message. */
function plain(v: unknown): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x: unknown) => {
    if (ArrayBuffer.isView(x) && !(x instanceof DataView)) return Array.from(x as unknown as ArrayLike<number>);
    if (x instanceof Error) return x.message;
    return x;
  }) ?? 'null');
}

export async function devSave(name: string, data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const r = await fetch(`/__bridge/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: data as BodyInit });
  return ((await r.json()) as { path: string }).path;
}

export function devLog(...parts: unknown[]) {
  const text = parts.map(p => (typeof p === 'string' ? p : JSON.stringify(plain(p)))).join(' ');
  fetch('/__bridge/log', { method: 'POST', body: text }).catch(() => {});
}

let started = false;
export function startBridge() {
  if (started) return;
  started = true;
  const run = async () => {
    for (;;) {
      let job: { id: number; code: string } | null = null;
      try {
        const r = await fetch('/__bridge/next');
        if (r.status !== 200) continue;
        job = (await r.json()) as { id: number; code: string };
      } catch {
        await sleep(1000);
        continue;
      }
      let answer: { id: number; ok: boolean; value?: unknown; error?: string };
      try {
        const fn = new Function(`return (async () => {\n${job.code}\n})()`) as () => Promise<unknown>;
        answer = { id: job.id, ok: true, value: plain(await fn()) };
      } catch (e) {
        answer = { id: job.id, ok: false, error: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e) };
      }
      await fetch('/__bridge/result', { method: 'POST', body: JSON.stringify(answer) }).catch(() => {});
    }
  };
  void run();
}
