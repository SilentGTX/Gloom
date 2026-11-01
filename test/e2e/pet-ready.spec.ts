// The pet's "ready": a session that finished while you weren't looking, the open one
// included when Gloom was minimized; coming back to it clears it. The fake claude
// (tools/fake-claude) plays the turn.
import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, tempDir } from './app'

const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
const SESSION = '7f3c2a10-5b4d-4e6f-8a9b-0c1d2e3f4a5b'
const TITLE = 'Tidy the notes folder'

test('the pet says a session is ready when it finished while you were away, even the open one', async () => {
  test.setTimeout(90_000)
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = 'two-turns'
  process.env.FAKE_CLAUDE_SPEED = '1'
  const cwd = tempDir('gloom-live-')
  const claudeDir = fakeClaude([{ id: SESSION, cwd, prompt: 'Look at the notes', title: TITLE, created: minutesAgo(90), updated: minutesAgo(60) }])
  const { app, page } = await launch({ claudeDir, design: 'concept' })
  try {
    await page.evaluate(() => window.gloom!.setSettings({ pet: true }))
    const pet = await app.waitForEvent('window', { predicate: (w) => w.url().includes('?pet'), timeout: 10_000 })
    await pet.waitForSelector('.pet-body')
    await openGroup(page, 'All Sessions')
    await sessionRow(page, TITLE).click()
    const box = page.getByRole('textbox', { name: 'Message' })
    await box.fill('Look at the notes again')
    await box.press('Enter')
    // Away from Gloom while it works: minimized, watching the pet.
    await expect(pet.locator('.pet-spinner')).toBeVisible({ timeout: 10_000 })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('?pet'))!.minimize())
    // The turn ends: the open session is ready, and the pet says so.
    await expect(pet.locator('.pet-ready')).toBeVisible({ timeout: 30_000 })
    await expect(pet.locator('.pet-card-main')).toContainText(TITLE)
    // Back in Gloom on that session: seen, so the card goes.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x.webContents.getURL().includes('?pet'))!
      w.restore()
      w.focus()
    })
    await expect(pet.locator('.pet-ready')).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await app.close()
  }
})
