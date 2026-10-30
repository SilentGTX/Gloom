import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeSession } from '../support/transcripts'
import { captureWindow, fakeClaude, launch, minutesAgo, sendUpdateReady, setWindowSize } from './app'

// Captures of the window as Windows draws it (caption buttons, border), in
// light and dark, with glass as this PC's settings give it and with glass on:
// Windows' "Transparency effects: off" reaches the page as reduced transparency.
// Output: test-screens/ (Playwright empties test-results/ on every run).
const dir = join(__dirname, '..', '..', 'test-screens')
// Each capture starts PowerShell and compiles a small C# helper: seconds apiece.
test.setTimeout(180_000)

let n = 0
const id = () => `dddddddd-0000-4000-8000-${String(++n).padStart(12, '0')}`
/** A demo library: made-up sessions, never yours. */
const DEMO: FakeSession[] = [
  { id: id(), cwd: 'D:\\JS\\Gloom', prompt: 'Make the folder tree keyboard friendly', title: 'Folder tree keyboard support', updated: minutesAgo(0) },
  { id: id(), cwd: 'D:\\JS\\Gloom', prompt: 'Why does the list jump when a transcript grows?', title: 'Session list scroll jumps', updated: minutesAgo(25) },
  { id: id(), cwd: 'D:\\JS\\Gloom', prompt: 'Add Undo to deleting a folder', title: 'Undo for folder delete', updated: minutesAgo(140) },
  { id: id(), cwd: 'D:\\Work\\api', prompt: 'Add rate limiting to the public API', title: 'API rate limits', updated: minutesAgo(60 * 5) },
  { id: id(), cwd: 'D:\\Work\\web', prompt: 'The login page loops after a password reset', title: 'Login redirect loop', updated: minutesAgo(60 * 26) },
  { id: id(), cwd: 'D:\\Work\\web', prompt: 'Move the settings page to the new grid', title: 'Settings page layout', updated: minutesAgo(60 * 50) },
  { id: id(), cwd: 'D:\\JS\\quiz', prompt: 'Weekly leaderboard with a reset on Mondays', title: 'Weekly leaderboard', updated: minutesAgo(60 * 24 * 3) },
  { id: id(), cwd: 'D:\\JS\\quiz', prompt: 'Make the timer ring smoother', title: 'Timer animation', updated: minutesAgo(60 * 24 * 9) },
  { id: id(), cwd: 'D:\\Home\\photos', prompt: 'Sort the 2025 photos by trip', title: 'Photo library cleanup', updated: minutesAgo(60 * 24 * 12) },
  { id: id(), cwd: 'D:\\Home\\budget', prompt: 'Summarise this month’s spending by category', title: 'Monthly budget summary', updated: minutesAgo(60 * 24 * 20) }
]

async function seedFolders(page: Page) {
  const apply = (op: object) => page.evaluate((o) => window.gloom!.applyLibrary(o as never), op)
  const create = async (name: string, parentId: string | null = null) => (await apply({ type: 'createFolder', parentId, name })).folderId!
  const gloom = await create('Gloom')
  const work = await create('Work')
  await create('Clients', work)
  await create('Home')
  await apply({ type: 'setFilingRules', id: gloom, paths: ['D:\\JS\\Gloom'] })
  await apply({ type: 'setFilingRules', id: work, paths: ['D:\\Work'] })
  await apply({ type: 'setPinned', ids: [DEMO[3].id], pinned: true })
  await page.getByRole('treeitem', { name: /^All Sessions/ }).click()
  await page.getByRole('option').nth(1).click()
}

async function allowTransparency(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] })
}

async function open(theme: 'light' | 'dark', glass: 'system' | 'on'): Promise<{ app: ElectronApplication; page: Page }> {
  const { app, page } = await launch({ claudeDir: fakeClaude(DEMO) })
  await setWindowSize(app, 1280, 800)
  await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
  if (glass === 'on') await allowTransparency(page)
  await expect(page.getByRole('option')).toHaveCount(DEMO.length)
  await seedFolders(page)
  await page.waitForTimeout(500)
  return { app, page }
}

for (const theme of ['light', 'dark'] as const) {
  for (const glass of ['system', 'on'] as const) {
    test(`window captures, ${theme}, glass ${glass}`, async () => {
      mkdirSync(dir, { recursive: true })
      const { app, page } = await open(theme, glass)
      const name = `${theme}-glass-${glass}`
      await captureWindow(app, join(dir, `shell-${name}.png`))

      // A session's context menu, aimed at a row that isn't selected.
      await page.getByRole('option').nth(3).click({ button: 'right' })
      await page.getByRole('menu').waitFor()
      await page.waitForTimeout(250)
      await captureWindow(app, join(dir, `context-menu-${name}.png`))
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      // The update button once it has settled after lighting up.
      await sendUpdateReady(app, '0.4.0')
      await page.waitForTimeout(2000)
      await captureWindow(app, join(dir, `update-${name}.png`))

      await page.getByRole('button', { name: 'Menu' }).first().click()
      await page.getByRole('menu').waitFor()
      await page.waitForTimeout(250)
      await captureWindow(app, join(dir, `menu-${name}.png`))
      await page.getByRole('menu').press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      // Filing rules for a folder.
      await page.getByRole('treeitem', { name: /^Work/ }).click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Filing Rules…' }).click()
      await page.getByRole('dialog').waitFor()
      await page.waitForTimeout(350)
      await captureWindow(app, join(dir, `filing-rules-${name}.png`))
      await page.getByRole('button', { name: 'Cancel' }).click()

      await setWindowSize(app, 760, 640)
      await page.getByRole('button', { name: 'Show folders' }).click()
      await page.waitForTimeout(450)
      await captureWindow(app, join(dir, `narrow-sheet-${name}.png`))
      await app.close()
    })
  }
}

test('a drag in progress', async () => {
  mkdirSync(dir, { recursive: true })
  const { app, page } = await open('light', 'on')
  const from = (await page.getByRole('option').nth(4).boundingBox())!
  const to = (await page.getByRole('treeitem', { name: /^Clients/ }).boundingBox())!
  await page.getByRole('option').nth(4).click()
  await page.getByRole('option').nth(5).click({ modifiers: ['Shift'] })
  await page.mouse.move(from.x + 60, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 80, from.y + 30, { steps: 4 })
  await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 12 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(dir, 'drag-light.png') })
  await page.mouse.up()
  await expect(page.getByRole('treeitem', { name: /^Clients/ })).toContainText('2')

  // Deleting a folder: its sessions go to Unfiled, and a toast offers Undo.
  await page.getByRole('treeitem', { name: /^Work/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete Folder' }).click()
  await page.getByRole('button', { name: 'Undo' }).waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(dir, 'undo-toast-light.png') })
  await app.close()
})
