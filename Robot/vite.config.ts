import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron/simple';

export default defineConfig({
  plugins: [
    electron({
      main: {
        entry: 'src/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['playwright-core', '@napi-rs/canvas', 'pdfjs-dist', 'tesseract.js'],
            },
          },
        },
      },
      preload: {
        input: 'src/preload.ts',
      },
    }),
  ],
});
