import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DEEP_CHAIN, LONGEST_FOLDER, LONGEST_RENAME, WORST_CHAT_ID, WORST_CHAT_TITLE, worstChat, worstSessions } from '../support/worst-case'
import { fakeClaude, groupRow, launch, openGroup, settle, setWindowSize, sidebar, triggerShortcut } from './app'

// Phase 7's break-the-UI pass: the worst realistic library and chat
// (test/support/worst-case.ts), captured screen by screen into
// test-screens/worst-case/, with the checks that keep what it found fixed.
const dir = join(__dirname, '..', '..', 'test-screens', 'worst-case')
test.setTimeout(240_000)

const SESSIONS = worstSessions(500)
const [LONGEST, , , , CJK, , , EMOJI, , , , , , , GERMAN] = SESSIONS
const REST = SESSIONS.slice(17)

interface Seeded {
  chain: string[]
  long: string
  website: string
}

async function seed(page: Page): Promise<Seeded> {
  const apply = (op: object) => page.evaluate((o) => window.gloom!.applyLibrary(o as never), op)
  const create = async (name: string, parentId: string | null = null) => (await apply({ type: 'createFolder', parentId, name })).folderId!
  const chain: string[] = []
  for (const name of DEEP_CHAIN) chain.push(await create(name, chain.at(-1) ?? null))
  await create('Nothing here yet', chain[3])
  const long = await create(LONGEST_FOLDER)
  await create('Empty folder')
  await create('📦 Archive 2024')
  const cjk = await create('工作项目')
  const german = await create('Benachrichtigungseinstellungen')
  const website = await create('Website')
  const move = (ids: string[], folderId: string) => apply({ type: 'moveSessions', ids, folderId })
  await move([LONGEST.id, WORST_CHAT_ID, ...REST.slice(0, 7).map((s) => s.id)], chain[7])
  await move(REST.slice(7, 10).map((s) => s.id), chain[2])
  await move(REST.slice(10, 14).map((s) => s.id), long)
  await move([CJK.id, ...REST.slice(14, 16).map((s) => s.id)], cjk)
  await move([GERMAN.id], german)
  await move(REST.slice(16, 316).map((s) => s.id), website)
  await apply({ type: 'setArchived', ids: REST.slice(316, 436).map((s) => s.id), archived: true })
  await apply({ type: 'setPinned', ids: [LONGEST.id, SESSIONS[2].id, EMOJI.id, ...REST.slice(436, 445).map((s) => s.id)], pinned: true })
  await apply({ type: 'renameSession', id: REST[445].id, title: LONGEST_RENAME })
  await apply({ type: 'setExpanded', ids: [...chain, long], expanded: true })
  return { chain, long, website }
}

async function open(theme: 'light' | 'dark'): Promise<{ app: ElectronApplication; page: Page; seeded: Seeded }> {
  const claudeDir = fakeClaude(SESSIONS)
  worstChat().write(join(claudeDir, 'projects'))
  const { app, page } = await launch({ claudeDir })
  await setWindowSize(app, 1280, 800)
  await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
  await expect(groupRow(page, 'All Sessions')).toContainText(/50[01]$/)
  const seeded = await seed(page)
  await settle(page)
  return { app, page, seeded }
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(dir, `${name}.png`) })

/** Nothing in the sidebar or the transcript is wider than its box. */
async function overflow(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => el.scrollWidth - el.clientWidth)
}

for (const theme of ['light', 'dark'] as const) {
  test(`the worst-case library, ${theme}`, async () => {
    mkdirSync(dir, { recursive: true })
    const { app, page, seeded } = await open(theme)
    await openGroup(page, 'All Sessions')
    // (A pinned session's name starts "Pinned" too, for its pin.)
    await sidebar(page).locator('[data-nav="smart:pinned"]').click()
    await settle(page)
    await shot(page, `sidebar-top-${theme}`)

    // The chain, eight folders deep, with sessions at the bottom of it.
    await sidebar(page).locator(`[data-nav="folder:${seeded.chain[7]}"]`).scrollIntoViewIfNeeded()
    await settle(page)
    await shot(page, `sidebar-deep-${theme}`)

    // The longest title, selected: the toolbar and the info card.
    await sidebar(page).locator(`[data-nav="smart:all/${LONGEST.id}"]`).click()
    await settle(page)
    await shot(page, `toolbar-long-title-${theme}`)
    await page.getByRole('button', { name: 'Session info' }).click()
    await page.getByRole('dialog', { name: 'Session Info' }).waitFor()
    await page.waitForTimeout(300)
    await shot(page, `info-card-${theme}`)
    await page.keyboard.press('Escape')

    // Move To, with every folder in it.
    await sidebar(page).locator(`[data-nav="smart:all/${SESSIONS[2].id}"]`).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move To' }).hover()
    await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(300)
    await shot(page, `move-to-${theme}`)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // Search: many results, then none.
    await triggerShortcut(app, 'CmdOrCtrl+Shift+F')
    await expect(page.locator('input[data-search]')).toBeFocused()
    await page.keyboard.type('phase')
    await settle(page)
    await shot(page, `search-${theme}`)
    await page.keyboard.press('Control+A')
    await page.keyboard.type('qqqq')
    await settle(page)
    await shot(page, `search-empty-${theme}`)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // Archived: 120 sessions, all shown.
    await groupRow(page, 'Archived').click()
    await settle(page)
    await shot(page, `archived-${theme}`)
    await page.keyboard.press('Escape')
    await settle(page)

    expect(await overflow(page, 'aside[aria-label="Sidebar"] [role="tree"]')).toBeLessThanOrEqual(0)
    await app.close()
  })
}

