import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The public address, with a trailing slash. CI passes the one GitHub Pages
 * reports, so a custom domain or a move to another account needs no edit here.
 */
const SITE_URL = (process.env.SITE_URL || 'https://hotragn.github.io/Omni-Laya/').replace(/\/?$/, '/');
const PAGES = ['', 'about.html'];

/**
 * Fills %SITE_URL% in the HTML (share cards and canonical links need absolute
 * URLs) and writes the files crawlers and installers look for.
 */
function siteFiles(): Plugin {
  return {
    name: 'omnilaya-site-files',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    generateBundle() {
      const emit = (fileName: string, source: string) => this.emitFile({ type: 'asset', fileName, source });
      emit('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}sitemap.xml\n`);
      emit(
        'sitemap.xml',
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(
          (p) => `  <url><loc>${SITE_URL}${p}</loc></url>`
        ).join('\n')}\n</urlset>\n`
      );
      emit(
        'manifest.webmanifest',
        JSON.stringify(
          {
            id: './',
            name: 'OmniLaya Search',
            short_name: 'OmniLaya',
            description: 'Search that runs on your device. Laya picks the sources and ranks every result in your browser.',
            start_url: './',
            scope: './',
            display: 'standalone',
            background_color: '#f4eee3',
            theme_color: '#f4eee3',
            lang: 'en',
            categories: ['productivity', 'developer tools'],
            icons: [
              { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
              { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
              { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
          },
          null,
          2
        )
      );
    },
  };
}

/**
 * OmniLaya, the static build: everything runs in the reader's browser, so the
 * output in dist-local/ can be served by any static host (GitHub Pages, a
 * USB stick behind `npx serve`). `base: './'` keeps it working under a subpath.
 */
export default defineConfig({
  root: fileURLToPath(new URL('./local', import.meta.url)),
  base: './',
  publicDir: fileURLToPath(new URL('./local/public', import.meta.url)),
  plugins: [viteReact(), tailwindcss(), siteFiles()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('./dist-local', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./local/index.html', import.meta.url)),
        about: fileURLToPath(new URL('./local/about.html', import.meta.url)),
      },
    },
  },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  server: { port: 3040 },
});
