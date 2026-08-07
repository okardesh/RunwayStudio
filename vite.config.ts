import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              // keep native/large packages as external requires in the main process
              external: ['playwright-core'],
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
})
