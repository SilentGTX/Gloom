import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, tempDir, triggerShortcut } from './app'

// Gloom's page moved from file:// to its own app://gloom (Phase 8), a new origin
// with an empty localStorage. What the page kept under file:// comes across
// once, and never over an entry the page already has.
const root = join(__dirname, '..', '..')
const textScale = (page: import('@playwright/test').Page) => page.evaluate(() => document.documentElement.style.getPropertyValue('--text-scale'))

test('the settings kept under file:// come across to app://gloom, once', async () => {
  const userData = tempDir('gloom-e2e-')
  const ui = { state: { sidebarWidth: 340, sidebarHidden: false, textScale: 1.125, glassAlways: false, sort: 'name', openSmart: [], selection: [] }, version: 4 }
  // Electron's path, when asked from Node.
  const electron = require('electron') as unknown as string
  execFileSync(electron, [join(root, 'test', 'support', 'seed-storage.cjs'), `--user-data-dir=${userData}`], {
    env: { ...process.env, GLOOM_SEED: JSON.stringify([['gloom.ui', JSON.stringify(ui)], ['gloom.lastVersion', '0.9.0']]) },
    timeout: 30_000
  })
  // And the window's place, which every Gloom saves as it closes: the sign a profile has something to move.
  writeFileSync(join(userData, 'window-state.json'), JSON.stringify({ width: 1280, height: 820, maximized: false }))

  let { app, page } = await launch({ userData })
  expect(page.url()).toBe('app://gloom/index.html')
  await expect.poll(() => textScale(page)).toBe('1.125')
  expect(await page.locator('aside[aria-label="Sidebar"]').evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(340)
  // The version it last ran came too, so the update note still knows what's new.
  expect(await page.evaluate(() => localStorage.getItem('gloom.lastVersion'))).not.toBeNull()
  expect(existsSync(join(userData, 'storage-moved'))).toBe(true)

  // A setting changed since stays changed, even if the move ran again.
  await triggerShortcut(app, 'CmdOrCtrl+0')
  await expect.poll(() => textScale(page)).toBe('1')
  await app.close()
  rmSync(join(userData, 'storage-moved'))
  ;({ app, page } = await launch({ userData }))
  await expect.poll(() => textScale(page)).toBe('1')
  await app.close()
})
