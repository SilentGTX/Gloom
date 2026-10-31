import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEMO_TITLE, demoSession } from '../support/demo'
import { fakeClaude, openGroup, sessionRow, setWindowSize, tempDir, triggerShortcut } from './app'

// A packaged build, checked before it's released:
//   GLOOM_PACKAGED_EXE=release\<version>\win-unpacked\Gloom.exe npx playwright test packaged
// It runs from inside the app archive with no update check (--no-update) and a
// throwaway profile and Claude folder: the transcripts process, git by its full
// path, node-pty from app.asar.unpacked, the keyboard's rings and F6, the
// clipboard (the only permission the page has), and Resume in Terminal (a dry run).
const exe = process.env.GLOOM_PACKAGED_EXE
test.skip(!exe, 'set GLOOM_PACKAGED_EXE to a packaged Gloom.exe')
test.setTimeout(120_000)

test('a packaged build opens a session, its panes and its keyboard', async () => {
  const cwd = tempDir('gloom-packaged-')
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=gloom@example.com', '-c', 'user.name=Gloom', ...args], { cwd, windowsHide: true })
  writeFileSync(join(cwd, 'server.ts'), 'export const port = 3000\n')
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  writeFileSync(join(cwd, 'server.ts'), 'export const port = 8080\n')
  const claudeDir = fakeClaude([])
  demoSession(cwd).write(join(claudeDir, 'projects'))

  const app = await electron.launch({
    executablePath: exe!,
    args: ['--no-update', `--user-data-dir=${tempDir('gloom-packaged-profile-')}`],
    env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, GLOOM_RESUME_DRY_RUN: '1' },
    colorScheme: null
  })
  const page = await app.firstWindow()
  await page.waitForSelector('main')
  await expect(page.locator('[inert]')).toHaveCount(0)
  await setWindowSize(app, 1280, 860)
  expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true)

  // The transcript, read by the transcripts process from inside the archive.
  await openGroup(page, 'All Sessions')
  await sessionRow(page, DEMO_TITLE).click()
  await page.locator('img[alt="Attached image"]').waitFor()

  // Keyboard focus shows, and F6 moves between the panes.
  await page.getByLabel('Transcript').focus()
  await page.keyboard.press('Shift+Tab')
  const ring = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    return { tag: el.tagName, outline: getComputedStyle(el).outlineStyle }
  })
  expect(ring).toEqual({ tag: 'BUTTON', outline: 'solid' })
  await triggerShortcut(app, 'F6')
  expect(await page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane'))).toBe('transcript')

  // Copy Code reaches the clipboard (whatever was on it goes back afterwards).
  const before = await app.evaluate(({ clipboard }) => clipboard.readText())
  await page.getByRole('button', { name: 'Copy Code' }).first().click()
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('rateLimit')
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), before)

  // Working Tree: git, run by its full path.
  await triggerShortcut(app, 'CmdOrCtrl+Shift+D')
  const diff = page.locator('aside[aria-label="Diff"]')
  await diff.getByRole('tab', { name: 'Working Tree' }).click()
  await expect(diff.getByRole('button', { name: 'server.ts, Modified, 1 line added, 1 removed' })).toBeVisible({ timeout: 15_000 })

  // A shell in the terminal pane (node-pty from app.asar.unpacked).
  await triggerShortcut(app, 'CmdOrCtrl+`')
  const terminal = page.locator('section[aria-label="Terminal"]')
  await expect(terminal.getByRole('tab', { name: 'PowerShell' })).toBeVisible()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await page.keyboard.type('Write-Output ("packaged-" + "terminal-ok")')
  await page.keyboard.press('Enter')
  await expect(terminal.locator('.xterm-rows')).toContainText('packaged-terminal-ok', { timeout: 20_000 })

  // Resume in Terminal, as far as the command it would run.
  await page.getByRole('button', { name: 'Session info' }).click()
  await page.getByRole('button', { name: 'Resume in Terminal' }).click()
  await expect(page.getByText('Resumed in a terminal window')).toBeVisible()
  await app.close()
})
