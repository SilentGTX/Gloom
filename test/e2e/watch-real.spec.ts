// Watching a real turn at the bottom: the view keeps to the end, never jumping back up or falling
// behind (it did both, 9 times in one turn, in 0.17.8). Against your real claude.exe on Haiku, so
// only when asked:   GLOOM_REAL_CLI=1 npx playwright test test/e2e/watch-real.spec.ts
import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, tempDir, triggerShortcut } from './app'

test.skip(!process.env.GLOOM_REAL_CLI, 'set GLOOM_REAL_CLI=1')

test('watching a real turn at the bottom, the view keeps to the end', async () => {
  test.setTimeout(180_000)
  delete process.env.GLOOM_CLAUDE_EXE
  const claudeDir = join(process.env.USERPROFILE ?? '', '.claude')
  const folder = join(tempDir('gloom-spike-jump-'), 'work')
  mkdirSync(folder, { recursive: true })
  const { app, page } = await launch({ claudeDir, design: 'concept', askClaude: true })
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog
    }, folder)
    await triggerShortcut(app, 'CmdOrCtrl+N')
    const where = page.getByRole('region', { name: 'Where Claude works' })
    await where.getByRole('button', { name: 'Choose environment' }).click()
    await page.getByRole('combobox', { name: 'Search environments' }).fill('choose')
    await page.getByRole('option', { name: 'Choose Folder…' }).click()
    await page.getByRole('button', { name: /^Model: / }).click()
    await page.getByRole('menuitemradio', { name: /Haiku/ }).first().click()
    const composer = page.getByRole('textbox', { name: 'Message' })
    await composer.fill(
      'Do this 6 times: write a paragraph of 4 sentences about a random animal, then run one Bash command `echo done` as its own tool call. Then write a final summary list of the 6 animals.'
    )
    await composer.press('Enter')
    await page.bringToFront()
    // Sampled in the page every animation frame, so a jump of one frame is caught too.
    await page.evaluate(() => {
      let s: HTMLElement | null = null
      const log: string[] = []
      ;(window as unknown as { jumps: string[] }).jumps = log
      let last = -1
      const t0 = performance.now()
      const tick = () => setTimeout(measure, 0)
      const measure = () => {
        const el = document.querySelector('[aria-label="Transcript"]') as HTMLElement | null
        if (el) {
          const gap = Math.round(el.scrollHeight - el.clientHeight - el.scrollTop)
          const top = Math.round(el.scrollTop)
          if (el !== s) {
            if (s) log.push(`${Math.round(performance.now() - t0)} SCROLLER REPLACED`)
            s = el
            last = -1
          }
          if (last >= 0 && (gap > 40 || top < last - 2)) log.push(`${Math.round(performance.now() - t0)}ms top ${last}→${top} gap=${gap} h=${el.scrollHeight}`)
          last = top
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    // Until the turn ends.
    const status = () => page.evaluate(() => document.body.innerText.includes('Working'))
    const t0 = Date.now()
    await page.waitForTimeout(3000)
    while (Date.now() - t0 < 150_000 && (await status())) await page.waitForTimeout(500)
    const jumps = await page.evaluate(() => (window as unknown as { jumps: string[] }).jumps)
    expect(jumps, jumps.join('\n')).toEqual([])
  } finally {
    await app.close()
  }
})
