// A new session, as the Claude app starts one: no dialog. The + beside a
// folder (or New Session) turns the chat into the new session, ready to type:
// Gloom's cloud over the places you've worked, Choose Environment for the
// rest, and under the composer where it runs and whether it gets a worktree.
// Nothing is made until the first message goes. Captures go to
// test-screens/new-session/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fakeClaude, groupRow, launch, minutesAgo, openGroup, sessionRow, setWindowSize, tempDir } from './app'

const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
const dir = join(__dirname, '..', '..', 'test-screens', 'new-session')
test.setTimeout(120_000)

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

const capture = async (name: string) => {
  mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

/** Three projects you've worked in, newest first: one of them through a worktree of its own. */
function projects() {
  const root = tempDir('gloom-new-session-')
  const folder = (name: string) => {
    const path = join(root, name)
    mkdirSync(path, { recursive: true })
    return path
  }
  const blissful = folder('blissful-girls')
  const js = folder('JS')
  const comfy = folder('ComfyUI')
  const worktree = join(comfy, '.claude', 'worktrees', 'dusky-cloud')
  mkdirSync(worktree, { recursive: true })
  const sessions = [
    { id: 'cccccccc-0000-4000-8000-000000000001', cwd: worktree, prompt: 'Tidy the nodes', title: 'Tidy the nodes', updated: minutesAgo(5) },
    { id: 'cccccccc-0000-4000-8000-000000000002', cwd: blissful, prompt: 'Fix the gallery', title: 'Fix the gallery', updated: minutesAgo(30) },
    { id: 'cccccccc-0000-4000-8000-000000000003', cwd: js, prompt: 'Look around', title: 'Look around', updated: minutesAgo(90) }
  ]
  return { blissful, js, comfy, claudeDir: fakeClaude(sessions) }
}

for (const design of ['concept', 'classic'] as const) {
  test(`the + beside a folder opens a new session in it, ready to type (${design})`, async () => {
    process.env.GLOOM_CLAUDE_EXE = FAKE
    process.env.FAKE_CLAUDE_FIXTURE = 'two-turns'
    process.env.FAKE_CLAUDE_SPEED = '0'
    const { blissful, comfy, claudeDir } = projects()
    ;({ app, page } = await launch({ claudeDir, design }))
    await setWindowSize(app, 1280, 860)
    await page.evaluate(() => window.gloom!.applyLibrary({ type: 'createFolder', parentId: null, name: 'Work' }))
    const work = groupRow(page, 'Work')
    await work.hover()
    await work.getByRole('button', { name: 'New session in Work' }).click()

    // The chat is the new session: its title, the folder it files into, the composer ready.
    await expect(page.getByRole('heading', { level: 1, name: 'New Session' })).toBeVisible()
    await expect(page.getByText('Files into Work')).toBeVisible()
    const composer = page.getByRole('textbox', { name: 'Message' })
    await expect(composer).toBeFocused()
    // The three places you worked last, newest first: the worktree's as its repository, checked.
    const where = page.getByRole('region', { name: 'Where Claude works' })
    await expect(where.getByRole('button', { pressed: true })).toHaveText('ComfyUI')
    await expect(where.getByRole('button', { name: /^(ComfyUI|blissful-girls|JS)$/ })).toHaveText(['ComfyUI', 'blissful-girls', 'JS'])
    await expect(page.getByRole('button', { name: /^Environment: / })).toContainText('ComfyUI')
    await capture(`new-session-${design}`)

    // Choose Environment: one list, searched as you type.
    await where.getByRole('button', { name: 'Choose environment' }).click()
    const search = page.getByRole('combobox', { name: 'Search environments' })
    await expect(search).toBeFocused()
    await capture(`environments-${design}`)
    await search.fill('bliss')
    await expect(page.getByRole('option')).toHaveCount(1 + 2)
    await search.press('Enter')
    await expect(page.getByRole('button', { name: /^Environment: / })).toContainText('blissful-girls')
    await expect(where.getByRole('button', { pressed: true })).toHaveText('blissful-girls')

    // The first message makes the session, there, filed into Work.
    await composer.fill('Reply with just: OK')
    await composer.press('Enter')
    await expect(page.getByLabel('Transcript').getByText('OK', { exact: true })).toBeVisible()
    const live = await page.evaluate(() => window.gloom!.live.list())
    expect(live.map((s) => s.cwd)).toContain(blissful)
    expect(live.map((s) => s.cwd)).not.toContain(comfy)
    await openGroup(page, 'Work')
    await expect(sessionRow(page, 'Reply with just: OK', `folder:${await work.getAttribute('data-folder-id')}`)).toBeVisible()
  })
}

test('leaving a new session unsent makes nothing, and its words wait for the next', async () => {
  const { claudeDir } = projects()
  ;({ app, page } = await launch({ claudeDir, design: 'concept' }))
  await page.evaluate(() => window.gloom!.runCommand('session.new'))
  const composer = page.getByRole('textbox', { name: 'Message' })
  await composer.fill('Half a thought')
  await openGroup(page, 'All Sessions')
  await sessionRow(page, 'Fix the gallery').click()
  expect(await page.evaluate(() => window.gloom!.live.list())).toHaveLength(0)
  await page.evaluate(() => window.gloom!.runCommand('session.new'))
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('Half a thought')
})
