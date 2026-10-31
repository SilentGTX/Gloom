import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEMO_ID, demoSession } from '../support/demo'
import { worstSessions } from '../support/worst-case'
import { fakeClaude, launch, minutesAgo, openGroup, sessionRow, settle, setWindowSize, sidebar, tempDir, triggerShortcut } from './app'

// Phase 7's audit captures: the live chat's composer and cards, Windows'
// contrast themes, Increase Contrast, reduced motion, and a walk through the
// window with Tab. Output: test-screens/audit/.
const dir = join(__dirname, '..', '..', 'test-screens', 'audit')
const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
const SESSION = '7f3c2a10-5b4d-4e6f-8a9b-0c1d2e3f4a5b'
const TITLE = 'Tidy the notes folder'
test.setTimeout(180_000)

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

const shot = (name: string) => page.screenshot({ path: join(dir, `${name}.png`) })

async function live(fixture: string, theme: 'light' | 'dark') {
  mkdirSync(dir, { recursive: true })
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = fixture
  process.env.FAKE_CLAUDE_SPEED = '0'
  const cwd = tempDir('gloom-live-')
  const claudeDir = fakeClaude([{ id: SESSION, cwd, prompt: 'Look at the notes', title: TITLE, created: minutesAgo(90), updated: minutesAgo(60) }])
  ;({ app, page } = await launch({ claudeDir }))
  await setWindowSize(app, 1280, 860)
  await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, TITLE).click()
  return page.getByRole('textbox', { name: 'Message' })
}

for (const theme of ['light', 'dark'] as const) {
  test(`the composer and its cards, ${theme}`, async () => {
    const composer = await live('permission', theme)
    await page.waitForTimeout(400)
    await shot(`composer-${theme}`)
    await page.getByRole('button', { name: /^Mode:/ }).click()
    await page.getByRole('menu').waitFor()
    await page.waitForTimeout(300)
    await shot(`mode-menu-${theme}`)
    await page.keyboard.press('Escape')
    await composer.fill('/')
    await page.waitForTimeout(400)
    await shot(`slash-${theme}`)
    await composer.fill('Make hello.txt, then a folder, then delete hello.txt')
    await composer.press('Enter')
    const card = page.getByRole('region', { name: 'Permission request' })
    await card.getByRole('button', { name: 'Allow Once' }).waitFor()
    await page.waitForTimeout(400)
    await shot(`permission-${theme}`)
    await card.getByRole('button', { name: 'Allow Once' }).click()
    await expect(card.getByRole('heading', { name: 'Allow Claude to run this command?' })).toBeVisible()
    await page.waitForTimeout(400)
    await shot(`permission-command-${theme}`)
  })

  test(`a plan and a question, ${theme}`, async () => {
    let composer = await live('plan', theme)
    await composer.fill('Plan how to create notes.txt')
    await composer.press('Enter')
    await page.getByRole('region', { name: 'Plan for review' }).getByRole('button', { name: 'Approve Plan' }).waitFor()
    await page.waitForTimeout(400)
    await shot(`plan-${theme}`)
    await app.close()
    composer = await live('question', theme)
    await composer.fill('Ask me which fruit I prefer')
    await composer.press('Enter')
    await page.getByRole('region', { name: 'Question from Claude' }).waitFor()
    await page.waitForTimeout(400)
    await shot(`question-${theme}`)
  })
}

test('working, with a message queued', async () => {
  const composer = await live('interrupt', 'light')
  await composer.fill('Count from 1 to 400')
  await composer.press('Enter')
  await expect(page.locator('main > header').getByRole('status')).toHaveText('Working…')
  await composer.fill('And then say hi')
  await composer.press('Enter')
  await page.waitForTimeout(600)
  await shot('working-queued')
})

