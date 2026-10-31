import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';
import manifest from './manifest.config.ts';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: { target: 'chrome116', outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: { fs: { allow: ['..'] } },
});
