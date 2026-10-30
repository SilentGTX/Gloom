import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateScreen } from '../../src/shared/ipc'
import { captureWindow, launch, showUpdateScreen } from './app'

// The update screen, driven through each step it shows. Development builds
// never check for updates, so the test sets the steps itself.
const dir = join(__dirname, '..', '..', 'test-screens')
test.setTimeout(120_000)

const STEPS: [name: string, screen: UpdateScreen, status: string, detail: string][] = [
  ['checking', { status: 'checking' }, 'Checking for updates…', ''],
  ['downloading', { status: 'downloading', version: '0.5.1', received: 48_000_000, total: 115_000_000 }, 'Downloading Gloom 0.5.1…', '48 MB of 115 MB'],
  ['installing', { status: 'installing', version: '0.5.1' }, 'Installing Gloom 0.5.1…', 'Gloom reopens when it’s done'],
  ['failed', { status: 'failed', seconds: 3 }, 'Couldn’t update Gloom', 'Back to Gloom in 3…']
]

const behindIsInert = () => document.querySelector('main')?.closest('[inert]') != null

test('the window becomes the update screen and says what it is doing', async () => {
  const { app, page } = await launch()
  const card = page.getByRole('dialog', { name: 'Gloom' })
  const menu = page.getByRole('button', { name: 'Menu' }).first()
  await menu.focus()

  await showUpdateScreen(app, { status: 'checking' })
  await expect(card).toBeVisible()
  await expect(card).toBeFocused()
  expect(await page.evaluate(behindIsInert)).toBe(true)

  for (const [, screen, status, detail] of STEPS) {
    await showUpdateScreen(app, screen)
    await expect(card.getByRole('status')).toHaveText(status)
    await expect(card.locator('.update-detail')).toHaveText(detail)
  }
  await showUpdateScreen(app, STEPS[1][1])
  await expect(card.getByRole('progressbar', { name: 'Download' })).toHaveAttribute('aria-valuenow', '42')

  // It goes, and the app is back where it was.
  await showUpdateScreen(app, null)
  await expect(card).toHaveCount(0)
  expect(await page.evaluate(behindIsInert)).toBe(false)
  await expect(menu).toBeFocused()
  await app.close()
})

for (const theme of ['light', 'dark'] as const) {
  test(`update screen captures, ${theme}`, async () => {
    mkdirSync(dir, { recursive: true })
    const { app, page } = await launch()
    await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
    for (const [name, screen] of STEPS.slice(0, 3)) {
      await showUpdateScreen(app, screen)
      await page.waitForTimeout(900)
      await captureWindow(app, join(dir, `update-screen-${name}-${theme}.png`))
    }
    await app.close()
  })
}
