import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built app (npm run build first) through
// Playwright's Electron driver.
export default defineConfig({
  testDir: 'test/e2e',
  outputDir: 'test-results',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']]
})
