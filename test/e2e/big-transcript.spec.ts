import { expect, test } from '@playwright/test'
import { linkSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { launch, openGroup, setWindowSize, sidebar, tempDir } from './app'

// How long your biggest transcript takes to open (the plan's bar: a readable
// screen in under a second, without reading the whole file). Opt-in, since it
// reads one of your own sessions: GLOOM_BIG_TRANSCRIPT=<path to a .jsonl>.
// The file is hard-linked into a throwaway Claude folder (same drive), never
// copied or changed, and nothing of it is captured: only times are printed.
const file = process.env.GLOOM_BIG_TRANSCRIPT
test.skip(!file, 'set GLOOM_BIG_TRANSCRIPT to a transcript to time')
test.setTimeout(120_000)

test('your biggest transcript opens to a readable screen in under a second', async () => {
  const claudeDir = tempDir('gloom-big-')
  const project = join(claudeDir, 'projects', basename(dirname(file!)))
  mkdirSync(project, { recursive: true })
  linkSync(file!, join(project, basename(file!)))
  const id = basename(file!, '.jsonl')

  const started = Date.now()
  const { app, page } = await launch({ claudeDir })
  await setWindowSize(app, 1280, 860)
  await openGroup(page, 'All Sessions')
  const row = sidebar(page).locator(`[data-nav="smart:all/${id}"]`)
  await row.waitFor()
  const indexed = Date.now() - started

  const t0 = Date.now()
  await row.click()
  await expect(page.locator('[aria-label="Transcript"] [data-index]').first()).toBeVisible({ timeout: 30_000 })
  const opened = Date.now() - t0

  // An older page, as scrolling to the top asks for (none when the page reaches a compaction).
  const t1 = Date.now()
  const first = () => page.locator('[aria-label="Transcript"] [data-index]').first().getAttribute('data-index')
  const before = await first()
  await page.getByLabel('Transcript').evaluate((el) => (el.scrollTop = 0))
  const older = await expect
    .poll(first, { timeout: 10_000 })
    .not.toBe(before)
    .then(() => `${Date.now() - t1} ms`)
    .catch(() => 'none (the page starts at a compaction)')

  console.log(`indexed in ${indexed} ms (launch included); opened in ${opened} ms; an older page: ${older}`)
  expect(opened).toBeLessThan(1000)
  await app.close()
})
