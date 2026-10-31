// The side pane (PLAN.md › 12, part C): a file at a line, the plan, the
// background tasks, the browser with the project's dev servers, and the
// artifacts, on the trailing side, the diff pane stepping aside for it.
// Captures go to test-screens/parity/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { demoSession, DEMO_TITLE } from '../support/demo'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, tempDir } from './app'

const dir = join(__dirname, '..', '..', 'test-screens', 'parity')
test.setTimeout(120_000)

let app: ElectronApplication
let page: Page
let server: Server | null = null
test.afterEach(async () => {
  await app?.close()
  server?.close()
  server = null
})

const capture = async (name: string) => {
  mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

async function openDemo(design: 'concept' | 'classic' = 'classic') {
  const cwd = tempDir('gloom-side-')
  mkdirSync(join(cwd, 'src'), { recursive: true })
  writeFileSync(join(cwd, 'src', 'server.ts'), "import Fastify from 'fastify'\nimport { routes } from './routes'\n\nconst app = Fastify()\napp.register(routes)\napp.listen({ port: 3000 })\n")
  const claudeDir = fakeClaude([])
  demoSession(cwd, minutesAgo(50)).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir, design }))
  await setWindowSize(app, 1440, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, DEMO_TITLE).click()
  await expect(page.getByLabel('Transcript')).toBeVisible()
  return cwd
}

const pane = () => page.getByRole('complementary', { name: 'Pane' })

test('a file step opens the file in the side pane, at its line, and the diff pane steps aside', async () => {
  await openDemo()
  await page.evaluate(() => window.gloom!.runCommand('view.toggleDiff'))
  await expect(page.getByRole('complementary', { name: 'Diff' })).toBeVisible()
  // The demo's Read of server.ts: open its details, then Open File.
  const transcript = page.getByLabel('Transcript')
  for (let i = 0; i < 30 && !(await transcript.getByText('server.ts').first().count()); i++) {
    await transcript.evaluate((el) => {
      const s = (el.querySelector('[data-virtuoso-scroller]') as HTMLElement | null) ?? el
      s.scrollTop = Math.max(0, s.scrollTop - 400)
    })
    await page.waitForTimeout(100)
  }
  await transcript.getByRole('button', { name: /Read server\.ts/ }).first().click()
  await transcript.getByRole('button', { name: 'Open File' }).first().click()
  await expect(pane()).toBeVisible()
  await expect(pane().getByText('app.listen({ port: 3000 })')).toBeVisible()
  // The diff pane stepped aside; closing the side pane brings it back.
  await expect(page.getByRole('complementary', { name: 'Diff' })).toHaveCount(0)
  await capture('side-file')
  await pane().getByRole('button', { name: 'Close pane' }).click()
  await expect(page.getByRole('complementary', { name: 'Diff' })).toBeVisible()
})

test('the Browser pane opens a page beside the chat', async () => {
  await openDemo('concept')
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Gloom test page</title><h1 style="font:40px system-ui">Hello from the dev server</h1>')
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await page.evaluate(() => window.gloom!.runCommand('view.paneBrowser'))
  const address = pane().getByLabel('Address')
  await address.fill(`127.0.0.1:${port}`)
  await address.press('Enter')
  const id = await sessionRow(page, DEMO_TITLE).getAttribute('data-session-id')
  await expect.poll(async () => (await page.evaluate((sid) => window.gloom!.browser.state(sid!), id)).title).toBe('Gloom test page')
  await capture('side-browser')
  // The other tabs say what they're for while empty.
  await pane().getByRole('tab', { name: 'Tasks' }).click()
  await expect(pane().getByText('Nothing in the Background')).toBeVisible()
  await pane().getByRole('tab', { name: 'Plan' }).click()
  await expect(pane().getByText('No Plan Yet')).toBeVisible()
  await pane().getByRole('tab', { name: 'Artifacts' }).click()
  await expect(pane().getByText('No Artifacts')).toBeVisible()
})

test('a session opens beside the open one in split view, with its own conversation', async () => {
  const cwd = tempDir('gloom-split-')
  const claudeDir = fakeClaude([{ id: 'cccccccc-0000-4000-8000-000000000021', cwd, prompt: 'Sync the episode guide nightly', title: 'Episode guide sync', updated: minutesAgo(33) }])
  demoSession(cwd, minutesAgo(50)).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir, design: 'concept' }))
  await setWindowSize(app, 1440, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, DEMO_TITLE).click()
  await expect(page.getByLabel('Transcript')).toBeVisible()
  await sessionRow(page, 'Episode guide sync').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Open in Split View' }).click()
  const second = page.getByRole('main', { name: 'Second session' })
  await expect(second).toBeVisible()
  await expect(second.getByText('Episode guide sync').first()).toBeVisible()
  // Each column reads its own conversation.
  await expect(page.getByLabel('Transcript')).toHaveCount(2)
  await capture('split-view')
  await second.getByRole('button', { name: 'Close split view' }).click()
  await expect(second).toHaveCount(0)
})

test('a pane opens in a window of its own', async () => {
  await openDemo('concept')
  await page.evaluate(() => window.gloom!.runCommand('view.panePlan'))
  await expect(pane()).toBeVisible()
  const opened = app.waitForEvent('window')
  await pane().getByRole('button', { name: 'Open in window' }).click()
  const popped = await opened
  await expect(popped.getByRole('complementary', { name: 'Pane' })).toBeVisible()
  await expect(popped.getByText('No Plan Yet')).toBeVisible()
  // The main window's pane made way for it.
  await expect(pane()).toHaveCount(0)
})
