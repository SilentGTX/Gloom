// The concept design (View › Design › Concept), Gloom's default while you try
// it: a neutral window, the conversation switching to Changes or Terminal, an
// inspector beside the chat, Claude's requests at the end of the conversation.
// Captures go to test-screens/concept/ (page screenshots, never the screen).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { demoSession, DEMO_TITLE } from '../support/demo'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, tempDir } from './app'

const dir = join(__dirname, '..', '..', 'test-screens', 'concept')
const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
test.setTimeout(120_000)

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

const capture = async (name: string) => {
  mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

/** The demo session (a real working folder, so a terminal can open there) beside a few others in folders. */
async function openDemo(theme: 'light' | 'dark') {
  const cwd = tempDir('gloom-concept-')
  const claudeDir = fakeClaude([
    { id: 'cccccccc-0000-4000-8000-000000000001', cwd, prompt: 'Sync the episode guide nightly', title: 'Episode guide sync', updated: minutesAgo(33) },
    { id: 'cccccccc-0000-4000-8000-000000000002', cwd, prompt: 'Bigger player controls', title: 'Player controls', updated: minutesAgo(60 * 26) }
  ])
  demoSession(cwd, minutesAgo(50)).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir, design: 'concept' }))
  await setWindowSize(app, 1440, 900)
  await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, DEMO_TITLE).click()
  await expect(page.getByLabel('Transcript')).toBeVisible()
  return { cwd }
}

for (const theme of ['light', 'dark'] as const) {
  test(`the concept window: conversation, changes, terminal and the inspector, ${theme}`, async () => {
    await openDemo(theme)
    await expect(page.locator('html')).toHaveAttribute('data-design', 'concept')
    // The toolbar: Conversation, Changes, Terminal; the inspector beside the chat.
    const views = page.getByRole('tablist', { name: 'Show' })
    await expect(views.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true')
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector).toBeVisible()
    await expect(inspector.getByRole('region', { name: 'Changes' })).toContainText('server.ts')
    await capture(`conversation-${theme}`)

    await views.getByRole('tab', { name: 'Changes' }).click()
    const changes = page.getByRole('region', { name: 'Changes' }).first()
    await expect(changes.getByRole('heading', { name: /Files? Changed/ })).toBeVisible()
    await capture(`changes-${theme}`)

    await views.getByRole('tab', { name: 'Terminal' }).click()
    await expect(page.getByRole('tablist', { name: 'Terminals' }).getByRole('tab')).toHaveCount(1, { timeout: 15_000 })
    // PowerShell takes a moment to say its prompt.
    await expect(page.locator('#terminal-screen .xterm-rows')).toContainText('PS ', { timeout: 15_000 })
    await capture(`terminal-${theme}`)

    // Ctrl+` (the menu's toggle) comes back to the conversation; the inspector goes with Ctrl+I.
    await page.evaluate(() => window.gloom!.runCommand('view.toggleTerminal'))
    await expect(views.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: 'Inspector' }).click()
    await expect(inspector).toHaveCount(0)
    await capture(`no-inspector-${theme}`)

    // Classic is one click back, and the concept one more.
    await page.evaluate(() => window.gloom!.runCommand('view.designClassic'))
    await expect(page.locator('html')).toHaveAttribute('data-design', 'classic')
    await expect(page.getByRole('button', { name: 'Session info' })).toBeVisible()
    await capture(`classic-${theme}`)
    await page.evaluate(() => window.gloom!.runCommand('view.designConcept'))
    await expect(page.getByRole('tablist', { name: 'Show' })).toBeVisible()
  })
}

test('narrow windows: the inspector floats over the chat, then the sidebar folds away', async () => {
  await openDemo('light')
  await setWindowSize(app, 1100, 800)
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Inspector' }).click()
  await expect(page.getByRole('dialog', { name: 'Inspector' })).toBeVisible()
  await capture('narrow-inspector-sheet')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Inspector' })).toHaveCount(0)
  await setWindowSize(app, 760, 700)
  // The title keeps its place; the resting status makes room.
  await expect(page.locator('main > header h1')).toBeVisible()
  expect((await page.locator('main > header h1').boundingBox())!.width).toBeGreaterThan(60)
  await capture('narrow-760')
})

for (const theme of ['light', 'dark'] as const)
test(`a permission request waits at the end of the conversation; Tell Claude What to Do denies it with a note, ${theme}`, async () => {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = 'permission'
  process.env.FAKE_CLAUDE_SPEED = '0'
  const cwd = tempDir('gloom-live-')
  const claudeDir = fakeClaude([{ id: '7f3c2a10-5b4d-4e6f-8a9b-0c1d2e3f4a5b', cwd, prompt: 'Look at the notes', title: 'Tidy the notes folder', created: minutesAgo(90), updated: minutesAgo(60) }])
  ;({ app, page } = await launch({ claudeDir, design: 'concept' }))
  await setWindowSize(app, 1440, 900)
  await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, 'Tidy the notes folder').click()
  const composer = page.getByRole('textbox', { name: 'Message' })
  await composer.fill('Make hello.txt, then a folder, then delete hello.txt')
  await composer.press('Enter')

  const card = page.getByRole('region', { name: 'Permission request' })
  await expect(card.getByRole('heading', { name: 'Allow Claude to write hello.txt?' })).toBeVisible()
  // In the conversation, not over the composer; the pill says Claude waits.
  await expect(page.getByLabel('Transcript').getByRole('region', { name: 'Permission request' })).toBeVisible()
  await expect(page.locator('main > header').getByRole('status')).toHaveText('Waiting for you')
  await expect(card.getByRole('button', { name: 'Allow Once' })).toBeFocused()
  await capture(`permission-card-${theme}`)

  await card.getByRole('button', { name: 'Allow Once' }).click()
  await expect(card.getByRole('heading', { name: 'Allow Claude to run this command?' })).toBeVisible()
  await card.getByRole('button', { name: 'Tell Claude What to Do…' }).click()
  const note = page.getByRole('textbox', { name: 'What Claude should do instead' })
  await expect(note).toBeFocused()
  await expect(note).toHaveAttribute('placeholder', 'Tell Claude what to do instead')
  await capture(`permission-noting-${theme}`)
  await note.fill('Make the folder somewhere else')
  await note.press('Enter')
  await expect(card.getByRole('heading', { name: 'Allow Claude to run this command?' })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('')
  await capture(`permission-denied-${theme}`)
})
