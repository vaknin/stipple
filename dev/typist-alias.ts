// bun test preload (bunfig.toml): resolve the Vite-only `$typist/*` alias to the vendored engine.
import { plugin } from 'bun';

const root = new URL('../src/lib/typist/js/', import.meta.url).pathname;

plugin({
  name: 'typist-alias',
  setup(build) {
    build.onResolve({ filter: /^\$typist\// }, args => ({ path: root + args.path.slice('$typist/'.length) }));
  },
});
