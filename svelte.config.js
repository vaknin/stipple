import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // A Tauri app is a static SPA: every route falls back to index.html.
    adapter: adapter({ fallback: 'index.html' }),
    typescript: {
      // The vendored engine stays plain JS: it is typed from src/lib/engine/typist.d.ts, never checked.
      config: cfg => ({ ...cfg, exclude: [...(cfg.exclude ?? []), '../src/lib/typist/**'] }),
    },
  },
};
