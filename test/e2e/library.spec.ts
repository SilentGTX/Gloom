import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { join } from 'node:path'
import { appendEntries, writeTranscript } from '../support/transcripts'
import { dragTo, fakeClaude, launch, minutesAgo, setWindowSize, tempDir, triggerShortcut } from './app'

// Three sessions in two projects, as Claude Code would have written them.
const SESSIONS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', cwd: 'D:\\Work\\api', prompt: 'Add rate limiting to the API', title: 'API rate limits', updated: minutesAgo(90) },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', cwd: 'D:\\Work\\web', prompt: 'Fix the login page', title: 'Login page fix', updated: minutesAgo(180) },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', cwd: 'D:\\Home\\notes', prompt: 'Sort my notes', title: 'Notes cleanup', updated: minutesAgo(60 * 30) }
]

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

const tree = () => page.locator('aside[aria-label="Folders"]')
const folder = (name: string) => tree().getByRole('treeitem', { name: new RegExp(`^${name}`) })
const row = (title: string) => page.getByRole('option', { name: new RegExp(title) })
const center = async (l: Locator) => {
  const box = (await l.boundingBox())!
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function newFolder(name: string) {
  await tree().getByRole('button', { name: 'New folder' }).click()
  const field = page.getByRole('textbox', { name: 'Folder name' })
  await field.fill(name)
  await field.press('Enter')
  await expect(folder(name)).toBeVisible()
}

test('folders nest, a dragged session stays filed after a restart, and a delete can be undone', async () => {
  const claudeDir = fakeClaude(SESSIONS)
  const userData = tempDir('gloom-e2e-')
  ;({ app, page } = await launch({ claudeDir, userData }))
  await setWindowSize(app, 1280)
  await expect(page.getByRole('option')).toHaveCount(3)
  await expect(folder('All Sessions')).toContainText('3')

  await newFolder('Work')
  await folder('Work').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'New Folder Inside' }).click()
  const field = page.getByRole('textbox', { name: 'Folder name' })
  await field.fill('Clients')
  await field.press('Enter')
  await expect(folder('Clients')).toHaveAttribute('aria-level', '2')

  await folder('All Sessions').click()
  await dragTo(page, await center(row('API rate limits')), await center(folder('Clients')))
  await expect(folder('Clients')).toContainText('1')
  await expect(folder('Unfiled')).toContainText('2')

  // Restart on the same profile: the folders and the filing survive.
  await app.close()
  ;({ app, page } = await launch({ claudeDir, userData }))
  await folder('Clients').click()
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(row('API rate limits')).toBeVisible()

  // Deleting a folder takes its subfolders; its sessions go to Unfiled, and Undo brings it all back.
  await folder('Work').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete Folder' }).click()
  await expect(folder('Work')).toHaveCount(0)
  await expect(folder('Unfiled')).toContainText('3')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(folder('Clients')).toContainText('1')
  await expect(folder('Unfiled')).toContainText('2')
})

test('filing rules claim new and Unfiled sessions; sessions you placed stay put', async () => {
  const claudeDir = fakeClaude(SESSIONS)
  ;({ app, page } = await launch({ claudeDir }))
  await newFolder('Home')
  // Placed by hand, before any rule.
  await folder('All Sessions').click()
  await row('Login page fix').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Move To' }).click()
  await page.getByRole('menuitem', { name: 'Home' }).click()
  await expect(folder('Home')).toContainText('1')

  await newFolder('Work')
  const work = (await folder('Work').getAttribute('data-folder-id'))!
  await page.evaluate((id) => window.gloom!.applyLibrary({ type: 'setFilingRules', id, paths: ['D:\\Work'] }), work)
  // The rule files the Unfiled API session; the login session you put in Home stays there.
  await expect(folder('Work')).toContainText('1')
  await expect(folder('Home')).toContainText('1')

  // A brand-new session under the rule files itself.
  writeTranscript(join(claudeDir, 'projects'), { id: 'aaaaaaaa-0000-4000-8000-000000000004', cwd: 'D:\\Work\\api\\.claude\\worktrees\\fox', prompt: 'Rate limit tests', title: 'Rate limit tests' })
  await expect(folder('Work')).toContainText('2')
})

