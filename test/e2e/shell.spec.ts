import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { launch, pressRealKeys, sendUpdateReady, setWindowSize, triggerShortcut } from './app'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launch())
  await setWindowSize(app, 1280)
})
test.afterEach(async () => app.close())

const folders = () => page.locator('aside[aria-label="Folders"]')
const sessions = () => page.locator('section[aria-label="Sessions"]')

test('three columns, window chrome state on <html>', async () => {
  await expect(folders()).toBeVisible()
  await expect(sessions()).toBeVisible()
  await expect(page.locator('main')).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-focused', /true|false/)
  const titleBar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--titlebar-h'))
  expect(titleBar.trim()).toBe('48px')
})

test('shortcuts run through the application menu', async () => {
  await triggerShortcut(app, 'CmdOrCtrl+B')
  await expect(folders()).toHaveCount(0)
  await triggerShortcut(app, 'CmdOrCtrl+B')
  await expect(folders()).toBeVisible()

  await triggerShortcut(app, 'CmdOrCtrl+Shift+B')
  await expect(sessions()).toHaveCount(0)
  await triggerShortcut(app, 'CmdOrCtrl+Shift+B')
  await expect(sessions()).toBeVisible()

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
  await expect(folders()).toHaveCount(0)
  await pressRealKeys(app, '^+b')
  await expect(sessions()).toHaveCount(0)
})

test('narrow windows fold the folders away first, then the session list', async () => {
  await setWindowSize(app, 900)
  await expect(folders()).toHaveCount(0)
  await expect(sessions()).toBeVisible()

  // The folders come back as a sheet over the content; Escape sends it away.
  await page.getByRole('button', { name: 'Show folders' }).click()
  await expect(page.getByRole('dialog', { name: 'Folders' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Folders' })).toHaveCount(0)

  // Too narrow for the list: the folders must be gone too, even though they alone would fit.
  await setWindowSize(app, 760)
  await expect(sessions()).toHaveCount(0)
  await expect(folders()).toHaveCount(0)
  await page.getByRole('button', { name: 'Show session list' }).click()
  await expect(page.getByRole('dialog', { name: 'Sessions' })).toBeVisible()
})

test('the menu button lists every command', async () => {
  await page.getByRole('button', { name: 'Menu' }).first().click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /New Session/ })).toHaveAttribute('aria-disabled', 'true')
  // Toggles say what they will do.
  await menu.getByRole('menuitem', { name: /Hide Folders/ }).click()
  await expect(folders()).toHaveCount(0)
  await page.getByRole('button', { name: 'Menu' }).first().click()
  await expect(page.getByRole('menu').getByRole('menuitem', { name: /Show Folders/ })).toBeVisible()
})

test('the update button appears once an update is ready', async () => {
  const button = page.getByRole('button', { name: /Update to Gloom/ })
  await expect(button).toHaveCount(0)
  await sendUpdateReady(app, '0.2.1')
  await expect(button).toBeVisible()
  await expect(button).toHaveAccessibleName('Update to Gloom 0.2.1')
})

test('splitters drag 1:1 and answer the keyboard', async () => {
  const splitter = page.getByRole('separator', { name: 'Resize folders' })
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
  await expect(splitter).toHaveAttribute('aria-valuenow', '232')
})
