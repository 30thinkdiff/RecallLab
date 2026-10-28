import { defineConfig } from 'vitest/config';
import { offlineShell } from './build/offline';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  optimizeDeps: { include: ['ts-fsrs'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/')) {
            if (/\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
            if (id.includes('/dexie')) return 'storage-vendor';
            if (id.includes('/zod/')) return 'validation-vendor';
          }
        },
      },
    },
  },
  plugins: [
    offlineShell(),
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/tesseract.js/dist/worker.min.js', dest: 'ocr-assets/7' },
        { src: 'node_modules/tesseract.js-core/*lstm.wasm*', dest: 'ocr-assets/7/core' },
        {
          src: 'node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz',
          dest: 'ocr-assets/7/lang',
        },
        {
          src: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
          dest: 'ocr-assets/7/lang',
        },
        { src: 'node_modules/pdfjs-dist/cmaps/*', dest: 'pdf-assets/5.5.207/cmaps' },
        {
          src: 'node_modules/pdfjs-dist/standard_fonts/*',
          dest: 'pdf-assets/5.5.207/standard_fonts',
        },
        { src: 'node_modules/pdfjs-dist/wasm/*', dest: 'pdf-assets/5.5.207/wasm' },
      ],
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    restoreMocks: true,
  },
});
