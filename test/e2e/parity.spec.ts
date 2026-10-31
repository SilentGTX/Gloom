// What Gloom took over from the Claude app's Code tab (PLAN.md › 12): its
// Settings panes, transcript views, unread marks, search inside conversations,
// Export, and the inspector's connectors, folders and output style. Captures go
// to test-screens/parity/ (page screenshots, never the screen).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { demoSession, DEMO_TITLE } from '../support/demo'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, settle, sidebar, tempDir } from './app'

const dir = join(__dirname, '..', '..', 'test-screens', 'parity')
test.setTimeout(120_000)

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

const capture = async (name: string) => {
  mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

async function openDemo(design: 'concept' | 'classic' = 'concept') {
  const cwd = tempDir('gloom-parity-')
  const claudeDir = fakeClaude([{ id: 'cccccccc-0000-4000-8000-000000000011', cwd, prompt: 'Sync the episode guide nightly', title: 'Episode guide sync', updated: minutesAgo(33) }])
  demoSession(cwd, minutesAgo(50)).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir, design }))
  await setWindowSize(app, 1440, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, DEMO_TITLE).click()
  await expect(page.getByLabel('Transcript')).toBeVisible()
  return { cwd, claudeDir }
}

const settings = () => page.evaluate(() => window.gloom!.getSettings())

