// What Gloom's own tools for Claude leave in a conversation (PLAN.md › 12, part
// B), read back from the transcript: the task list pinned under the latest
// message, the next-step box with its buttons, chapter dividers and the table
// of contents, an inline widget in its sandboxed frame, and a proposed
// session's card. The same shapes as the Claude app's tools, whose sessions
// show the same way. Captures go to test-screens/parity/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ChatBuilder } from '../support/chat'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, tempDir } from './app'

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

const ID = 'dddddddd-0000-4000-8000-000000000001'
const TITLE = 'Tools in the conversation'

/** A conversation that used Gloom's tools: a plan, chapters, a widget, a proposal, and a wrap-up at its end. */
function conversation(cwd: string): ChatBuilder {
  const c = new ChatBuilder(ID, cwd, minutesAgo(30))
  c.title(TITLE)
  c.prompt('Add a health check page and chart the response times.')
  c.respond().text('I’ll plan it first.')
  c.tool({ name: 'mcp__gloom__update_plan', input: { items: [{ content: 'Read the routes', status: 'in_progress' }, { content: 'Add the health page', status: 'pending' }, { content: 'Chart response times', status: 'pending' }] }, content: 'Plan shown (3 steps).' })
  c.tool({ name: 'mcp__gloom__mark_chapter', input: { title: 'Exploration', summary: 'Reading how routes are set up' }, content: 'Chapter marked.' })
  c.tool({ name: 'Read', input: { file_path: `${cwd}\\src\\routes.ts` }, content: '1\texport const routes = []' })
  c.tool({ name: 'mcp__gloom__update_plan', input: { advance: true }, content: 'Plan updated: step 2 of 3 is in progress.' })
  c.tool({ name: 'mcp__gloom__mark_chapter', input: { title: 'Implementation' }, content: 'Chapter marked.' })
  c.tool({ name: 'mcp__gloom__update_plan', input: { advance: true }, content: 'Plan updated: step 3 of 3 is in progress.' })
  c.tool({
    name: 'mcp__gloom__show_widget',
    input: { title: 'response_times', widget_code: '<svg viewBox="0 0 200 60" xmlns="http://www.w3.org/2000/svg"><polyline style="fill:none;stroke:var(--accent);stroke-width:3" points="0,50 40,30 80,35 120,10 160,20 200,5"/></svg>' },
    content: 'Shown inline as "response_times".'
  })
  c.tool({
    name: 'mcp__gloom__start_session',
    input: { title: 'Add alerting on slow responses', prompt: 'Wire an alert when the p95 passes 500 ms.', background: 'The health page and chart are done in the main session; this adds alerting on top of them, in src/alerts.', initiation: 'own_initiative', context: 'fresh' },
    content: 'Proposed as a card (task_id=11111111-2222-4333-8444-555555555555). Nothing runs until the user starts it.'
  })
  c.tool({ name: 'mcp__gloom__wrap_up', input: { recap: 'The health page answers at /health and the chart shows response times. Nothing is committed yet.', ask: 'Commit this?', actions: [{ label: 'Commit it' }, { label: 'Not yet' }] }, content: 'Shown in the next-step box.' })
  c.text('Done: the page and the chart are in.')
  return c
}

async function open() {
  const cwd = tempDir('gloom-furniture-')
  const claudeDir = fakeClaude([])
  conversation(cwd).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir, design: 'concept' }))
  await setWindowSize(app, 1440, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, TITLE).click()
  await expect(page.getByLabel('Transcript')).toBeVisible()
}

