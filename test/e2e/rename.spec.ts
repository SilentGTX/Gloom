import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { fakeClaude, groupRow, launch, minutesAgo, openGroup, sessionRow } from './app'

const SESSIONS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', cwd: 'D:\\Work\\api', prompt: 'Add rate limiting to the API', title: 'API rate limits', updated: minutesAgo(90) },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', cwd: 'D:\\Work\\web', prompt: 'Fix the login page', title: 'Login page fix', updated: minutesAgo(180) }
]

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

const row = (title: string) => sessionRow(page, title, 'smart:all')

test('a session renames from its context menu, and Enter keeps the name', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await openGroup(page, 'All Sessions')
  await row('Login page fix').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const field = page.getByRole('textbox', { name: 'Session name' })
  await expect(field).toBeVisible()
  await field.fill('Login hotfix')
  await field.press('Enter')
  await expect(field).toBeHidden()
  await expect(row('Login hotfix')).toBeVisible()
})

test('F2 renames the row you are on, and Escape keeps the old name', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await openGroup(page, 'All Sessions')
  await row('API rate limits').click()
  await page.keyboard.press('F2')
  const field = page.getByRole('textbox', { name: 'Session name' })
  await expect(field).toBeVisible()
  await field.fill('Nope')
  await field.press('Escape')
  await expect(field).toBeHidden()
  await expect(row('API rate limits')).toBeVisible()
})

test('a folder renames from its context menu', async () => {
  ;({ app, page } = await launch({ claudeDir: fakeClaude(SESSIONS) }))
  await page.evaluate(() => window.gloom!.applyLibrary({ type: 'createFolder', parentId: null, name: 'Work' }))
  await groupRow(page, 'Work').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const field = page.getByRole('textbox', { name: 'Folder name' })
  await expect(field).toBeVisible()
  await field.fill('Client')
  await field.press('Enter')
  await expect(field).toBeHidden()
  await expect(groupRow(page, 'Client')).toBeVisible()
})
