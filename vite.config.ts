import { fileURLToPath } from 'node:url';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { devBridge } from './dev/bridge-plugin.ts';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [sveltekit(), devBridge()],
  resolve: {
    // The vendored Typist engine. A Vite-only alias on purpose: TypeScript does not resolve it, so
    // the ambient module declarations in src/lib/engine/typist.d.ts give the imports their types.
    alias: { $typist: fileURLToPath(new URL('./src/lib/typist/js', import.meta.url)) },
  },
  // Tauri prints its own errors; keep them on screen.
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 5174 } : undefined,
    watch: { ignored: ['**/src-tauri/**', '**/.dev-out/**'] },
  },
  worker: { format: 'es' },
});