test('the task list, the next-step box, chapters, a widget and a proposal show as themselves', async () => {
  await open()
  // The turn wrapped up and every step is done, so the task list has gone (the Tasks pane keeps it).
  await expect(page.getByRole('region', { name: 'Next step' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Task list' })).toHaveCount(0)
  // The next-step box: the recap and the question, its buttons answering it. A short recap needs no Show More.
  const next = page.getByRole('region', { name: 'Next step' })
  await expect(next).toContainText('The health page answers at /health')
  await expect(next.getByRole('button', { name: 'Show More' })).toHaveCount(0)
  await expect(next.getByRole('button', { name: 'Commit it' })).toBeVisible()
  // The widget, in its frame, drawn by Gloom's widget scheme.
  const frame = page.frameLocator('iframe[title="response_times"]')
  await expect(frame.locator('polyline')).toHaveCount(1)
  // The proposal: its title and brief, Start (the proposal isn't known to this launch, so it reads as gone).
  await expect(page.getByRole('region', { name: /Proposed session: Add alerting/ })).toBeVisible()
  await capture('furniture')
  // Chapters: a divider each, and the contents once there are two.
  await page.getByRole('button', { name: 'Contents' }).click()
  const chapters = page.getByRole('navigation', { name: 'Chapters' })
  await expect(chapters.getByRole('button')).toHaveText([/Exploration/, /Implementation/])
  await capture('furniture-contents')
  await chapters.getByRole('button', { name: /Exploration/ }).click()
  await expect(page.getByRole('separator', { name: 'Chapter: Exploration' })).toBeVisible()
})

const STOPPED = 'dddddddd-0000-4000-8000-000000000002'
const LONG = 'dddddddd-0000-4000-8000-000000000003'

/** Two more conversations: one stopped in the middle of its plan, one whose wrap-up says a lot. */
function more(cwd: string): ChatBuilder[] {
  const stopped = new ChatBuilder(STOPPED, cwd, minutesAgo(20))
  stopped.title('Stopped mid-plan')
  stopped.prompt('Add a health check page and chart the response times.')
  stopped.respond().text('I’ll plan it first.')
  stopped.tool({ name: 'mcp__gloom__update_plan', input: { items: [{ content: 'Read the routes', status: 'in_progress' }, { content: 'Add the health page', status: 'pending' }, { content: 'Chart response times', status: 'pending' }] }, content: 'Plan shown (3 steps).' })
  stopped.tool({ name: 'mcp__gloom__update_plan', input: { advance: true }, content: 'Plan updated: step 2 of 3 is in progress.' })
  stopped.text('Reading done; the page is next.')

  const long = new ChatBuilder(LONG, cwd, minutesAgo(10))
  long.title('A long wrap-up')
  long.prompt('Ship it.')
  long.respond().text('Shipping.')
  const recap =
    'Gloom 0.15.8 is published: sessions reopen on their last model and effort, and updates no longer flash a purple pet square or shift the window’s colour. ' +
    'The packaged check passed 4/4 before release, after fixing a test that expected the old window address. The installer is not code-signed, so SmartScreen may warn. ' +
    'The dev-app-id checkout still has the old uncommitted rename change, left alone.'
  long.tool({ name: 'mcp__gloom__wrap_up', input: { recap }, content: 'Shown in the next-step box.' })
  long.text('Released.')
  return [stopped, long]
}

test('an unfinished task list is one line, opens to every step, and stays open after a restart', async () => {
  const cwd = tempDir('gloom-furniture-')
  const claudeDir = fakeClaude([])
  for (const c of more(cwd)) c.write(join(claudeDir, 'projects'))
  const userData = tempDir('gloom-furniture-profile-')
  ;({ app, page } = await launch({ claudeDir, userData, design: 'concept' }))
  await setWindowSize(app, 1440, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, 'Stopped mid-plan').click()
  // Folded: the step under way and how many are done, no steps listed.
  const tasks = page.getByRole('region', { name: 'Task list' })
  await expect(tasks).toContainText('Add the health page')
  await expect(tasks).toContainText('1 of 3')
  await expect(tasks.getByRole('listitem')).toHaveCount(0)
  const toggle = tasks.getByRole('button', { expanded: false })
  // One line: as tall as a chip, not a card.
  expect((await tasks.boundingBox())!.height).toBeLessThan(44)
  await capture('furniture-folded')
  await toggle.click()
  await expect(tasks.getByRole('listitem')).toHaveCount(3)
  await expect(tasks.getByRole('button', { expanded: true })).toBeVisible()
  await capture('furniture-open')
  // Remembered: a restart (and any other session's list) opens the same way.
  await app.close()
  ;({ app, page } = await launch({ claudeDir, userData, design: 'concept' }))
  await openGroup(page, 'All Sessions')
  await sessionRow(page, 'Stopped mid-plan').click()
  await expect(page.getByRole('region', { name: 'Task list' }).getByRole('listitem')).toHaveCount(3)
})

test('a long recap shows two lines, and Show More opens the rest', async () => {
  const cwd = tempDir('gloom-furniture-')
  const claudeDir = fakeClaude([])
  for (const c of more(cwd)) c.write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir, design: 'concept' }))
  await setWindowSize(app, 1440, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, 'A long wrap-up').click()
  const next = page.getByRole('region', { name: 'Next step' })
  const recap = next.locator('p').first()
  await expect(recap).toContainText('Gloom 0.15.8 is published')
  const lines = async () => recap.evaluate((el) => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)))
  expect(await lines()).toBe(2)
  await capture('furniture-recap')
  await next.getByRole('button', { name: 'Show More' }).click()
  await expect(next.getByRole('button', { name: 'Show Less' })).toHaveAttribute('aria-expanded', 'true')
  expect(await lines()).toBeGreaterThan(2)
})

test('Verbose shows the tool calls behind the furniture', async () => {
  await open()
  await page.evaluate(() => window.gloom!.runCommand('view.transcriptVerbose'))
  await expect(page.getByLabel('Transcript').getByText('Updated the plan').first()).toBeVisible()
})
