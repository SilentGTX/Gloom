import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // original-fs is Electron's fs without asar support, built into Electron.
    build: { externalizeDeps: true, rollupOptions: { external: ['original-fs'] } }
  },
  preload: {
    resolve: { alias: shared },
    // Sandboxed preloads can only require 'electron', so nothing else may stay external.
    build: { externalizeDeps: false }
  },
  renderer: {
    resolve: { alias: { ...shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    // The highlighting worker loads each language as its own chunk, which needs ES module workers.
    worker: { format: 'es' },
    build: { rollupOptions: { input: { index: resolve('src/renderer/index.html') } } }
  }
})
