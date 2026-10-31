// Live chat against the fake claude: the real Agent SDK in Gloom's main
// process, replaying streams the Phase 0 spike recorded, so every run plays
// the same and costs no usage. The fake writes no transcript, so what shows is
// what Gloom took from the stream.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, tempDir, triggerShortcut } from './app'

const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
const SESSION = '7f3c2a10-5b4d-4e6f-8a9b-0c1d2e3f4a5b'
const TITLE = 'Tidy the notes folder'

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

/** Gloom with one earlier session in a real folder, and the fake claude playing `fixture`. */
async function start(fixture: string) {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = fixture
  process.env.FAKE_CLAUDE_SPEED = '0'
  const cwd = tempDir('gloom-live-')
  const claudeDir = fakeClaude([{ id: SESSION, cwd, prompt: 'Look at the notes', title: TITLE, created: minutesAgo(90), updated: minutesAgo(60) }])
  ;({ app, page } = await launch({ claudeDir }))
  await setWindowSize(app, 1280, 900)
  return { cwd }
}

async function openSession() {
  await openGroup(page, 'All Sessions')
  await sessionRow(page, TITLE).click()
  return page.getByRole('textbox', { name: 'Message' })
}

const transcript = () => page.getByLabel('Transcript')

test('a message runs here: it shows at once, permission cards ask, and the reply arrives', async () => {
  await start('permission')
  const composer = await openSession()
  await composer.fill('Make hello.txt, then a folder, then delete hello.txt')
  await composer.press('Enter')
  await expect(composer).toHaveValue('')
  await expect(transcript().getByText('Make hello.txt, then a folder, then delete hello.txt')).toBeVisible()

  const card = page.getByRole('region', { name: 'Permission request' })
  await expect(card.getByRole('heading', { name: 'Allow Claude to write hello.txt?' })).toBeVisible()
  // The card takes the keyboard; the sidebar says the session waits for you.
  await expect(card.getByRole('button', { name: 'Allow Once' })).toBeFocused()
  await expect(sessionRow(page, TITLE)).toContainText('Waiting')
  // "Always Allow" says what it does.
  await expect(card.getByRole('button', { name: 'Allow All Edits' })).toBeVisible()
  await card.getByRole('button', { name: 'Allow Once' }).click()

  await expect(card.getByRole('heading', { name: 'Allow Claude to run this command?' })).toBeVisible()
  await expect(card.getByText('mkdir made-by-claude')).toBeVisible()
  await page.keyboard.press('Enter')

  await expect(transcript().getByText('All three steps completed successfully')).toBeVisible()
  await expect(card).toHaveCount(0)
  await expect(page.locator('main > header').getByRole('status')).toHaveText(/Active now/)
})

test('a plan comes as a card: keep planning with a note, then approve it into a mode', async () => {
  await start('plan')
  const composer = await openSession()
  await composer.fill('Plan how to create notes.txt')
  await composer.press('Enter')

  const card = page.getByRole('region', { name: 'Plan for review' })
  await expect(card.getByRole('heading', { name: 'Claude’s Plan' })).toBeVisible()
  await expect(card.getByText('Plan: Create notes.txt').first()).toBeVisible()
  await card.getByRole('button', { name: 'Keep Planning…' }).click()
  await card.getByRole('textbox', { name: 'What should change in the plan' }).fill('It needs a second line: there')
  await card.getByRole('button', { name: 'Keep Planning' }).click()

  // The revised plan, approved into Accept Edits.
  await expect(card.getByRole('button', { name: 'Approve Plan' })).toBeVisible()
  await card.getByRole('button', { name: 'Approve Plan' }).click()
  await expect(transcript().getByText(/Done\. Created/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mode: Accept Edits' })).toBeVisible()
})

test('Claude’s question comes with its options as buttons', async () => {
  await start('question')
  const composer = await openSession()
  await composer.fill('Ask me which fruit I prefer')
  await composer.press('Enter')
  const card = page.getByRole('region', { name: 'Question from Claude' })
  await expect(card.getByRole('heading', { name: 'Which fruit do you prefer?' })).toBeVisible()
  await card.getByRole('radio', { name: /Banana/ }).click()
  await expect(transcript().getByText('Banana.')).toBeVisible()
})

test('Stop ends the turn, and a message queued meanwhile comes back to the composer', async () => {
  await start('interrupt')
  const composer = await openSession()
  await composer.fill('Count from 1 to 400')
  await composer.press('Enter')
  // The fake holds the turn open until it hears the interrupt.
  await expect(page.locator('main > header').getByRole('status')).toHaveText('Working…')
  await composer.fill('And then say hi')
  await composer.press('Enter')
  await expect(page.getByRole('list', { name: 'Queued messages' })).toContainText('And then say hi')
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(composer).toHaveValue('And then say hi')
  await expect(transcript().getByText('Interrupted')).toBeVisible()
  await expect(page.getByRole('list', { name: 'Queued messages' })).toHaveCount(0)
})

test('in the background, a card waiting for you sends a notification', async () => {
  await start('permission')
  const composer = await openSession()
  // Windows' notifications are recorded rather than shown (development builds hand tests the switch).
  type Hook = { gloomAttention: { record(): { title: string; body: string }[] }; notes: { title: string; body: string }[] }
  await app.evaluate(() => {
    const hook = globalThis as unknown as Hook
    hook.notes = hook.gloomAttention.record()
  })
  await composer.fill('Make hello.txt')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
  await composer.press('Enter')
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as Hook).notes)).toEqual([{ title: TITLE, body: 'Claude needs your permission to continue.' }])
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
})

