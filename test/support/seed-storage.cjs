// Run by Electron itself: fills a profile's localStorage under file://, the way
// Gloom 0.9 and earlier kept the window's settings, then quits.
//   electron seed-storage.cjs --user-data-dir=<profile>
// GLOOM_SEED is a JSON [key, value][]. Every file:// page shares one storage,
// so a blank page of its own will do.
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

app.whenReady().then(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gloom-seed-'))
  writeFileSync(join(dir, 'blank.html'), '<!doctype html><title>seed</title>')
  const win = new BrowserWindow({ show: false })
  await win.loadFile(join(dir, 'blank.html'))
  await win.webContents.executeJavaScript(`for (const [key, value] of ${process.env.GLOOM_SEED}) localStorage.setItem(key, value); localStorage.length`)
  win.destroy()
  rmSync(dir, { recursive: true, force: true })
  app.quit()
})
