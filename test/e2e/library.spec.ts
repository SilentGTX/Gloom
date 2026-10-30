import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { join } from 'node:path'
import { appendEntries, writeTranscript } from '../support/transcripts'
import { dragTo, fakeClaude, groupRow, launch, minutesAgo, openGroup, sessionRow, setWindowSize, settle, sidebar, tempDir, triggerShortcut } from './app'

// Three sessions in two projects, as Claude Code would have written them.
const SESSIONS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', cwd: 'D:\\Work\\api', prompt: 'Add rate limiting to the API', title: 'API rate limits', updated: minutesAgo(90) },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', cwd: 'D:\\Work\\web', prompt: 'Fix the login page', title: 'Login page fix', updated: minutesAgo(180) },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', cwd: 'D:\\Home\\notes', prompt: 'Sort my notes', title: 'Notes cleanup', updated: minutesAgo(60 * 30) }
]

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

const group = (name: string) => groupRow(page, name)
const row = (title: string, where = 'smart:all') => sessionRow(page, title, where)
/** Every session row inside a group. */
const rowsIn = (where: string) => sidebar(page).locator(`[data-nav^="${where}/"]`)
const folderKey = async (name: string) => `folder:${await group(name).getAttribute('data-folder-id')}`
const center = async (l: Locator) => {
  const box = (await l.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function newFolder(name: string) {
  await sidebar(page).getByRole('button', { name: 'New folder' }).click()
  const field = page.getByRole('textbox', { name: 'Folder name' })
  await field.fill(name)
  await field.press('Enter')
  await expect(group(name)).toBeVisible()
}

test('folders nest, a dragged session stays filed after a restart, and a delete can be undone', async () => {
  const claudeDir = fakeClaude(SESSIONS)
  const userData = tempDir('gloom-e2e-')
  ;({ app, page } = await launch({ claudeDir, userData }))
  await setWindowSize(app, 1280)
  await expect(group('All Sessions')).toContainText('3')

  await newFolder('Work')
  await group('Work').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New Folder Inside' }).click()
  const field = page.getByRole('textbox', { name: 'Folder name' })
  await field.fill('Clients')
  await field.press('Enter')
  await expect(group('Clients')).toHaveAttribute('aria-level', '2')

  // A library group opens to show its sessions; one drags onto a folder.
  await openGroup(page, 'All Sessions')
  await expect(rowsIn('smart:all')).toHaveCount(3)
  await dragTo(page, await center(row('API rate limits')), await center(group('Clients')))
  await expect(group('Clients')).toContainText('1')
  await expect(group('Unfiled')).toContainText('2')

  // Restart on the same profile: the folders, the filing and what's open survive.
  await app.close()
  ;({ app, page } = await launch({ claudeDir, userData }))
  await expect(group('All Sessions')).toHaveAttribute('aria-expanded', 'true')
  await openGroup(page, 'Clients')
  const clients = await folderKey('Clients')
  await expect(rowsIn(clients)).toHaveCount(1)
  await expect(row('API rate limits', clients)).toBeVisible()
  await expect(row('API rate limits', clients)).toHaveAttribute('aria-level', '3')

  // Deleting a folder takes its subfolders; its sessions go to Unfiled, and Undo brings it all back.
  await group('Work').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete Folder' }).click()
  await expect(group('Work')).toHaveCount(0)
  await expect(group('Unfiled')).toContainText('3')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(group('Clients')).toContainText('1')
  await expect(group('Unfiled')).toContainText('2')
})

test('filing rules claim new and Unfiled sessions; sessions you placed stay put', async () => {
  const claudeDir = fakeClaude(SESSIONS)
  ;({ app, page } = await launch({ claudeDir }))
  await newFolder('Home')
  // Placed by hand, before any rule.
  await openGroup(page, 'All Sessions')
  await row('Login page fix').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move To' }).click()
  await page.getByRole('menuitem', { name: 'Home' }).click()
  await expect(group('Home')).toContainText('1')

  await newFolder('Work')
  const work = (await group('Work').getAttribute('data-folder-id'))!
  await page.evaluate((id) => window.gloom!.applyLibrary({ type: 'setFilingRules', id, paths: ['D:\\Work'] }), work)
  // The rule files the Unfiled API session; the login session you put in Home stays there.
  await expect(group('Work')).toContainText('1')
  await expect(group('Home')).toContainText('1')

  // A brand-new session under the rule files itself.
  writeTranscript(join(claudeDir, 'projects'), { id: 'aaaaaaaa-0000-4000-8000-000000000004', cwd: 'D:\\Work\\api\\.claude\\worktrees\\fox', prompt: 'Rate limit tests', title: 'Rate limit tests' })
  await expect(group('Work')).toContainText('2')
})

test('the sidebar follows Claude Code as it writes, and searches every folder', async () => {
  const claudeDir = fakeClaude(SESSIONS)
  ;({ app, page } = await launch({ claudeDir }))
  await openGroup(page, 'All Sessions')
  await expect(rowsIn('smart:all')).toHaveCount(3)
  // A session continued in the Claude app: new prompt, new activity, a live dot; it moves to the top.
  const file = join(claudeDir, 'projects', 'D--Home-notes', `${SESSIONS[2].id}.jsonl`)
  appendEntries(file, [
    { type: 'user', message: { role: 'user', content: 'Now sort them by date' }, timestamp: new Date().toISOString(), cwd: 'D:\\Home\\notes' },
    { type: 'last-prompt', lastPrompt: 'Now sort them by date', sessionId: SESSIONS[2].id }
  ])
  await expect(row('Notes cleanup')).toContainText('Now sort them by date')
  await expect(row('Notes cleanup').getByRole('img', { name: 'Running in another app' })).toBeVisible()
  await expect(rowsIn('smart:all').first()).toContainText('Notes cleanup')

  const search = page.getByRole('searchbox', { name: 'Search sessions' })
  await search.fill('login')
  await expect(rowsIn('results')).toHaveCount(1)
  await expect(sidebar(page).getByRole('heading', { name: /^Results/ })).toBeVisible()
  await search.press('Escape')
  await expect(rowsIn('smart:all')).toHaveCount(3)
})

test('the sidebar answers the keyboard', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await newFolder('Alpha')
  await newFolder('Beta')
  await group('All Sessions').focus()
  await page.keyboard.press('ArrowDown')
  await expect(group('Recent')).toBeFocused()
  await page.keyboard.press('End')
  await expect(group('Archived')).toBeFocused()
  // Type to find.
  await page.keyboard.press('b')
  await expect(group('Beta')).toBeFocused()
  await page.keyboard.press('F2')
  await expect(page.getByRole('textbox', { name: 'Folder name' })).toHaveValue('Beta')
  await page.keyboard.type('Gamma')
  await page.keyboard.press('Enter')
  await expect(group('Gamma')).toBeFocused()

  // Right opens a group, and again steps into it, selecting the session there;
  // Shift extends, Delete archives with an Undo, and the next session takes over.
  await group('All Sessions').focus()
  await page.keyboard.press('ArrowRight')
  await expect(group('All Sessions')).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(rowsIn('smart:all').first()).toHaveAttribute('aria-selected', 'true')
  await expect(rowsIn('smart:all').first()).toBeFocused()
  await page.keyboard.press('Shift+ArrowDown')
  await expect(sidebar(page).locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(2)
  await page.keyboard.press('Delete')
  await expect(rowsIn('smart:all')).toHaveCount(1)
  await expect(rowsIn('smart:all').first()).toHaveAttribute('aria-selected', 'true')
  await expect(group('All Sessions')).toContainText('1')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(rowsIn('smart:all')).toHaveCount(3)

  // Left steps out to the group, and closes it.
  await rowsIn('smart:all').nth(1).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(group('All Sessions')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(group('All Sessions')).toHaveAttribute('aria-expanded', 'false')

  // Shift+F10 opens the context menu at the row you're on, as a right-click would.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Pin' })).toBeVisible()
  const menuBox = (await menu.boundingBox())!
  const rowBox = (await rowsIn('smart:all').first().boundingBox())!
  expect(Math.abs(menuBox.y - (rowBox.y + rowBox.height / 2))).toBeLessThan(40)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('Ctrl+Z undoes library changes, newest first, and the menu says what it will undo', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await setWindowSize(app, 1280)
  await newFolder('Work')
  await openGroup(page, 'All Sessions')
  await dragTo(page, await center(row('API rate limits')), await center(group('Work')))
  await expect(group('Work')).toContainText('1')
  await row('Notes cleanup').click()
  await page.keyboard.press('Delete')
  await expect(group('All Sessions')).toContainText('2')

  await page.getByRole('button', { name: 'Menu' }).first().click()
  await expect(page.getByRole('menuitem', { name: 'Undo Archive' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Through the real menu accelerator, as the keystroke arrives.
  await triggerShortcut(app, 'CmdOrCtrl+Z')
  await expect(group('All Sessions')).toContainText('3')
  await triggerShortcut(app, 'CmdOrCtrl+Z')
  await expect(group('Work')).not.toContainText('1')
  await triggerShortcut(app, 'CmdOrCtrl+Z')
  await expect(group('Work')).toHaveCount(0)
})

test('New Folder and Search Sessions run from their shortcuts', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await triggerShortcut(app, 'CmdOrCtrl+Shift+N')
  await expect(page.getByRole('textbox', { name: 'Folder name' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(group('New Folder')).toBeFocused()
  await triggerShortcut(app, 'CmdOrCtrl+Shift+F')
  await expect(page.getByRole('searchbox', { name: 'Search sessions' })).toBeFocused()
})

test('Archived shows the archive in place of the library, and takes drops', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await setWindowSize(app, 1280)
  await openGroup(page, 'All Sessions')
  await dragTo(page, await center(row('Login page fix')), await center(group('Archived')))
  await expect(group('All Sessions')).toContainText('2')
  // As a person would: a click comes a beat after the drop (dnd kit swallows clicks for 50 ms after a drag).
  await settle(page)
  await group('Archived').click()
  await expect(group('Archived')).toHaveAttribute('aria-selected', 'true')
  await expect(rowsIn('archive')).toHaveCount(1)
  await expect(group('All Sessions')).toHaveCount(0)
  await rowsIn('archive').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Unarchive' }).click()
  await expect(sidebar(page).getByText('No Archived Sessions')).toBeVisible()
  await sidebar(page).getByRole('button', { name: 'Done' }).click()
  await expect(group('All Sessions')).toContainText('3')
})
