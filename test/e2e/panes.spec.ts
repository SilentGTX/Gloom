import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { demoSession, DEMO_TITLE } from '../support/demo'
import { fakeClaude, launch, openGroup, pressRealKeys, sessionRow, setWindowSize, tempDir, triggerShortcut } from './app'

// The diff and terminal panes (Phase 5), on the made-up demo session.
// Captures for review go to test-screens/ (ignored by git).
const screens = join(__dirname, '..', '..', 'test-screens')

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

async function openDemo(width = 1440, height = 900) {
  const cwd = tempDir('gloom-project-')
  const claudeDir = fakeClaude([])
  demoSession(cwd).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir }))
  await setWindowSize(app, width, height)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, DEMO_TITLE).click()
  return { cwd }
}

const diffPane = (p: Page) => p.locator('aside[aria-label="Diff"]')
const terminalPane = (p: Page) => p.locator('section[aria-label="Terminal"]')
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=gloom@example.com', '-c', 'user.name=Gloom', ...args], { cwd, windowsHide: true })

/** Captures the window in dark and in light (each test has its own profile, so the theme change stays there). */
async function capture(name: string) {
  mkdirSync(screens, { recursive: true })
  await page.evaluate(() => window.gloom!.setSettings({ theme: 'dark' }))
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(screens, `${name}-dark.png`) })
  await page.evaluate(() => window.gloom!.setSettings({ theme: 'light' }))
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(screens, `${name}-light.png`) })
}

