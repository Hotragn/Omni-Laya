import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
  resolve: {
    // fileURLToPath, not URL.pathname: the latter keeps %20 for spaces and a leading slash on Windows drives.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
