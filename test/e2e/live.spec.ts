// Live chat against the fake claude: the real Agent SDK in Gloom's main
// process, replaying streams the Phase 0 spike recorded, so every run plays
// the same and costs no usage. The fake writes no transcript, so what shows is
// what Gloom took from the stream.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, tempDir, triggerShortcut } from './app'

const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
const SESSION = '7f3c2a10-5b4d-4e6f-8a9b-0c1d2e3f4a5b'
const TITLE = 'Tidy the notes folder'

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

/** Gloom with one earlier session in a real folder, and the fake claude playing `fixture`. */
async function start(fixture: string, speed = 0, prompt = 'Look at the notes', design: 'classic' | 'concept' = 'classic') {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = fixture
  process.env.FAKE_CLAUDE_SPEED = String(speed)
  const cwd = tempDir('gloom-live-')
  const claudeDir = fakeClaude([{ id: SESSION, cwd, prompt, title: TITLE, created: minutesAgo(90), updated: minutesAgo(60) }])
  const userData = tempDir('gloom-e2e-')
  ;({ app, page } = await launch({ claudeDir, userData, design }))
  await setWindowSize(app, 1280, 900)
  return { cwd, claudeDir, userData }
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

test('a message sent while Claude works reaches it mid-turn', async () => {
  // A third of the recording's pace: Claude takes the message about 2 s after it goes.
  await start('steer-next', 0.33)
  const composer = await openSession()
  await composer.fill('Run five slow commands')
  await composer.press('Enter')
  await expect(transcript().getByText('sleep 3; echo one').first()).toBeVisible()
  await composer.fill('Change of plan: run no more commands and reply exactly: steered')
  await composer.press('Enter')
  const sent = page.getByRole('list', { name: 'Queued messages' })
  await expect(sent).toContainText('Sent')
  await expect(sent).toContainText('Change of plan')
  await page.screenshot({ path: join(__dirname, '..', '..', 'test-screens', 'steer', 'sent.png') })
  // Claude takes it at its next step: it joins the turn, once, and the chip goes.
  await expect(transcript().getByText('Sent while Claude was working')).toHaveCount(1)
  await expect(sent).toHaveCount(0)
  await expect(transcript().getByText('steered', { exact: true })).toBeVisible()
  await expect(page.locator('main > header').getByRole('status')).not.toHaveText('Working…')
  await expect(transcript().getByText('Sent while Claude was working')).toHaveCount(1)
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
  await expect(page.getByText('Its working folder no longer exists.')).toBeVisible()
  // The path on its own line, whole on hover.
  await expect(page.getByTitle(gone)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0)
})

test('the Effort menus open where they appear, and what you pick shows on the button', async () => {
  await start('two-turns')
  await openSession()
  // Opening one once took the whole window with it: Base UI throws for a group label outside its group.
  const pick = async (button: string, effort: string) => {
    await page.getByRole('button', { name: button }).click()
    const group = page.getByRole('menu').getByRole('group', { name: 'Effort' })
    await expect(group).toBeVisible()
    await group.getByRole('menuitemradio', { name: effort, exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
  }
  await pick('Effort: Default', 'High')
  await expect(page.getByRole('button', { name: 'Effort: High' })).toBeVisible()

  await triggerShortcut(app, 'CmdOrCtrl+N')
  const sheet = page.getByRole('dialog', { name: 'New Session' })
  await expect(sheet).toBeVisible()
  await pick('Effort: Default', 'Max')
  await expect(sheet.getByRole('button', { name: 'Effort: Max' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  await triggerShortcut(app, 'CmdOrCtrl+,')
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await pick('Effort: Default', 'Low')
  await expect(settings.getByRole('button', { name: 'Effort: Low' })).toBeVisible()
})

test('before a turn here, the ring by Send fills with the plan’s use', async () => {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = 'two-turns'
  const cwd = tempDir('gloom-live-')
  const claudeDir = fakeClaude([{ id: SESSION, cwd, prompt: 'Look at the notes', title: TITLE, created: minutesAgo(90), updated: minutesAgo(60) }])
  // Claude Code's copy of the plan's use: 24% of the 5-hour limit, 36% of the week.
  const later = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()
  writeFileSync(
    join(claudeDir, '.claude.json'),
    JSON.stringify({ cachedUsageUtilization: { fetchedAtMs: Date.now() - 60_000, utilization: { five_hour: { utilization: 24, resets_at: later(2) }, seven_day: { utilization: 36, resets_at: later(72) } } } })
  )
  ;({ app, page } = await launch({ claudeDir }))
  await openSession()
  // The limit nearest full, drawn as a share of the ring.
  const ring = page.getByRole('button', { name: 'Plan usage 36%' })
  await expect(ring).toBeVisible()
  const drawn = await ring.locator('.context-ring-fill').getAttribute('stroke-dasharray')
  expect(Number(drawn!.split(' ')[0])).toBeCloseTo((2 * Math.PI * 7 * 36) / 100, 1)
})

test('a session keeps the effort you picked for it when Gloom opens again', async () => {
  const { claudeDir, userData } = await start('two-turns')
  await openSession()
  await page.getByRole('button', { name: 'Effort: Default' }).click()
  await page.getByRole('menu').getByRole('menuitemradio', { name: 'High', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Effort: High' })).toBeVisible()
  await app.close()
  ;({ app, page } = await launch({ claudeDir, userData }))
  await openSession()
  // Nothing runs it yet; the button shows what it will start with.
  await expect(page.getByRole('button', { name: 'Effort: High' })).toBeVisible()
})

test('scrolling up while Claude writes stays where you scrolled', async () => {
  // A quarter of the recording's pace, so its count streams in for a few seconds,
  // after an earlier message long enough to scroll through. The concept: the look you use.
  await start('interrupt', 4, `Look at the notes${'\nand this line'.repeat(60)}`, 'concept')
  const composer = await openSession()
  await composer.fill('Count from 1 to 400')
  await composer.press('Enter')
  const scroller = transcript()
  const gap = () => scroller.evaluate((s) => s.scrollHeight - s.clientHeight - s.scrollTop)
  const height = () => scroller.evaluate((s) => s.scrollHeight)
  await expect.poll(() => scroller.evaluate((s) => s.scrollHeight - s.clientHeight), { timeout: 20_000 }).toBeGreaterThan(400)
  const box = (await scroller.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  // One notch: less than the margin that counts as "at the bottom".
  await page.mouse.wheel(0, -100)
  await expect.poll(gap).toBeGreaterThan(50)
  // The list nudges the view down a little by itself (a row above measured again): that isn't you coming back.
  await page.waitForTimeout(500)
  await scroller.evaluate((s) => (s.scrollTop += 20))
  const before = await height()
  // More of the reply arrives, and the view stays put.
  await expect.poll(height, { timeout: 10_000 }).toBeGreaterThan(before + 40)
  await page.waitForTimeout(300)
  expect(await gap()).toBeGreaterThan(50)
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
