import { defineConfig } from 'vite';
import { DATA_CREDIT } from './src/math/words';

// A relative base lets the same build run from GitHub Pages' project path, from any folder, or from preview.
export default defineConfig({
  base: './',
  plugins: [
    {
      // 'pre', so the placeholder is filled before Vite reads %NAME% in HTML as an env variable.
      name: 'data-credit',
      transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('%DATA_CREDIT%', DATA_CREDIT) },
    },
  ],
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
