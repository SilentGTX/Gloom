import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { captureWindow, launch, sendUpdateReady, setWindowSize } from './app'

// Captures of the window as Windows draws it (caption buttons, border), in
// light and dark, with glass as this PC's settings give it and with glass on:
// Windows' "Transparency effects: off" reaches the page as reduced transparency.
// Output: test-screens/ (Playwright empties test-results/ on every run).
const dir = join(__dirname, '..', '..', 'test-screens')
// Each capture starts PowerShell and compiles a small C# helper: seconds apiece.
test.setTimeout(120_000)

async function allowTransparency(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }] })
}

for (const theme of ['light', 'dark'] as const) {
  for (const glass of ['system', 'on'] as const) {
    test(`window captures, ${theme}, glass ${glass}`, async () => {
      mkdirSync(dir, { recursive: true })
      const { app, page } = await launch()
      await setWindowSize(app, 1280, 800)
      await app.evaluate(({ nativeTheme }, t) => (nativeTheme.themeSource = t), theme)
      if (glass === 'on') await allowTransparency(page)
      await page.waitForTimeout(500)
      const name = `${theme}-glass-${glass}`
      await captureWindow(app, join(dir, `shell-${name}.png`))

      // The update button once it has settled after lighting up.
      await sendUpdateReady(app, '0.2.1')
      await page.waitForTimeout(2000)
      await captureWindow(app, join(dir, `update-${name}.png`))

      await page.getByRole('button', { name: 'Menu' }).first().click()
      await page.getByRole('menu').waitFor()
      await page.waitForTimeout(250)
      await captureWindow(app, join(dir, `menu-${name}.png`))
      await page.getByRole('menu').press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)

      await setWindowSize(app, 760, 640)
      await page.getByRole('button', { name: 'Show folders' }).click()
      await page.waitForTimeout(450)
      await captureWindow(app, join(dir, `narrow-sheet-${name}.png`))
      await app.close()
    })
  }
}
