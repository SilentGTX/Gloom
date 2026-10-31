// The page's own scheme (protocol.ts) gave it a new origin, and with it a new,
// empty localStorage. What the page keeps there (the window's settings: the
// sidebar's width, the sort, the open groups, the text size; when Gloom last
// ran each session; the version it last ran) was under file://. The first
// version on app://gloom copies it across, once, before the app reads any of
// it: main reads the old entries from a page under file:// that nothing shows,
// and the window writes the ones it lacks (lib/storage.ts). The old entries
// stay, so an older version still finds its own.
import { app, WebContentsView } from 'electron'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Written into userData once the entries have moved, or there was nothing to move. */
const MOVED = 'storage-moved'

let taken = false

/** The page's entries under file://, the first time this profile asks; after that, or with nothing to move, null. */
export async function storageToMove(): Promise<[string, string][] | null> {
  // The development server's page has its own origin, and nothing to take.
  if (taken || process.env.ELECTRON_RENDERER_URL) return null
  taken = true
  const userData = app.getPath('userData')
  const mark = join(userData, MOVED)
  if (existsSync(mark)) return null
  let entries: [string, string][] | null = null
  // A profile Gloom has never closed a window in (window.ts saves its place) has
  // nothing to move. Chromium makes its Local Storage folder for any page at all.
  if (existsSync(join(userData, 'window-state.json'))) {
    try {
      entries = await readFileOrigin()
    } catch (error) {
      console.warn('[storage]', error instanceof Error ? error.message : error)
    }
  }
  try {
    writeFileSync(mark, `${new Date().toISOString()}\n`)
  } catch {
    // Without the mark the next start reads them again, which is harmless.
  }
  return entries
}

/**
 * Every entry of file://'s localStorage, read by a blank page there (every
 * file:// page shares that storage). Without the GrantFileProtocolExtraPrivileges
 * fuse's privileges, file:// can't load from inside app.asar, so the page is
 * written to a folder of its own; and a file:// page is an opaque origin with no
 * storage at all, unless web security is off. That's safe for this one page:
 * it's Gloom's own, holds nothing, and runs nothing but the line that reads.
 */
async function readFileOrigin(): Promise<[string, string][]> {
  const dir = mkdtempSync(join(tmpdir(), 'gloom-storage-'))
  const page = join(dir, 'blank.html')
  writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>Gloom</title>')
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: false } })
  try {
    await view.webContents.loadFile(page)
    const raw: unknown = JSON.parse(await view.webContents.executeJavaScript('JSON.stringify(Object.entries(localStorage))'))
    return Array.isArray(raw) ? raw.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string') : []
  } finally {
    view.webContents.close()
    rmSync(dir, { recursive: true, force: true })
  }
}
