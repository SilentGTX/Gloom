// A new PC, as the Claude app's first run: no Claude Code anywhere Gloom looks,
// nobody signed in. Gloom downloads its own Claude Code (a real ~100 MB from
// npm's registry) and then asks you to sign in. Only when asked:
//   GLOOM_FIRST_RUN=1 npx playwright test test/e2e/first-run.spec.ts
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, tempDir } from './app'

test.skip(!process.env.GLOOM_FIRST_RUN, 'set GLOOM_FIRST_RUN=1 (downloads Claude Code)')

test('a new PC: Gloom gets Claude Code itself, then asks you to sign in', async () => {
  test.setTimeout(600_000)
  const saved = { ...process.env }
  // Nothing of yours: no claude.exe on PATH or in ~/.local/bin, an empty Claude folder.
  const home = tempDir('gloom-newpc-home-')
  mkdirSync(join(home, '.local', 'bin'), { recursive: true })
  const userData = tempDir('gloom-newpc-profile-')
  delete process.env.GLOOM_CLAUDE_EXE
  process.env.USERPROFILE = home
  process.env.PATH = [join(process.env.SystemRoot ?? 'C:\\Windows', 'System32'), process.env.SystemRoot ?? 'C:\\Windows'].join(';')
  process.env.GLOOM_SETUP = '1'
  try {
    const { app, page } = await launch({ userData, claudeDir: tempDir('gloom-newpc-claude-'), design: 'concept' })
    try {
      const setup = page.getByRole('dialog', { name: 'Gloom' })
      await expect(setup.getByRole('status')).toHaveText('Getting Claude Code ready…', { timeout: 30_000 })
      await expect(setup.getByRole('progressbar', { name: 'Download' })).toBeVisible()
      await page.screenshot({ path: join(__dirname, '..', '..', 'test-screens', 'first-run', 'downloading.png') })
      // Downloaded, checked and unpacked into Gloom's folder: then the sign-in step.
      await expect(setup.getByRole('status')).toHaveText('Sign in to Claude to start.', { timeout: 540_000 })
      await expect(setup.getByRole('button', { name: 'Sign In with Claude' })).toBeFocused()
      await page.screenshot({ path: join(__dirname, '..', '..', 'test-screens', 'first-run', 'sign-in.png') })
      // Claude Code is Gloom's own, in its profile.
      expect(existsSync(join(userData, 'claude-code'))).toBe(true)
    } finally {
      await app.close()
    }
  } finally {
    process.env = saved
  }
})