test('the list follows Claude Code as it writes, and searches every folder', async () => {
  const claudeDir = fakeClaude(SESSIONS)
  ;({ app, page } = await launch({ claudeDir }))
  await expect(page.getByRole('option')).toHaveCount(3)
  // A session continued in the Claude app: new prompt, new activity, a live dot; it moves to the top.
  const file = join(claudeDir, 'projects', 'D--Home-notes', `${SESSIONS[2].id}.jsonl`)
  appendEntries(file, [
    { type: 'user', message: { role: 'user', content: 'Now sort them by date' }, timestamp: new Date().toISOString(), cwd: 'D:\\Home\\notes' },
    { type: 'last-prompt', lastPrompt: 'Now sort them by date', sessionId: SESSIONS[2].id }
  ])
  await expect(row('Notes cleanup')).toContainText('Now sort them by date')
  await expect(row('Notes cleanup').getByRole('img', { name: 'Running in another app' })).toBeVisible()
  await expect(page.getByRole('option').first()).toContainText('Notes cleanup')

  const search = page.getByRole('searchbox', { name: 'Search sessions' })
  await search.fill('login')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible()
  await search.press('Escape')
  await expect(page.getByRole('option')).toHaveCount(3)
})

test('the sidebar and the list answer the keyboard', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await newFolder('Alpha')
  await newFolder('Beta')
  await folder('All Sessions').click()
  await folder('All Sessions').press('ArrowDown')
  await expect(folder('Recent')).toHaveAttribute('aria-selected', 'true')
  await expect(folder('Recent')).toBeFocused()
  await page.keyboard.press('End')
  await expect(folder('Archived')).toHaveAttribute('aria-selected', 'true')
  // Type to find.
  await page.keyboard.press('b')
  await expect(folder('Beta')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('F2')
  await expect(page.getByRole('textbox', { name: 'Folder name' })).toHaveValue('Beta')
  await page.keyboard.type('Gamma')
  await page.keyboard.press('Enter')
  await expect(folder('Gamma')).toBeFocused()

  // Into the list: arrows select, Shift extends, Delete archives with an Undo.
  await folder('All Sessions').click()
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(page.locator('[role="option"][aria-selected="true"]')).toHaveCount(2)
  await page.keyboard.press('Delete')
  await expect(page.getByRole('option')).toHaveCount(1)
  await expect(folder('Archived')).toContainText('2')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('option')).toHaveCount(3)

  // Shift+F10 opens the selection's context menu at its row, as a right-click would.
  await page.locator('[data-session-list]').focus()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Pin' })).toBeVisible()
  const menuBox = (await menu.boundingBox())!
  const rowBox = (await page.locator('[role="option"][aria-selected="true"]').boundingBox())!
  expect(Math.abs(menuBox.y - (rowBox.y + rowBox.height / 2))).toBeLessThan(40)
  await page.keyboard.press('Escape')
})

test('Ctrl+Z undoes library changes, newest first, and the menu says what it will undo', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await setWindowSize(app, 1280)
  await newFolder('Work')
  await folder('All Sessions').click()
  await dragTo(page, await center(row('API rate limits')), await center(folder('Work')))
  await expect(folder('Work')).toContainText('1')
  await row('Notes cleanup').click()
  await page.keyboard.press('Delete')
  await expect(folder('Archived')).toContainText('1')

  await page.getByRole('button', { name: 'Menu' }).first().click()
  await expect(page.getByRole('menuitem', { name: 'Undo Archive' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Through the real menu accelerator, as the keystroke arrives.
  await triggerShortcut(app, 'CmdOrCtrl+Z')
  await expect(folder('Archived')).not.toContainText('1')
  await triggerShortcut(app, 'CmdOrCtrl+Z')
  await expect(folder('Work')).not.toContainText('1')
  await triggerShortcut(app, 'CmdOrCtrl+Z')
  await expect(folder('Work')).toHaveCount(0)
})

test('New Folder and Search Sessions run from their shortcuts', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const items = Menu.getApplicationMenu()!.items.flatMap((m) => m.submenu?.items ?? [])
    items.find((i) => i.accelerator === 'CmdOrCtrl+Shift+N')!.click({ triggeredByAccelerator: true } as Electron.KeyboardEvent, win, win.webContents)
  })
  await expect(page.getByRole('textbox', { name: 'Folder name' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(folder('New Folder')).toHaveAttribute('aria-selected', 'true')
  await app.evaluate(({ BrowserWindow, Menu }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const items = Menu.getApplicationMenu()!.items.flatMap((m) => m.submenu?.items ?? [])
    items.find((i) => i.accelerator === 'CmdOrCtrl+Shift+F')!.click({ triggeredByAccelerator: true } as Electron.KeyboardEvent, win, win.webContents)
  })
  await expect(page.getByRole('searchbox', { name: 'Search sessions' })).toBeFocused()
})