test('the diff pane shows the session’s edits composed per file', async () => {
  await openDemo()
  await triggerShortcut(app, 'CmdOrCtrl+Shift+D')
  const pane = diffPane(page)
  await expect(pane.getByRole('tab', { name: 'This Session' })).toHaveAttribute('aria-selected', 'true')
  // limits.ts was made and then edited: one file, every line added, the edit in place.
  const limits = pane.getByRole('button', { name: 'src/limits.ts, Added, 18 lines added, 0 removed' })
  await expect(limits).toBeVisible()
  await expect(pane.getByText("return reply.code(401).send({ error: 'Missing API key' })", { exact: false })).toBeVisible()
  // server.ts: the line the edit took out and put back counts as unchanged, as git would show it.
  await expect(pane.getByRole('button', { name: 'src/server.ts, Modified, 2 lines added, 0 removed' })).toBeVisible()
  await expect(pane.getByText('2 files changed')).toBeVisible()
  // The toolbar button shows the pane is out.
  await expect(page.getByRole('button', { name: 'Diff', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await capture('diff-session')

  // A file folds under its header.
  await limits.click()
  await expect(limits).toHaveAttribute('aria-expanded', 'false')
  await expect(pane.getByText("Missing API key", { exact: false })).toHaveCount(0)

  await triggerShortcut(app, 'CmdOrCtrl+Shift+D')
  await expect(pane).toHaveCount(0)
})

test('Working Tree shows what git sees, untracked files included', async () => {
  const { cwd } = await openDemo()
  await triggerShortcut(app, 'CmdOrCtrl+Shift+D')
  const pane = diffPane(page)
  await pane.getByRole('tab', { name: 'Working Tree' }).click()
  await expect(pane.getByText('Not a Git Repository')).toBeVisible()

  mkdirSync(join(cwd, 'src'), { recursive: true })
  writeFileSync(join(cwd, 'src', 'server.ts'), "import Fastify from 'fastify'\nconst app = Fastify()\nexport default app\n")
  git(cwd, 'init', '-q', '-b', 'main')
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-q', '-m', 'first')
  writeFileSync(join(cwd, 'src', 'server.ts'), "import Fastify from 'fastify'\nconst app = Fastify({ logger: true })\nexport default app\n")
  writeFileSync(join(cwd, 'notes.md'), '# Limits\n\n100 a minute.\n')
  await triggerShortcut(app, 'F5')

  await expect(pane.getByRole('button', { name: 'src/server.ts, Modified, 1 line added, 1 removed' })).toBeVisible()
  await expect(pane.getByRole('button', { name: 'notes.md, Untracked, 3 lines added, 0 removed' })).toBeVisible()
  await expect(pane.getByText('main', { exact: true })).toBeVisible()
  await capture('diff-tree')
})

test('in a narrow window the diff pane floats over the chat, and Escape puts it away', async () => {
  await openDemo(900, 760)
  await triggerShortcut(app, 'CmdOrCtrl+Shift+D')
  const sheet = page.getByRole('dialog', { name: 'Diff' })
  await expect(sheet.getByRole('tab', { name: 'This Session' })).toBeVisible()
  await capture('diff-narrow')
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)
})

test('the terminal pane opens a shell in the session’s folder, takes typing, and leaves with its last tab', async () => {
  test.setTimeout(60_000)
  const { cwd } = await openDemo()
  await triggerShortcut(app, 'CmdOrCtrl+`')
  const pane = terminalPane(page)
  await expect(pane.getByRole('tab', { name: 'PowerShell' })).toBeVisible()
  const rows = pane.locator('.xterm-rows')
  // The shell is up when its prompt shows the session's folder.
  await expect(rows).toContainText(basename(cwd), { timeout: 20_000 })
  await expect(pane.locator('.xterm-helper-textarea')).toBeFocused()
  await page.keyboard.type('Write-Output ("gloom-" + "terminal-ok")')
  await page.keyboard.press('Enter')
  await expect(rows).toContainText('gloom-terminal-ok', { timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await capture('terminal')

  // A second tab, in the same folder.
  await triggerShortcut(app, 'CmdOrCtrl+Shift+`')
  await expect(pane.getByRole('tab')).toHaveCount(2)
  await expect(pane.getByRole('tab', { name: 'PowerShell 2' })).toHaveAttribute('aria-selected', 'true')
  // exit closes a tab that ended cleanly; closing the last one puts the pane away.
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect(pane.getByRole('tab')).toHaveCount(1, { timeout: 15_000 })
  await pane.getByRole('button', { name: 'Close PowerShell' }).click()
  await expect(pane).toHaveCount(0)
})

// Real keystrokes take the foreground, so this runs only when asked (GLOOM_E2E_REAL_KEYS=1).
test('the shell keeps its own keys (Ctrl+R), and Gloom’s pane shortcuts still work from the terminal', async () => {
  test.skip(process.env.GLOOM_E2E_REAL_KEYS !== '1', 'set GLOOM_E2E_REAL_KEYS=1 to send real keystrokes')
  test.setTimeout(90_000)
  const { cwd } = await openDemo(1300, 860)
  await triggerShortcut(app, 'CmdOrCtrl+`')
  const rows = terminalPane(page).locator('.xterm-rows')
  await expect(rows).toContainText(basename(cwd), { timeout: 20_000 })
  await page.evaluate(() => ((window as unknown as { kept: number }).kept = 1))
  // Ctrl+R is PSReadLine's history search, not Gloom's Reload: the page is the same page.
  await pressRealKeys(app, '^r')
  await expect(rows).toContainText(/bck-i-search/i, { timeout: 5_000 })
  expect(await page.evaluate(() => (window as unknown as { kept?: number }).kept)).toBe(1)
  await pressRealKeys(app, '{ESC}')
  await pressRealKeys(app, 'echo typed-for-real{ENTER}')
  await expect(rows).toContainText('typed-for-real', { timeout: 10_000 })
  // Ctrl+` reaches Gloom's menu from inside the terminal, both ways.
  await pressRealKeys(app, '^`')
  await expect(terminalPane(page)).toHaveCount(0, { timeout: 5_000 })
  await pressRealKeys(app, '^`')
  await expect(terminalPane(page).locator('.xterm-rows')).toContainText('typed-for-real', { timeout: 5_000 })
  await terminalPane(page).locator('.xterm-helper-textarea').focus()
  await pressRealKeys(app, '^+d')
  await expect(diffPane(page)).toBeVisible({ timeout: 5_000 })
})

test('hiding the terminal keeps its shell, and showing it again finds the screen as it was', async () => {
  test.setTimeout(60_000)
  const { cwd } = await openDemo()
  await triggerShortcut(app, 'CmdOrCtrl+`')
  const pane = terminalPane(page)
  const rows = pane.locator('.xterm-rows')
  await expect(rows).toContainText(basename(cwd), { timeout: 20_000 })
  await page.keyboard.type('Write-Output ("still-" + "here")')
  await page.keyboard.press('Enter')
  await expect(rows).toContainText('still-here', { timeout: 15_000 })
  await triggerShortcut(app, 'CmdOrCtrl+`')
  await expect(pane).toHaveCount(0)
  await triggerShortcut(app, 'CmdOrCtrl+`')
  await expect(terminalPane(page).locator('.xterm-rows')).toContainText('still-here')
  await expect(terminalPane(page).getByRole('tab')).toHaveCount(1)
})
