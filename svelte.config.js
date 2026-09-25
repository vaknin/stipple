import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // A Tauri app is a static SPA: every route falls back to index.html.
    adapter: adapter({ fallback: 'index.html' }),
    // The Stipple theme's colours, shared with the shell plugin.
    alias: { $palette: 'shell-plugin/kivan.stipple/palette.mjs' },
    typescript: {
      // The vendored engine stays plain JS: it is typed from src/lib/engine/typist.d.ts, never checked.
      // $palette: TypeScript takes the types beside the module (a path to the .mjs itself would be
      // checked as JS); bun test skips the declaration and loads the .mjs.
      config: cfg => ({
        ...cfg,
        compilerOptions: {
          ...cfg.compilerOptions,
          paths: {
            ...cfg.compilerOptions?.paths,
            $palette: ['../shell-plugin/kivan.stipple/palette.d.mts', '../shell-plugin/kivan.stipple/palette.mjs'],
          },
        },
        exclude: [...(cfg.exclude ?? []), '../src/lib/typist/**'],
      }),
    },
  },
};
