import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEMO_ID, demoSession } from '../support/demo'
import type { FakeSession } from '../support/transcripts'
import { captureWindow, fakeClaude, groupRow, launch, minutesAgo, openGroup, sendUpdateReady, sessionRow, setWindowSize, triggerShortcut } from './app'

// Captures of the window as Windows draws it (caption buttons, border), in
// light and dark, with glass as this PC's settings give it and with glass on:
// Windows' "Transparency effects: off" reaches the page as reduced transparency.
// Output: test-screens/ (Playwright empties test-results/ on every run).
const dir = join(__dirname, '..', '..', 'test-screens')
// Each capture starts PowerShell and compiles a small C# helper: seconds apiece.
test.setTimeout(180_000)

let n = 0
const id = () => `dddddddd-0000-4000-8000-${String(++n).padStart(12, '0')}`
/** A demo library shaped like the one-sidebar mockup: made-up sessions, never yours. */
const DEMO = {
  gloom: [
    { id: id(), cwd: 'D:\\JS\\Gloom', prompt: 'phase 2 is ready, start with phase 3', title: 'Phase 3', updated: minutesAgo(0), entrypoint: 'claude-desktop' },
    { id: id(), cwd: 'D:\\JS\\Gloom', prompt: 'Commit and push', title: 'phase 2', updated: minutesAgo(33) },
    { id: id(), cwd: 'D:\\JS\\Gloom', prompt: 'Yes, commit and push', title: 'phase 1', updated: minutesAgo(62) }
  ],
  tv: [
    { id: id(), cwd: 'D:\\JS\\blissful-tv', prompt: 'Sync the episode guide nightly', title: 'Episode guide sync', updated: minutesAgo(60 * 50) },
    { id: id(), cwd: 'D:\\JS\\blissful-tv', prompt: 'Bigger player controls on the TV', title: 'Player controls', updated: minutesAgo(60 * 24 * 5) },
    { id: id(), cwd: 'D:\\JS\\blissful-tv', prompt: 'Subtitles drift after an hour', title: 'Subtitle timing', updated: minutesAgo(60 * 24 * 12) }
  ],
  web: [
    { id: id(), cwd: 'D:\\JS\\website', prompt: 'Rewrite the pricing page copy', title: 'Pricing page copy', updated: minutesAgo(60 * 24 * 9) },
    { id: id(), cwd: 'D:\\JS\\website', prompt: 'Preview deploys for every branch', title: 'Deploy previews', updated: minutesAgo(60 * 24 * 20) }
  ],
  unfiled: [
    { id: id(), cwd: 'D:\\Work\\api', prompt: 'Add rate limiting to the public API', title: 'API rate limits', updated: minutesAgo(60 * 5) },
    { id: id(), cwd: 'D:\\Work\\web', prompt: 'The login page loops after a password reset', title: 'Login redirect loop', updated: minutesAgo(60 * 26) },
    { id: id(), cwd: 'D:\\Home\\photos', prompt: 'Sort the 2025 photos by trip', title: 'Photo library cleanup', updated: minutesAgo(60 * 24 * 14) },
    { id: id(), cwd: 'D:\\Home\\budget', prompt: 'Summarise this month’s spending by category', title: 'Monthly budget summary', updated: minutesAgo(60 * 24 * 20) }
  ]
} satisfies Record<string, FakeSession[]>
const ALL = Object.values(DEMO).flat()

async function seedFolders(page: Page) {
  const apply = (op: object) => page.evaluate((o) => window.gloom!.applyLibrary(o as never), op)
  const create = async (name: string, parentId: string | null = null) => (await apply({ type: 'createFolder', parentId, name })).folderId!
  const folders = { gloom: await create('Gloom'), tv: await create('Blissful TV'), web: await create('Website') }
  for (const key of ['gloom', 'tv', 'web'] as const) await apply({ type: 'moveSessions', ids: DEMO[key].map((s) => s.id), folderId: folders[key] })
  await apply({ type: 'setPinned', ids: [DEMO.unfiled[0].id, DEMO.web[0].id], pinned: true })
  await openGroup(page, 'Gloom')
  await sessionRow(page, 'Phase 3', `folder:${folders.gloom}`).click()
  return folders
}

async function allowTransparency(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] })
}

async function open(theme: 'light' | 'dark', glass: 'system' | 'on'): Promise<{ app: ElectronApplication; page: Page; folders: Record<string, string> }> {
  const { app, page } = await launch({ claudeDir: fakeClaude(ALL) })
  await setWindowSize(app, 1280, 800)
  await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
  if (glass === 'on') await allowTransparency(page)
  await expect(groupRow(page, 'All Sessions')).toContainText(String(ALL.length))
  const folders = await seedFolders(page)
  await page.waitForTimeout(500)
  return { app, page, folders }
}

