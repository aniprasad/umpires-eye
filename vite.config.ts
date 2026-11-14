import { defineConfig } from 'vite';
import { CREDIT } from './src/core/rules.ts';

// A relative base lets the same build run from GitHub Pages' project path, from any folder, or from preview.
export default defineConfig({
  base: './',
  // No single-page fallback: a data file the server lacks is a 404, as on GitHub Pages, not the app's page.
  appType: 'mpa',
  plugins: [
    {
      // 'pre', so the placeholder is filled before Vite reads %NAME% in HTML as an env variable.
      name: 'data-credit',
      transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('%DATA_CREDIT%', CREDIT) },
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
