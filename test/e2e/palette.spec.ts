import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fakeClaude, groupRow, launch, minutesAgo, setWindowSize, sidebar, tempDir, triggerShortcut } from './app'

/** A working folder that exists, named like a project, so a session's composer shows. */
const project = (name: string) => {
  const cwd = join(tempDir('gloom-palette-'), name)
  mkdirSync(cwd)
  return cwd
}
// Three sessions in three projects, as Claude Code would have written them.
const SESSIONS = [
  { id: 'eeeeeeee-0000-4000-8000-000000000001', cwd: project('api'), prompt: 'Add rate limiting to the API', title: 'API rate limits', updated: minutesAgo(30) },
  { id: 'eeeeeeee-0000-4000-8000-000000000002', cwd: project('web'), prompt: 'Fix the login page', title: 'Login page fix', updated: minutesAgo(90) },
  { id: 'eeeeeeee-0000-4000-8000-000000000003', cwd: project('notes'), prompt: 'Sort my notes', title: 'Notes cleanup', updated: minutesAgo(60 * 30) }
]
// Captures of the palette in light and dark. Output: test-screens/palette/.
const dir = join(__dirname, '..', '..', 'test-screens', 'palette')

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await setWindowSize(app, 1280)
  await expect(groupRow(page, 'All Sessions')).toContainText('3')
})
test.afterEach(async () => app?.close())

const palette = () => page.getByRole('dialog', { name: 'Command Palette' })
const field = () => palette().getByRole('combobox', { name: 'Search commands, sessions and folders' })
const option = (name: string | RegExp) => palette().getByRole('option', { name })
/** The result Enter would use. */
const active = () => palette().locator('[role="option"][aria-selected="true"]')
const title = () => page.locator('main h1')
const open = async () => {
  await triggerShortcut(app, 'CmdOrCtrl+K')
  await expect(field()).toBeFocused()
}

test('Ctrl+K finds a command, Enter runs it, and Esc clears, then closes', async () => {
  await open()
  // Before you type: the sessions you were in last, then every command.
  await expect(palette().getByRole('group', { name: 'Recent' })).toBeVisible()
  await expect(palette().getByRole('group', { name: 'Commands' }).getByRole('option', { name: /New Session/ })).toBeVisible()
  // The field points at the result Enter uses.
  const first = active()
  await expect(first).toHaveCount(1)
  await expect(field()).toHaveAttribute('aria-activedescendant', (await first.getAttribute('id'))!)

  await field().fill('hide side')
  await expect(active()).toHaveAccessibleName(/Hide Sidebar/)
  await field().press('Enter')
  await expect(palette()).toHaveCount(0)
  await expect(sidebar(page)).toHaveCount(0)

  // Shown again, the same command says what it will do now.
  await open()
  await field().fill('show side')
  await expect(active()).toHaveAccessibleName(/Show Sidebar/)
  await field().press('Enter')
  await expect(sidebar(page)).toBeVisible()

  // A command that takes the keyboard somewhere keeps it there.
  await open()
  await field().fill('search sessions')
  await field().press('Enter')
  await expect(page.getByRole('searchbox', { name: 'Search sessions' })).toBeFocused()

  await open()
  await field().fill('qqqzz')
  await expect(palette()).toContainText('No results for “qqqzz”')
  await field().press('Escape')
  await expect(field()).toHaveValue('')
  await expect(palette()).toBeVisible()
  await field().press('Escape')
  await expect(palette()).toHaveCount(0)
  // Ctrl+K again puts it away too.
  await open()
  await triggerShortcut(app, 'CmdOrCtrl+K')
  await expect(palette()).toHaveCount(0)
})

test('arrows move through the results, skipping what can’t run, and the pointer picks too', async () => {
  await open()
  await field().fill('undo')
  // Nothing to undo: Undo is listed, dimmed, and Enter leaves it be.
  await expect(option(/^Undo/)).toHaveAttribute('aria-disabled', 'true')
  await expect(active()).toHaveCount(0)
  await field().press('Enter')
  await expect(palette()).toBeVisible()

  await field().fill('new')
  const names = await palette().getByRole('option').allInnerTexts()
  expect(names[0]).toMatch(/^New Session/)
  await field().press('ArrowDown')
  await expect(active()).toHaveAccessibleName(/^New Folder/)
  await field().press('ArrowUp')
  await field().press('ArrowUp')
  await expect(active()).toHaveAccessibleName(/^New Session/)

  // Moving onto a result picks it; a click runs it.
  await option(/^New Folder/).hover()
  await expect(active()).toHaveAccessibleName(/^New Folder/)
  await option(/^New Folder/).click()
  await expect(palette()).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Folder name' })).toBeFocused()
})

