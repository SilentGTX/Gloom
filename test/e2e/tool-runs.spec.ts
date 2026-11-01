// Runs of tool calls fold into one quiet line, as the Claude app shows them:
// "Ran 2 commands, searched code, read 2 files, edited a file +3 ›". A lone
// command reads as its description, in the past. Verbose still shows every
// step. Captures go to test-screens/tool-runs/.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ChatBuilder } from '../support/chat'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, setWindowSize, tempDir } from './app'

const dir = join(__dirname, '..', '..', 'test-screens', 'tool-runs')
test.setTimeout(120_000)

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

const capture = async (name: string) => {
  mkdirSync(dir, { recursive: true })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

const ID = 'eeeeeeee-0000-4000-8000-000000000001'
const TITLE = 'Compact tool calls'

const patch = (added: number, removed: number) => ({
  structuredPatch: [{ oldStart: 1, oldLines: removed, newStart: 1, newLines: added, lines: [...Array.from({ length: removed }, (_, i) => `-old ${i}`), ...Array.from({ length: added }, (_, i) => `+new ${i}`)] }]
})

function conversation(cwd: string): ChatBuilder {
  const c = new ChatBuilder(ID, cwd, minutesAgo(30))
  c.title(TITLE)
  c.prompt('Make the furniture smaller and check it.')
  c.respond().text('I’ll look around first.')
  c.tool({ name: 'Bash', input: { command: 'git status --short', description: 'Show working tree status' }, content: ' M src/Furniture.tsx' })
  c.tool({ name: 'Grep', input: { pattern: 'PlanList' }, content: 'src\\Furniture.tsx' })
  c.tool({ name: 'Read', input: { file_path: `${cwd}\\src\\Furniture.tsx` }, content: '1\texport function PlanList() {}' })
  c.tool({ name: 'Bash', input: { command: 'npm ls motion' }, content: 'motion@12' })
  c.tool({ name: 'Read', input: { file_path: `${cwd}\\src\\plan.ts` }, content: '1\texport const plan = []' })
  c.tool({ name: 'Edit', input: { file_path: `${cwd}\\src\\plan.ts`, old_string: 'a', new_string: 'b' }, content: 'Edited.', report: patch(3, 0) })
  c.text('Now the component, in five edits.')
  for (let i = 0; i < 5; i++) c.tool({ name: 'Edit', input: { file_path: `${cwd}\\src\\Furniture.tsx`, old_string: `a${i}`, new_string: `b${i}` }, content: 'Edited.', report: patch(7, 2) })
  c.text('Then the suites.')
  c.tool({ name: 'Bash', input: { command: 'npx vitest run && npx playwright test', description: 'Run the unit and end-to-end suites' }, content: 'All passed.' })
  c.text('Done: both boxes are smaller.')
  return c
}

async function open(design: 'concept' | 'classic') {
  const cwd = tempDir('gloom-tool-runs-')
  const claudeDir = fakeClaude([])
  conversation(cwd).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir, design }))
  await setWindowSize(app, 1440, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, TITLE).click()
  await expect(page.getByLabel('Transcript')).toBeVisible()
}

for (const design of ['concept', 'classic'] as const) {
  test(`runs of tool calls read as one line each (${design})`, async () => {
    await open(design)
    const transcript = page.getByLabel('Transcript')
    const run = transcript.getByRole('button', { name: /^Ran 2 commands, searched code, read 2 files, edited a file/ })
    await expect(run).toBeVisible()
    await expect(run).toContainText('+3')
    // Five edits to one file: one file, named, its lines summed.
    const edits = transcript.getByRole('button', { name: /^Edited Furniture\.tsx/ })
    await expect(edits).toContainText('+35')
    await expect(edits).toContainText('−10')
    // A lone command: its description, in the past.
    await expect(transcript.getByRole('button', { name: /^Ran the unit and end-to-end suites/ })).toBeVisible()
    // No step cards until something opens.
    await expect(transcript.locator('.concept-step')).toHaveCount(0)
    await capture(`folded-${design}`)

    // The run opens to its steps, each a line of its own; a step opens to what it did.
    await run.click()
    await expect(run).toHaveAttribute('aria-expanded', 'true')
    const steps = page.locator(`#${await run.getAttribute('aria-controls')}`).getByRole('button')
    await expect(steps).toHaveCount(6)
    await expect(steps.first()).toContainText('Showed working tree status')
    await steps.nth(5).click()
    await expect(page.getByText('+new 2').first()).toBeVisible()
    await capture(`open-${design}`)
  })
}

test('Verbose shows every step on its own', async () => {
  await open('concept')
  await page.evaluate(() => window.gloom!.runCommand('view.transcriptVerbose'))
  const transcript = page.getByLabel('Transcript')
  await expect(transcript.getByRole('button', { name: /^Ran 2 commands/ })).toHaveCount(0)
  // Each step is its own card again (the list draws only the rows near the screen, so count what's there).
  await expect(transcript.locator('.concept-step').first()).toBeVisible()
  // The five edits are five steps, not one summed line.
  await expect(transcript.getByRole('button', { name: /^Edited Furniture\.tsx/ }).first()).toContainText('+7')
  await expect(transcript.getByRole('button', { name: /\+35/ })).toHaveCount(0)
})
