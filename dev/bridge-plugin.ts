// Dev-only bridge between the terminal and the running app (`vite dev` only; never in a build).
//
// WebKitGTK does not print console messages and has no remote protocol here, so this lets scripts
// drive the dev window and read results back:
//   POST /__bridge/eval    body: JS source (an async function body). Runs in the app window and
//                          answers with {ok, value} or {ok: false, error}.
//   GET  /__bridge/next    the page's long poll for the next snippet (src/lib/dev/bridge.ts)
//   POST /__bridge/result  the page's answer to a snippet
//   POST /__bridge/save?name=file.png   raw bytes from the page, written to $TW_DEV_OUT or .dev-out/
//   POST /__bridge/log     text from the page, printed in the dev server's terminal
// dev/tw.sh wraps /__bridge/eval for the shell.

import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

interface Job { id: number; code: string }
type Answer = { id: number; ok: boolean; value?: unknown; error?: string };

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });
}

function send(res: ServerResponse, status: number, value?: unknown) {
  res.statusCode = status;
  if (value === undefined) { res.end(); return; }
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(value));
}

export function devBridge(): Plugin {
  const queue: Job[] = [];
  const answers = new Map<number, (a: Answer) => void>();
  let poller: ServerResponse | null = null;
  let seq = 0;
  const outDir = resolve(process.env.TW_DEV_OUT || '.dev-out');

  const flush = () => {
    if (!poller || !queue.length) return;
    const res = poller;
    poller = null;
    send(res, 200, queue.shift());
  };

  return {
    name: 'stipple-dev-bridge',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__bridge', async (req, res) => {
        const url = new URL(req.url || '/', 'http://x');
        try {
          if (url.pathname === '/next' && req.method === 'GET') {
            if (poller) send(poller, 204);
            poller = res;
            const mine = res;
            setTimeout(() => { if (poller === mine) { poller = null; send(mine, 204); } }, 20000);
            flush();
            return;
          }
          if (url.pathname === '/eval' && req.method === 'POST') {
            const code = (await body(req)).toString('utf8');
            const id = ++seq;
            const timeout = Number(url.searchParams.get('timeout') || 120) * 1000;
            const answer = new Promise<Answer>(ok => {
              answers.set(id, ok);
              setTimeout(() => {
                if (answers.delete(id)) ok({ id, ok: false, error: 'timeout: no answer from the app window' });
              }, timeout);
            });
            queue.push({ id, code });
            flush();
            send(res, 200, await answer);
            return;
          }
          if (url.pathname === '/result' && req.method === 'POST') {
            const a = JSON.parse((await body(req)).toString('utf8')) as Answer;
            answers.get(a.id)?.(a);
            answers.delete(a.id);
            send(res, 204);
            return;
          }
          if (url.pathname === '/save' && req.method === 'POST') {
            const name = basename(url.searchParams.get('name') || 'out.bin');
            mkdirSync(outDir, { recursive: true });
            const path = join(outDir, name);
            writeFileSync(path, await body(req));
            send(res, 200, { path });
            return;
          }
          if (url.pathname === '/log' && req.method === 'POST') {
            server.config.logger.info(`[app] ${(await body(req)).toString('utf8')}`);
            send(res, 204);
            return;
          }
          send(res, 404, { error: 'unknown bridge route' });
        } catch (e) {
          send(res, 500, { error: String(e) });
        }
      });
    },
  };
}
