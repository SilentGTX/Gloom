// A window's first frame, as Electron shows it: the pet's window is clear from it,
// and the main window opens in your look before it can read its own settings (an update).
import { expect, test } from '@playwright/test'
import { launch } from './app'

test('the pet’s window is clear from its first frame', async () => {
  const { app, page } = await launch()
  try {
    const url = page.url().split('?')[0]
    // As main/pet.ts opens it: a clear window, shown on its first frame; that frame is read here.
    const alpha = await app.evaluate(async ({ BrowserWindow }, page) => {
      const win = new BrowserWindow({ width: 200, height: 200, show: false, transparent: true, backgroundColor: '#00000000', frame: false })
      const shown = new Promise<void>((resolve) => win.once('ready-to-show', () => resolve()))
      void win.loadURL(`${page}?pet`)
      await shown
      const frame = await win.webContents.capturePage()
      const bitmap = frame.toBitmap()
      win.destroy()
      // The corner, far from the pet: nothing of the page's paper.
      return bitmap[3]
    }, url)
    expect(alpha).toBe(0)
  } finally {
    await app.close()
  }
})

test('the main window opens in your look, kept where the next window can read it', async () => {
  const { app, page } = await launch({ design: 'classic' })
  try {
    await expect.poll(() => page.evaluate(async () => (await window.gloom!.getSettings()).design)).toBe('classic')
    await page.evaluate(() => window.gloom!.runCommand('view.designConcept'))
    await expect.poll(() => page.evaluate(async () => (await window.gloom!.getSettings()).design)).toBe('concept')
    // A window opened now (as an update's is) carries it in its address and has it before anything paints.
    const first = await app.evaluate(async ({ BrowserWindow }, page) => {
      const win = new BrowserWindow({ width: 400, height: 300, show: false })
      await win.loadURL(`${page}?design=concept&popout=none`)
      const design = await win.webContents.executeJavaScript('document.documentElement.dataset.design')
      win.destroy()
      return design
    }, page.url().split('?')[0])
    expect(first).toBe('concept')
  } finally {
    await app.close()
  }
})
