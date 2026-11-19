import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      externalizeDeps: true
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      // The wake listener's window gets a preload of its own (src/main/wake.ts).
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts'), wake: resolve(__dirname, 'src/preload/wake.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html'), wake: resolve(__dirname, 'src/renderer/wake.html') }
      }
    }
  }
})
