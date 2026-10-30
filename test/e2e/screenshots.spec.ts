import { expect, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { captureWindow, launch, setWindowSize } from './app'

// Light and dark captures of the window as Windows draws it (caption buttons,
// Mica, border), plus the menu and a narrow window's folder sheet.
// Output: test-screens/ (Playwright empties test-results/ on every run).
const dir = join(__dirname, '..', '..', 'test-screens')
// Each capture starts PowerShell and compiles a small C# helper: seconds apiece.
test.setTimeout(120_000)

for (const theme of ['light', 'dark'] as const) {
  test(`window captures, ${theme}`, async () => {
    mkdirSync(dir, { recursive: true })
    const { app, page } = await launch()
    await setWindowSize(app, 1280, 800)
    await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
    await page.waitForTimeout(500)
    await captureWindow(app, join(dir, `shell-${theme}.png`))

    await page.getByRole('button', { name: 'Menu' }).first().click()
    await page.getByRole('menu').waitFor()
    await page.waitForTimeout(250)
    await captureWindow(app, join(dir, `menu-${theme}.png`))
    await page.getByRole('menu').press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)

    await setWindowSize(app, 760, 640)
    await page.getByRole('button', { name: 'Show folders' }).click()
    await page.waitForTimeout(450)
    await captureWindow(app, join(dir, `narrow-sheet-${theme}.png`))
    await app.close()
  })
}
