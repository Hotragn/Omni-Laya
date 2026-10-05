import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * OmniLaya, the static build: everything runs in the reader's browser, so the
 * output in dist-local/ can be served by any static host (GitHub Pages, a
 * USB stick behind `npx serve`). `base: './'` keeps it working under a subpath.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./local', import.meta.url)),
  base: './',
  publicDir: fileURLToPath(new URL('./local/public', import.meta.url)),
  plugins: [viteReact(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('./dist-local', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
  },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  server: { port: 3040 },
});
