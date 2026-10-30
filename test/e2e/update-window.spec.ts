import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { SplashState } from '../../src/shared/ipc'
import { captureWindow, launch, openUpdateWindow, showInUpdateWindow } from './app'

// The update window, driven through each step it shows. Development builds
// never check for updates, so the test sets the steps itself.
const dir = join(__dirname, '..', '..', 'test-screens')
test.setTimeout(120_000)

const STEPS: [name: string, state: SplashState, status: string, detail: string][] = [
  ['checking', { status: 'checking' }, 'Checking for updates…', ''],
  ['downloading', { status: 'downloading', version: '0.3.1', received: 48_000_000, total: 115_000_000 }, 'Downloading Gloom 0.3.1…', '48 MB of 115 MB'],
  ['installing', { status: 'installing', version: '0.3.1' }, 'Installing Gloom 0.3.1…', 'Gloom reopens when it’s done'],
  ['failed', { status: 'failed', seconds: 3 }, 'Couldn’t update Gloom', 'Starting Gloom in 3…'],
  ['launching', { status: 'launching' }, 'Starting Gloom…', '']
]

test('the update window says what it is doing', async () => {
  const { app } = await launch()
  const page = await openUpdateWindow(app)
  await expect(page.getByRole('heading', { name: 'Gloom' })).toBeVisible()
  for (const [, state, status, detail] of STEPS) {
    await showInUpdateWindow(app, state)
    await expect(page.getByRole('status')).toHaveText(status)
    await expect(page.locator('#detail')).toHaveText(detail)
  }
  await app.close()
})

for (const theme of ['light', 'dark'] as const) {
  test(`update window captures, ${theme}`, async () => {
    mkdirSync(dir, { recursive: true })
    const { app } = await launch()
    await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
    const page = await openUpdateWindow(app)
    for (const [name, state] of STEPS.slice(0, 3)) {
      await showInUpdateWindow(app, state)
      await page.waitForTimeout(900)
      await captureWindow(app, join(dir, `update-window-${name}-${theme}.png`), 'update')
    }
    await app.close()
  })
}
