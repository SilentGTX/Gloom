// Part D of the Claude-app parity work (PLAN.md › 12): a session's pull
// request, Routines, SSH connections and cloud sessions. gh, ssh and the
// cloud aren't reached here: the PR pane shows its empty state and link
// form, a routine runs on the fake claude, and New Session offers the other
// machines and the cloud. Captures go to test-screens/parity/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { demoSession, DEMO_TITLE } from '../support/demo'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, sidebar, tempDir } from './app'

const dir = join(__dirname, '..', '..', 'test-screens', 'parity')
const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
test.setTimeout(120_000)

let app: ElectronApplication
let page: Page
test.afterEach(async () => {
  await app?.close()
  delete process.env.GLOOM_CLAUDE_EXE
  delete process.env.FAKE_CLAUDE_FIXTURE
})

const capture = async (name: string) => {
  mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

async function openDemo() {
  const cwd = tempDir('gloom-remote-')
  const claudeDir = fakeClaude([])
  demoSession(cwd, minutesAgo(50)).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir, design: 'concept' }))
  await setWindowSize(app, 1440, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, DEMO_TITLE).click()
  await expect(page.getByLabel('Transcript')).toBeVisible()
  return cwd
}

test('the PR pane says when a session has no pull request, and links one by its URL', async () => {
  await openDemo()
  await page.evaluate(() => window.gloom!.runCommand('view.panePr'))
  const pane = page.getByRole('complementary', { name: 'Pane' })
  await expect(pane.getByText('No Pull Request')).toBeVisible({ timeout: 20_000 })
  await expect(pane.getByLabel('Pull request URL')).toBeVisible()
  await capture('pr-empty')
})

test('a routine runs in a new session, filed under Routines', async () => {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = 'two-turns'
  const cwd = await openDemo()
  // Made straight through the bridge (the sheet's folder picker is the system's), then run from the sheet.
  await page.evaluate((folder) => window.gloom!.routines.save({ name: 'Nightly check', prompt: 'Check the build and report.', cwd: folder, cron: null, at: null, enabled: true, mode: 'default' }), cwd)
  await page.evaluate(() => window.gloom!.runCommand('session.routines'))
  const sheet = page.getByRole('dialog', { name: 'Routines' })
  await expect(sheet.getByText('Nightly check')).toBeVisible()
  await expect(sheet.getByText('When you start it')).toBeVisible()
  await capture('routines')
  await sheet.getByRole('button', { name: 'Run Nightly check now' }).click()
  await sheet.getByRole('button', { name: 'Done' }).click()
  // The run's session shows under Routines, named for the routine.
  await expect(sidebar(page).getByRole('treeitem', { name: /^Routines/ })).toBeVisible({ timeout: 15_000 })
  await openGroup(page, 'Routines')
  await expect(sidebar(page).locator('[data-nav^="smart:routines/"][data-label="Nightly check"]')).toBeVisible()
})

test('New Session offers SSH connections from Settings, and the cloud', async () => {
  await openDemo()
  await page.evaluate(() => window.gloom!.setSettings({ sshHosts: [{ id: 'mini', name: 'Mac mini', host: 'mac-mini', claude: null }] }))
  await page.evaluate(() => window.gloom!.runCommand('session.new'))
  // Choose Environment lists the connection under SSH; picked, its folder there shows under the composer.
  await page.getByRole('region', { name: 'Where Claude works' }).getByRole('button', { name: 'Choose environment' }).click()
  await expect(page.getByRole('group', { name: 'SSH' })).toBeVisible()
  await page.getByRole('option', { name: /Mac mini/ }).click()
  await expect(page.getByRole('button', { name: /^Environment: Mac mini/ })).toBeVisible()
  await expect(page.getByLabel('Folder on Mac mini')).toHaveValue('~')
  await capture('new-session-ssh')
  // And the cloud, from the folder's repository: the message is its task.
  await page.getByRole('button', { name: /^Environment: / }).click()
  await page.getByRole('option', { name: /Claude in the Cloud/ }).click()
  await expect(page.getByText('Your message is the task; it runs on claude.ai.')).toBeVisible()
})
