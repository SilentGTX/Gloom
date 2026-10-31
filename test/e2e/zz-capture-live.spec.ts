// Temporary: captures of the live chat for the design review. Not committed.
import { test, type ElectronApplication, type Page } from '@playwright/test'
import { join } from 'node:path'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, tempDir, triggerShortcut } from './app'

const OUT = process.env.CAPTURE_DIR ?? tempDir('gloom-captures-')
const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
const SESSION = '7f3c2a10-5b4d-4e6f-8a9b-0c1d2e3f4a5b'
const TITLE = 'Tidy the notes folder'

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())
test.setTimeout(90_000)

async function start(fixture: string, speed: string, theme: 'light' | 'dark') {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = fixture
  process.env.FAKE_CLAUDE_SPEED = speed
  const cwd = tempDir('gloom-live-')
  const claudeDir = fakeClaude([{ id: SESSION, cwd, prompt: 'Look at the notes', title: TITLE, created: minutesAgo(90), updated: minutesAgo(60) }])
  ;({ app, page } = await launch({ claudeDir }))
  await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
  await setWindowSize(app, 1180, 820)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, TITLE).click()
  return page.getByRole('textbox', { name: 'Message' })
}

const shot = (name: string) => page.screenshot({ path: join(OUT, `${name}.png`) })

for (const theme of ['light', 'dark'] as const) {
  test(`permission cards, ${theme}`, async () => {
    const composer = await start('permission', '1', theme)
    await composer.fill('Make hello.txt with “hi”, then make a folder made-by-claude, then delete hello.txt with a shell command.')
    await shot(`${theme}-1-composer`)
    await composer.press('Enter')
    await page.waitForTimeout(2700)
    await shot(`${theme}-2-streaming`)
    const card = page.getByRole('region', { name: 'Permission request' })
    await card.getByRole('button', { name: 'Allow Once' }).waitFor()
    await page.waitForTimeout(400)
    await shot(`${theme}-3-permission-write`)
    await card.getByRole('button', { name: 'Allow Once' }).click()
    await card.getByRole('heading', { name: 'Allow Claude to run this command?' }).waitFor()
    await page.waitForTimeout(400)
    await shot(`${theme}-4-permission-command`)
    await card.getByRole('button', { name: 'Allow Once' }).click()
    await page.getByLabel('Transcript').getByText('All three steps completed successfully').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(600)
    await shot(`${theme}-5-done`)
  })

  test(`plan and question, ${theme}`, async () => {
    const composer = await start('plan', '0', theme)
    await composer.fill('Plan how to create notes.txt')
    await composer.press('Enter')
    await page.getByRole('region', { name: 'Plan for review' }).getByRole('button', { name: 'Approve Plan' }).waitFor()
    await page.waitForTimeout(400)
    await shot(`${theme}-6-plan`)
    await page.getByRole('button', { name: /^Mode: / }).click()
    await page.waitForTimeout(300)
    await shot(`${theme}-7-mode-menu`)
    await page.keyboard.press('Escape')
  })

  test(`question, new session and settings, ${theme}`, async () => {
    const composer = await start('question', '0', theme)
    await composer.fill('Ask me which fruit I prefer')
    await composer.press('Enter')
    await page.getByRole('region', { name: 'Question from Claude' }).getByRole('radio', { name: /Banana/ }).waitFor()
    await page.waitForTimeout(400)
    await shot(`${theme}-8-question`)
    await page.getByRole('region', { name: 'Question from Claude' }).getByRole('radio', { name: /Banana/ }).click()
    await page.getByLabel('Transcript').getByText('Banana.').waitFor()
    await composer.fill('/')
    await page.waitForTimeout(500)
    await shot(`${theme}-9-slash`)
    await composer.fill('')
    await triggerShortcut(app, 'CmdOrCtrl+N')
    await page.getByRole('dialog', { name: 'New Session' }).waitFor()
    await page.waitForTimeout(400)
    await shot(`${theme}-10-new-session`)
    await page.keyboard.press('Escape')
    await triggerShortcut(app, 'CmdOrCtrl+,')
    await page.getByRole('dialog', { name: 'Settings' }).waitFor()
    await page.waitForTimeout(400)
    await shot(`${theme}-11-settings`)
    await page.getByRole('radio', { name: 'Claude Code' }).click()
    await page.waitForTimeout(300)
    await shot(`${theme}-12-settings-claude`)
  })
}