test('a session opens with the keyboard in its composer, and Recent goes back to the one before', async () => {
  await open()
  await field().fill('login')
  await expect(active()).toHaveAccessibleName(/Login page fix/)
  await field().press('Enter')
  await expect(title()).toHaveText('Login page fix')
  const composer = page.locator('textarea[data-composer]')
  await expect(composer).toBeFocused()
  // Put away, the palette gives the keyboard back where it was.
  await open()
  await field().press('Escape')
  await expect(palette()).toHaveCount(0)
  await expect(composer).toBeFocused()
  // A session counts as visited once it has stayed open a moment.
  await page.waitForTimeout(1300)

  await open()
  await field().fill('rate limits')
  await field().press('Enter')
  await expect(title()).toHaveText('API rate limits')
  await page.waitForTimeout(1300)

  // Before you type, the session you were in before is first: Enter goes back to it.
  await open()
  const recent = palette().getByRole('group', { name: 'Recent' }).getByRole('option')
  await expect(recent.first()).toHaveAccessibleName(/Login page fix/)
  // The open session isn't somewhere to go.
  await expect(recent.filter({ hasText: 'API rate limits' })).toHaveCount(0)
  await field().press('Enter')
  await expect(title()).toHaveText('Login page fix')
})

test('a folder deep inside others opens, with every folder above it, and takes the keyboard', async () => {
  const apply = (op: object) => page.evaluate((o) => window.gloom!.applyLibrary(o as never), op)
  const work = (await apply({ type: 'createFolder', parentId: null, name: 'Work' })).folderId!
  const clients = (await apply({ type: 'createFolder', parentId: work, name: 'Clients' })).folderId!
  await apply({ type: 'createFolder', parentId: clients, name: 'Acme' })
  await apply({ type: 'setExpanded', ids: [work, clients], expanded: false })
  await expect(groupRow(page, 'Work')).toHaveAttribute('aria-expanded', 'false')
  await expect(groupRow(page, 'Acme')).toHaveCount(0)

  await open()
  await field().fill('acme')
  await expect(active()).toHaveAccessibleName(/^Acme.*in Work › Clients/)
  await field().press('Enter')
  await expect(groupRow(page, 'Work')).toHaveAttribute('aria-expanded', 'true')
  await expect(groupRow(page, 'Clients')).toHaveAttribute('aria-expanded', 'true')
  await expect(groupRow(page, 'Acme')).toBeFocused()
})

test('from the menu it grows in; a click outside puts it away and goes no further', async () => {
  await page.getByRole('button', { name: 'Menu' }).first().click()
  await page.getByRole('menuitem', { name: /Command Palette/ }).click()
  await expect(field()).toBeFocused()
  // The window under it can't be reached meanwhile.
  expect(await page.evaluate(() => document.querySelector('main')!.closest('[inert]') !== null)).toBe(true)

  // Put away, it gives the keyboard back to the menu's button.
  await field().press('Escape')
  await expect(palette()).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Menu' }).first()).toBeFocused()

  // A press on New Session's button, under the palette's shield, only closes the palette.
  await triggerShortcut(app, 'CmdOrCtrl+K')
  await expect(field()).toBeFocused()
  await sidebar(page).locator('button[aria-label="New session"]').click({ force: true })
  await expect(palette()).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: /New Session/ })).toHaveCount(0)
})

test('it waits while a sheet is up', async () => {
  await triggerShortcut(app, 'CmdOrCtrl+,')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await triggerShortcut(app, 'CmdOrCtrl+K')
  await page.waitForTimeout(200)
  await expect(palette()).toHaveCount(0)
})

test('captures in light and dark', async () => {
  mkdirSync(dir, { recursive: true })
  for (const theme of ['light', 'dark'] as const) {
    await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
    await open()
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(dir, `recent-${theme}.png`) })
    await field().fill('term')
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(dir, `search-${theme}.png`) })
    // Windows' contrast themes repaint every fill: the result Enter uses takes the theme's highlight.
    await page.emulateMedia({ forcedColors: 'active' })
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(dir, `forced-colors-${theme}.png`) })
    await page.emulateMedia({ forcedColors: 'none', contrast: 'more' })
    await page.waitForTimeout(150)
    await page.screenshot({ path: join(dir, `contrast-more-${theme}.png`) })
    await page.emulateMedia({ contrast: 'no-preference' })
    await field().press('Escape')
    await field().press('Escape')
    await expect(palette()).toHaveCount(0)
  }
})
