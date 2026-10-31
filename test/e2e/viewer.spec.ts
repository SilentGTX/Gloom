import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { demoSession, DEMO_TITLE } from '../support/demo'
import { fakeClaude, launch, openGroup, sessionRow, setWindowSize, tempDir, triggerShortcut } from './app'

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

/** The demo session in a throwaway Claude folder; its working folder exists, so it can be resumed. */
async function openDemo() {
  // Resume in Terminal answers without opening a window.
  process.env.GLOOM_RESUME_DRY_RUN = '1'
  const cwd = tempDir('gloom-project-')
  const claudeDir = fakeClaude([])
  const demo = demoSession(cwd)
  const file = demo.write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir }))
  await setWindowSize(app, 1280, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, DEMO_TITLE).click()
  return { demo, file, cwd, transcript: page.getByLabel('Transcript') }
}

const toTop = (transcript: ReturnType<Page['getByLabel']>) => transcript.evaluate((el) => (el.scrollTop = 0))

test('a transcript opens at its newest reply, its tool calls open, and its images load', async () => {
  const { transcript } = await openDemo()
  // It opens at the bottom: the last reply and its turn's time are in view.
  await expect(transcript.getByText('Teams now get')).toBeInViewport()
  await expect(transcript.getByText(/^Worked for .* · Opus 5\.5$/).last()).toBeVisible()
  // Your pasted logs fold into a chip; the attached image arrives from the file.
  await expect(transcript.getByRole('button', { name: /Pasted text · 3 lines/ })).toBeVisible()
  await expect(transcript.locator('img[alt="Attached image"]')).toHaveAttribute('src', /^data:image\/png;base64,/)

  await toTop(transcript)
  const edit = transcript.getByRole('button', { name: 'Edited server.ts +3 −1' })
  await expect(edit).toHaveAttribute('aria-expanded', 'false')
  await edit.click()
  await expect(edit).toHaveAttribute('aria-expanded', 'true')
  await expect(transcript.getByText("app.register(rateLimit, { perMinute: 100 })").first()).toBeVisible()
  // A failed run says so in words, not only in colour.
  await expect(transcript.getByRole('button', { name: /Ran\s*npm test.*Failed/ })).toBeVisible()
})

test('Find searches the whole loaded transcript, opening folded output to show a match', async () => {
  const { transcript } = await openDemo()
  await triggerShortcut(app, 'CmdOrCtrl+F')
  const field = page.locator('input[data-find]')
  await expect(field).toBeFocused()
  await field.fill('expected 429')
  const status = page.getByRole('search').getByRole('status')
  await expect(status).toHaveText(/^1 of \d+$/)
  // The match is in a failed run's output, so that row opens.
  await expect(transcript.getByRole('button', { name: /Ran\s*npm test.*Failed/ })).toHaveAttribute('aria-expanded', 'true')
  await field.fill('nothing like this')
  await expect(status).toHaveText('No matches')
  await field.fill('limit')
  await expect(status).toHaveText(/^1 of \d+$/)
  await field.press('Enter')
  await expect(status).toHaveText(/^2 of \d+$/)
  await field.press('Escape')
  await expect(page.getByRole('search')).toHaveCount(0)
})

test('Show Earlier reads the conversation before a compaction', async () => {
  const { transcript } = await openDemo()
  await toTop(transcript)
  await expect(transcript.getByText(/Conversation compacted automatically/)).toBeVisible()
  await expect(transcript.getByText('Set up the API project', { exact: false })).toHaveCount(0)
  await transcript.getByRole('button', { name: 'Show Earlier Messages' }).click()
  await expect(transcript.getByText('Set up the API project', { exact: false })).toBeVisible()
})

test('what Claude Code appends shows as it arrives, and Resume in Terminal opens the session', async () => {
  const { demo, file, transcript } = await openDemo()
  await expect(transcript.getByText('Teams now get')).toBeInViewport()
  const before = demo.lines.length
  demo.wait(30).prompt('One more thing: log every 429.')
  demo.respond().text('Logging every 429 now.')
  appendFileSync(file, demo.lines.slice(before).map((l) => JSON.stringify(l)).join('\n') + '\n')
  // Still at the bottom, so the view follows.
  await expect(transcript.getByText('Logging every 429 now.')).toBeInViewport()

  // Resume in Terminal lives in the session's info card (the toolbar's terminal button is the pane's).
  await page.getByRole('button', { name: 'Session info' }).click()
  await page.getByRole('button', { name: 'Resume in Terminal' }).click()
  await expect(page.getByText('Resumed in a terminal window')).toBeVisible()
})

test('the toolbar names the session and what it’s doing; ⓘ shows its details as a card', async () => {
  const { cwd } = await openDemo()
  const toolbar = page.locator('main header')
  await expect(toolbar.getByRole('heading', { name: DEMO_TITLE })).toBeVisible()
  await expect(toolbar).toContainText(/Active (now|\d+\w ago|\w+ \d+)/)
  await page.getByRole('button', { name: 'Session info' }).click()
  const card = page.getByRole('dialog', { name: 'Session Info' })
  await expect(card).toBeVisible()
  // It names the session in full (the toolbar cuts a long title short).
  await expect(card.getByRole('heading', { name: DEMO_TITLE })).toBeVisible()
  await expect(card).toContainText(cwd)
  await expect(card).toContainText('Unfiled')
  await card.getByRole('button', { name: 'Copy Session ID' }).click()
  await expect(page.getByText('Copied the session ID')).toBeVisible()
  await expect(card).toHaveCount(0)
  // File › Session Info (Ctrl+I) opens it too.
  await triggerShortcut(app, 'CmdOrCtrl+I')
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
})
