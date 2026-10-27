import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
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
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
