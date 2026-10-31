import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, pressRealKeys, sendUpdateReady, setWindowSize, sidebar as sidebarOf, triggerShortcut } from './app'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launch())
  await setWindowSize(app, 1280)
})
test.afterEach(async () => app.close())

const sidebar = () => sidebarOf(page)

test('two columns, window chrome state on <html>', async () => {
  await expect(sidebar()).toBeVisible()
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('section[aria-label="Sessions"]')).toHaveCount(0)
  await expect(page.locator('html')).toHaveAttribute('data-focused', /true|false/)
  const titleBar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h'))
  expect(titleBar.trim()).toBe('48px')
})

test('shortcuts run through the application menu', async () => {
  await triggerShortcut(app, 'CmdOrCtrl+B')
  await expect(sidebar()).toHaveCount(0)
  await triggerShortcut(app, 'CmdOrCtrl+B')
  await expect(sidebar()).toBeVisible()

  const textScale = () => page.evaluate(() => document.documentElement.style.getPropertyValue('--text-scale'))
  await triggerShortcut(app, 'CmdOrCtrl+=')
  await expect.poll(textScale).toBe('1.0625')
  await triggerShortcut(app, 'CmdOrCtrl+0')
  await expect.poll(textScale).toBe('1')
})

// Opt-in (GLOOM_E2E_REAL_KEYS=1): it takes the foreground, and Windows only
// delivers real keys to the foreground window.
test('real keystrokes reach the hidden menu', async () => {
  test.skip(!process.env.GLOOM_E2E_REAL_KEYS, 'set GLOOM_E2E_REAL_KEYS=1 to send real keystrokes')
  await pressRealKeys(app, '^b')
  await expect(sidebar()).toHaveCount(0)
})

test('the chat toolbar’s sidebar button hides and shows it; a narrow window folds it into a sheet', async () => {
  await page.getByRole('button', { name: 'Hide sidebar' }).click()
  await expect(sidebar()).toHaveCount(0)
  // With the sidebar away, its menu rides at the toolbar's leading edge.
  await expect(page.locator('main').getByRole('button', { name: 'Menu' })).toBeVisible()
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(sidebar()).toBeVisible()

  await setWindowSize(app, 700)
  await expect(sidebar()).toHaveCount(0)
  // It comes back as a sheet over the chat; Escape sends it away.
  await page.getByRole('button', { name: 'Show sidebar' }).click()
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Sidebar' })).toHaveCount(0)
})

test('the menu button lists every command', async () => {
  await page.getByRole('button', { name: 'Menu' }).first().click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /New Session/ })).not.toHaveAttribute('aria-disabled', 'true')
  // What a later phase builds is listed, but can't be chosen yet.
  await expect(menu.getByRole('menuitem', { name: /Diff Pane/ })).toHaveAttribute('aria-disabled', 'true')
  await expect(menu.getByRole('menuitem', { name: /Sort Sessions By/ })).toBeVisible()
  // Toggles say what they will do.
  await menu.getByRole('menuitem', { name: /Hide Sidebar/ }).click()
  await expect(sidebar()).toHaveCount(0)
  await page.getByRole('button', { name: 'Menu' }).first().click()
  await expect(page.getByRole('menu').getByRole('menuitem', { name: /Show Sidebar/ })).toBeVisible()
})

test('the update button appears once an update is ready', async () => {
  const button = page.getByRole('button', { name: /Update to Gloom/ })
  await expect(button).toHaveCount(0)
  await sendUpdateReady(app, '0.2.1')
  await expect(button).toBeVisible()
  await expect(button).toHaveAccessibleName('Update to Gloom 0.2.1')
})

test('the splitter drags 1:1 and answers the keyboard', async () => {
  const splitter = page.getByRole('separator', { name: 'Resize sidebar' })
  const before = Number(await splitter.getAttribute('aria-valuenow'))
  const box = (await splitter.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 300)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + 300, { steps: 5 })
  await page.mouse.up()
  await expect(splitter).toHaveAttribute('aria-valuenow', String(before + 40))

  await splitter.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(splitter).toHaveAttribute('aria-valuenow', String(before + 32))
  await page.keyboard.press('Enter')
  await expect(splitter).toHaveAttribute('aria-valuenow', '288')
})