test('the command palette over the worst-case library, light', async () => {
  mkdirSync(dir, { recursive: true })
  const { app, page } = await open('light')
  const palette = page.getByRole('dialog', { name: 'Command Palette' })
  const field = palette.getByRole('combobox')
  const list = '[aria-label="Command Palette"] [role="listbox"]'
  await triggerShortcut(app, 'CmdOrCtrl+K')
  await expect(field).toBeFocused()
  await shot(page, 'palette-recent')

  // Hundreds of matches (every prompt says "pick up where we left off"): the best thirty sessions.
  await field.fill('pick')
  await expect(palette.getByRole('group', { name: 'Sessions' }).getByRole('option')).toHaveCount(30)
  await shot(page, 'palette-many')
  expect(await overflow(page, list)).toBeLessThanOrEqual(0)

  // The folder at the bottom of the chain, eight deep, with where it is.
  await field.fill('week 42')
  await expect(palette.getByRole('option', { name: /^Week 42 hotfixes/ })).toBeVisible()
  await shot(page, 'palette-deep-folder')

  // Text at 200%: the palette stays up, and grows with it.
  await field.fill('t')
  for (let i = 0; i < 6; i++) await triggerShortcut(app, 'CmdOrCtrl+=')
  await expect(field).toBeFocused()
  await page.waitForTimeout(300)
  await shot(page, 'palette-text-200')
  expect(await overflow(page, list)).toBeLessThanOrEqual(0)
  const box = (await palette.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(800)
  await app.close()
})

test('the worst-case chat, light', async () => {
  mkdirSync(dir, { recursive: true })
  const { app, page, seeded } = await open('light')
  await sidebar(page).locator(`[data-nav="folder:${seeded.chain[7]}/${WORST_CHAT_ID}"]`).click()
  const transcript = page.getByLabel('Transcript')
  await expect(transcript).toContainText('That one is the writer')
  await page.waitForTimeout(600)
  await shot(page, 'chat-end')
  for (const [i, top] of [0, 900, 1800, 2700].entries()) {
    await transcript.evaluate((el, t) => (el.scrollTop = t), top)
    await page.waitForTimeout(400)
    await shot(page, `chat-${i}`)
  }
  expect(await overflow(page, '[aria-label="Transcript"]')).toBeLessThanOrEqual(0)

  await triggerShortcut(app, 'CmdOrCtrl+Shift+D')
  await page.waitForTimeout(800)
  await shot(page, 'diff')

  // Text at 200%.
  await triggerShortcut(app, 'CmdOrCtrl+Shift+D')
  for (let i = 0; i < 6; i++) await triggerShortcut(app, 'CmdOrCtrl+=')
  await page.waitForTimeout(500)
  await shot(page, 'text-200')
  await triggerShortcut(app, 'CmdOrCtrl+0')

  // Sheets with long values in them.
  await triggerShortcut(app, 'CmdOrCtrl+N')
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(400)
  await shot(page, 'new-session')
  await page.keyboard.press('Escape')
  await triggerShortcut(app, 'CmdOrCtrl+,')
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(400)
  await shot(page, 'settings')
  await page.keyboard.press('Escape')
  await groupRow(page, LONGEST_FOLDER.slice(0, 30)).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Filing Rules…' }).click()
  await page.getByRole('dialog').waitFor()
  await page.waitForTimeout(400)
  await shot(page, 'filing-rules')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // A toast naming the longest rename.
  await openGroup(page, 'All Sessions')
  await page.keyboard.press('Escape')
  await triggerShortcut(app, 'CmdOrCtrl+Shift+F')
  await expect(page.locator('input[data-search]')).toBeFocused()
  await page.keyboard.type('Renamed by hand')
  await settle(page)
  await sidebar(page).locator('[data-nav^="results/"]').first().click()
  await page.keyboard.press('Delete')
  await page.getByRole('button', { name: 'Undo' }).waitFor()
  await page.waitForTimeout(400)
  await shot(page, 'toast-long')

  // A narrow window.
  await setWindowSize(app, 760, 640)
  await page.waitForTimeout(500)
  await shot(page, 'narrow')
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await page.waitForTimeout(500)
  await shot(page, 'narrow-sheet')
  await app.close()
})