/** The demo session in a small library, for the accessibility states. */
async function library(theme: 'light' | 'dark') {
  mkdirSync(dir, { recursive: true })
  const claudeDir = fakeClaude(worstSessions(40).slice(17))
  demoSession('D:\\Work\\api').write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir }))
  await setWindowSize(app, 1280, 860)
  await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
  await openGroup(page, 'Recent')
  await sidebar(page).locator(`[data-nav="smart:recent/${DEMO_ID}"]`).click()
  await page.locator('img[alt="Attached image"]').waitFor()
  await openGroup(page, 'All Sessions')
  await settle(page)
}

for (const theme of ['light', 'dark'] as const) {
  test(`Windows contrast themes and Increase Contrast, ${theme}`, async () => {
    await library(theme)
    await page.emulateMedia({ forcedColors: 'active' })
    await page.waitForTimeout(300)
    // A row the keyboard is on, beside the selection.
    await sidebar(page).locator(`[data-nav="smart:recent/${DEMO_ID}"]`).focus()
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(200)
    await shot(`forced-colors-${theme}`)
    await page.getByRole('button', { name: 'Session info' }).click()
    await page.waitForTimeout(300)
    await shot(`forced-colors-info-${theme}`)
    await page.keyboard.press('Escape')
    await page.emulateMedia({ forcedColors: 'none', contrast: 'more' })
    await page.waitForTimeout(300)
    await shot(`contrast-more-${theme}`)
  })
}

test('the keyboard walks every control, each with a visible focus', async () => {
  await library('light')
  // Start where a person arriving with the keyboard would: nothing focused.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const seen: string[] = []
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const name = el.getAttribute('aria-label') ?? el.getAttribute('data-label') ?? el.textContent?.trim().slice(0, 40) ?? ''
      const role = el.getAttribute('role') ?? el.tagName.toLowerCase()
      // A ring drawn on the element, or on the row inside it (tree items ring their inner row);
      // a splitter thickens its line instead.
      const outlined = (node: Element | null) => {
        if (!(node instanceof HTMLElement)) return false
        const s = getComputedStyle(node)
        return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0
      }
      const line = el.firstElementChild instanceof HTMLElement ? el.firstElementChild.getBoundingClientRect().width : 0
      // A field's ring is its box's (the search field's label).
      const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      const ringed = outlined(el) || outlined(el.firstElementChild) || (field && outlined(el.parentElement)) || (role === 'separator' && line >= 2)
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return `${role} "${name}" ${ringed ? 'ring' : 'NO RING'} (outline ${s.outlineStyle} ${s.outlineWidth}, focus-visible ${el.matches(':focus-visible')}) at ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`
    })
    seen.push(info ?? '(nothing)')
    if (info?.startsWith('button "Hide sidebar"')) await page.screenshot({ path: join(dir, 'focus-toolbar.png'), clip: { x: 980, y: 0, width: 300, height: 48 } })
  }
  writeFileSync(join(dir, 'keyboard-walk.txt'), seen.map((s, i) => `${i + 1}. ${s}`).join('\n') + '\n')
  // Tailwind's outline-none once cancelled every focus-visible ring.
  expect(seen.filter((s) => s.includes('NO RING'))).toEqual([])
})

test('F6 and Shift+F6 step the keyboard between the panes', async () => {
  await library('light')
  await triggerShortcut(app, 'CmdOrCtrl+Shift+D')
  await page.locator('aside[aria-label="Diff"]').waitFor()
  const pane = () => page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null)
  await sidebar(page).locator(`[data-nav="smart:recent/${DEMO_ID}"]`).focus()
  const forward: (string | null)[] = []
  for (let i = 0; i < 4; i++) {
    await triggerShortcut(app, 'F6')
    forward.push(await pane())
  }
  // The demo's folder is gone, so the composer's place holds Recreate Folder.
  expect(forward).toEqual(['transcript', 'composer', 'diff', 'sidebar'])
  await triggerShortcut(app, 'Shift+F6')
  expect(await pane()).toBe('diff')
  // From a toolbar's button, between panes, it goes on to the pane after it.
  await page.getByRole('button', { name: 'Session info' }).focus()
  await triggerShortcut(app, 'F6')
  expect(await pane()).toBe('transcript')
})