for (const theme of ['light', 'dark'] as const) {
  for (const glass of ['system', 'on'] as const) {
    test(`window captures, ${theme}, glass ${glass}`, async () => {
      mkdirSync(dir, { recursive: true })
      const { app, page, folders } = await open(theme, glass)
      const name = `${theme}-glass-${glass}`
      await captureWindow(app, join(dir, `shell-${name}.png`))

      // The open session's details, as a card from the toolbar's ⓘ.
      await page.getByRole('button', { name: 'Session info' }).click()
      await page.getByRole('dialog', { name: 'Session Info' }).waitFor()
      await page.waitForTimeout(300)
      await captureWindow(app, join(dir, `info-${name}.png`))
      await page.keyboard.press('Escape')

      // A session's context menu, aimed at a row that isn't selected.
      await sessionRow(page, 'phase 2', `folder:${folders.gloom}`).click({ button: 'right' })
      await page.getByRole('menu').waitFor()
      await page.waitForTimeout(250)
      await captureWindow(app, join(dir, `context-menu-${name}.png`))
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      // The update button once it has settled after lighting up.
      await sendUpdateReady(app, '0.6.0')
      await page.waitForTimeout(2000)
      await captureWindow(app, join(dir, `update-${name}.png`))

      await page.getByRole('button', { name: 'Menu' }).first().click()
      await page.getByRole('menu').waitFor()
      await page.waitForTimeout(250)
      await captureWindow(app, join(dir, `menu-${name}.png`))
      await page.getByRole('menu').press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      // Filing rules for a folder.
      await groupRow(page, 'Website').click({ button: 'right' })
      await page.getByRole('menuitem', { name: 'Filing Rules…' }).click()
      await page.getByRole('dialog').waitFor()
      await page.waitForTimeout(350)
      await captureWindow(app, join(dir, `filing-rules-${name}.png`))
      await page.getByRole('button', { name: 'Cancel' }).click()

      // Library groups open, the session list's old job.
      await openGroup(page, 'Recent')
      await page.waitForTimeout(400)
      await captureWindow(app, join(dir, `library-open-${name}.png`))

      await setWindowSize(app, 760, 640)
      await page.getByRole('button', { name: 'Show sidebar' }).click()
      await page.waitForTimeout(450)
      await captureWindow(app, join(dir, `narrow-sheet-${name}.png`))
      await app.close()
    })
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`the transcript viewer, ${theme}`, async () => {
    mkdirSync(dir, { recursive: true })
    const claudeDir = fakeClaude(ALL)
    demoSession('D:\\Work\\api').write(join(claudeDir, 'projects'))
    const { app, page } = await launch({ claudeDir })
    await setWindowSize(app, 1280, 860)
    await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
    await openGroup(page, 'Recent')
    await page.locator(`[data-nav="smart:recent/${DEMO_ID}"]`).click()
    await page.locator('img[alt="Attached image"]').waitFor()
    await page.waitForTimeout(500)
    await captureWindow(app, join(dir, `viewer-${theme}.png`))

    // An edit's diff opened, under the plan's code block.
    const transcript = page.getByLabel('Transcript')
    await transcript.evaluate((el) => (el.scrollTop = 0))
    await page.getByRole('button', { name: 'Edited server.ts +3 −1' }).click()
    await transcript.evaluate((el) => (el.scrollTop = 300))
    await page.waitForTimeout(500)
    await captureWindow(app, join(dir, `viewer-diff-${theme}.png`))

    await triggerShortcut(app, 'CmdOrCtrl+F')
    await page.locator('input[data-find]').fill('limit')
    await page.locator('input[data-find]').press('Enter')
    await page.waitForTimeout(600)
    await captureWindow(app, join(dir, `viewer-find-${theme}.png`))
    await app.close()
  })
}

test('a drag in progress', async () => {
  mkdirSync(dir, { recursive: true })
  const { app, page } = await open('light', 'on')
  await openGroup(page, 'Unfiled')
  const first = sessionRow(page, 'Login redirect loop', 'smart:unfiled')
  const second = sessionRow(page, 'Photo library cleanup', 'smart:unfiled')
  const from = (await first.boundingBox())!
  const to = (await groupRow(page, 'Website').boundingBox())!
  await first.click()
  await second.click({ modifiers: ['Shift'] })
  await page.mouse.move(from.x + 60, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 80, from.y + 30, { steps: 4 })
  await page.mouse.move(to.x + 60, to.y + to.height / 2, { steps: 12 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(dir, 'drag-light.png') })
  await page.mouse.up()
  await expect(groupRow(page, 'Website')).toContainText('4')

  // Deleting a folder: its sessions go to Unfiled, and a toast offers Undo.
  await groupRow(page, 'Blissful TV').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete Folder' }).click()
  await page.getByRole('button', { name: 'Undo' }).waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(dir, 'undo-toast-light.png') })
  await app.close()
})