test('a session growing in another app is locked until you take it over', async () => {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = 'two-turns'
  const cwd = tempDir('gloom-live-')
  // Its transcript was written seconds ago, and not by Gloom.
  const claudeDir = fakeClaude([{ id: SESSION, cwd, prompt: 'Look at the notes', title: TITLE, created: minutesAgo(5), updated: new Date().toISOString(), entrypoint: 'claude-desktop' }])
  ;({ app, page } = await launch({ claudeDir }))
  await openGroup(page, 'All Sessions')
  await sessionRow(page, TITLE).click()
  await expect(page.getByText(/Running in another app\. Messages wait/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Take Over' }).click()
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
})

test('a session whose working folder is gone says so in place of the composer', async () => {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  const gone = join(tempDir('gloom-live-'), 'deleted-project')
  const claudeDir = fakeClaude([{ id: SESSION, cwd: gone, prompt: 'Look at the notes', title: TITLE, updated: minutesAgo(60) }])
  ;({ app, page } = await launch({ claudeDir }))
  await openGroup(page, 'All Sessions')
  await sessionRow(page, TITLE).click()
  await expect(page.getByText(`Its working folder, ${gone}, no longer exists.`)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0)
})

test('New Session starts in a folder you trust, and runs from its first message', async () => {
  const { cwd } = await start('two-turns')
  // The system's folder picker answers with a folder Claude hasn't worked in.
  const fresh = join(cwd, '..', `${cwd.split(/[\\/]/).pop()}-new`)
  mkdirSync(fresh, { recursive: true })
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
  }, fresh)

  await triggerShortcut(app, 'CmdOrCtrl+N')
  const sheet = page.getByRole('dialog', { name: 'New Session' })
  // The last folder you worked in comes first; Claude has run there, so no trust question.
  await expect(sheet.getByRole('button', { name: /^Working folder: / })).toContainText(cwd.split(/[\\/]/).pop()!)
  await expect(sheet.getByRole('button', { name: 'Start Session' })).toBeVisible()
  await sheet.getByRole('button', { name: /^Working folder: / }).click()
  await page.getByRole('menuitem', { name: 'Choose Folder…' }).click()
  await expect(sheet.getByText(/Claude hasn’t worked here before/)).toBeVisible()
  await sheet.getByRole('button', { name: 'Trust and Start' }).click()

  await expect(sheet).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New Session')
  const composer = page.getByRole('textbox', { name: 'Message' })
  await expect(composer).toBeFocused()
  await composer.fill("Remember the word 'kiwi'. Reply with just: OK")
  await composer.press('Enter')
  await expect(transcript().getByText('OK', { exact: true })).toBeVisible()
  // It's in the sidebar, named by what you asked, before any transcript exists.
  await openGroup(page, 'All Sessions')
  await expect(sessionRow(page, "Remember the word 'kiwi'. Reply with just: OK")).toBeVisible()
})