test('Settings has the Claude app’s options, in five panes', async () => {
  await openDemo()
  await page.evaluate(() => window.gloom!.runCommand('app.settings'))
  const sheet = page.getByRole('dialog', { name: 'Settings' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('radio', { name: 'Notifications' })).toBeVisible()
  await capture('settings-general')

  // Sessions: archive inactive, keep awake, the conversation view, the branch prefix checked as you type.
  await sheet.getByRole('radio', { name: 'Sessions' }).click()
  await sheet.getByRole('button', { name: /Archive inactive sessions/ }).click()
  await page.getByRole('menuitemradio', { name: 'After 7 days' }).click()
  await expect.poll(async () => (await settings()).archiveAfterDays).toBe(7)
  await sheet.getByLabel('On battery power too').uncheck()
  await expect.poll(async () => (await settings()).keepAwakeOnBattery).toBe(false)
  const prefix = sheet.getByLabel('Branch prefix')
  await prefix.fill('main')
  await expect(sheet.getByRole('alert')).toHaveText(/kept for main branches/)
  await capture('settings-sessions-invalid')
  await prefix.fill('ivan')
  await expect(sheet.getByRole('alert')).toHaveCount(0)
  await prefix.press('Enter')
  await expect.poll(async () => (await settings()).branchPrefix).toBe('ivan')
  await sheet.getByRole('radio', { name: 'Verbose' }).click()
  await expect.poll(async () => (await settings()).transcriptView).toBe('verbose')
  await capture('settings-sessions')

  // Notifications: a level per kind.
  await sheet.getByRole('radio', { name: 'Notifications' }).click()
  await sheet.getByRole('button', { name: /Questions/ }).click()
  await page.getByRole('menuitemradio', { name: /Badge Only/ }).click()
  await expect.poll(async () => (await settings()).notifyQuestion).toBe('badge')
  await capture('settings-notifications')
})

/** Scrolls the transcript up until `target` is drawn (the list draws only the rows near the screen). */
async function scrollUntil(transcript: ReturnType<Page['getByLabel']>, target: ReturnType<Page['getByRole']>) {
  for (let i = 0; i < 30 && !(await target.count()); i++) {
    await transcript.evaluate((el) => {
      const scroller = (el.querySelector('[data-virtuoso-scroller]') as HTMLElement | null) ?? el
      scroller.scrollTop = Math.max(0, scroller.scrollTop - 400)
    })
    await page.waitForTimeout(120)
  }
}

test('Transcript View folds, shows thinking, or opens everything', async () => {
  await openDemo()
  const transcript = page.getByLabel('Transcript')
  const thought = transcript.getByRole('button', { name: /Thought for/ })
  // Normal: Claude's thinking is left out.
  await scrollUntil(transcript, transcript.getByText('I’ll look at how requests reach the routes first.'))
  await expect(thought).toHaveCount(0)
  await page.evaluate(() => window.gloom!.runCommand('view.transcriptThinking'))
  await scrollUntil(transcript, thought)
  await expect(thought).toHaveAttribute('aria-expanded', 'true')
  await expect(transcript.getByText('count per key before any route runs', { exact: false })).toBeVisible()
  // Verbose: every tool call open too.
  await page.evaluate(() => window.gloom!.runCommand('view.transcriptVerbose'))
  const steps = transcript.locator('button[aria-expanded]')
  await expect.poll(async () => (await steps.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-expanded') === 'false').length))).toBe(0)
  await capture('transcript-verbose')
  // A row you fold stays folded; back to Normal, the thinking goes again.
  await page.evaluate(() => window.gloom!.runCommand('view.transcriptNormal'))
  await expect(transcript.getByRole('button', { name: /Thought for/ })).toHaveCount(0)
})

test('Mark as Unread puts Mail’s dot on a session; opening it reads it', async () => {
  await openDemo('classic')
  const other = sessionRow(page, 'Episode guide sync')
  await other.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mark as Unread' }).click()
  await expect(other.getByRole('img', { name: 'Unread' })).toBeVisible()
  // Back on the demo, the dot stays; the menu offers Mark as Read.
  await sessionRow(page, DEMO_TITLE).click()
  await other.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Mark as Read' })).toBeVisible()
  await page.keyboard.press('Escape')
  await capture('unread-classic')
  // Opening it reads it.
  await other.click()
  await expect(other.getByRole('img', { name: 'Unread' })).toHaveCount(0)
})

test('search finds words inside conversations, under the title matches', async () => {
  await openDemo()
  const field = sidebar(page).locator('input[data-search]')
  await field.fill('route tests')
  const found = sidebar(page).getByRole('list', { name: 'Found in conversations' })
  await expect(found.getByRole('button', { name: new RegExp(DEMO_TITLE) })).toBeVisible({ timeout: 15_000 })
  await expect(found.locator('mark')).toHaveText(/route tests/i)
  await capture('search-in-conversations')
  // A title match isn't listed twice.
  await field.fill('Episode')
  await settle(page)
  await expect(sidebar(page).getByRole('list', { name: 'Found in conversations' })).toHaveCount(0)
})

test('Export writes a zip of the session to Downloads', async () => {
  await openDemo()
  const downloads = tempDir('gloom-downloads-')
  await app.evaluate(({ app: electron }, folder) => electron.setPath('downloads', folder), downloads)
  await page.evaluate(() => window.gloom!.runCommand('session.export'))
  await expect(page.getByRole('status').filter({ hasText: /Exported .*\.zip to Downloads/ })).toBeVisible()
  const zips = readdirSync(downloads).filter((f) => f.endsWith('.zip'))
  expect(zips).toHaveLength(1)
  expect(existsSync(join(downloads, zips[0]))).toBe(true)
})

test('the inspector has the session’s output style, extra folders and connector switches', async () => {
  await openDemo()
  const inspector = page.getByRole('complementary', { name: 'Inspector' })
  if (!(await inspector.isVisible())) await page.evaluate(() => window.gloom!.runCommand('session.info'))
  await expect(inspector).toBeVisible()
  await expect(inspector.getByRole('button', { name: 'Add Folder…' })).toBeVisible()
  // The Session section starts folded; open it for the output style.
  const session = inspector.locator('section[aria-label="Session"]')
  await session.getByRole('button', { name: /^Session/ }).first().click()
  await expect(session.getByRole('button', { name: /Output style: Default/ })).toBeVisible()
  await capture('inspector')
})
