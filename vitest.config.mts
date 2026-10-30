import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests only; the Playwright specs in test/e2e run with `npm run e2e`.
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer/src') } },
  test: { include: ['test/unit/**/*.test.ts'] }
})
