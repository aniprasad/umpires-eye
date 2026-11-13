import { defineConfig } from 'vite';

// A relative base lets the same build run from GitHub Pages' project path, from any folder, or from preview.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
