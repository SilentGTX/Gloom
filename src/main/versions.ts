// Updates install beside the running copy, the way Discord's do: each version
// unpacks into its own folder, versions\<version> in Gloom's install folder,
// so nothing that's running has to close for it. The installer's copy at the
// top starts the newest version that has run before, and Gloom's shortcuts
// are pointed at it so a launch needn't go through that copy; older versions
// are removed once a newer one has taken over. A version that never got its
// window up is never started at launch, so a broken update can't take Gloom over.
import { app, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { basename, dirname, join } from 'node:path'
// Electron's own fs opens any app.asar as an archive and keeps it open, which
// would lock a version's folder against moving and removing; this one doesn't.
import { existsSync, mkdirSync, promises, readdirSync, writeFileSync } from 'original-fs'
import { isNewer } from '@shared/version'

/** Written into a version's folder once it has shown its window. */
const STARTED = '.started'
const VERSION_DIR = /^\d+\.\d+\.\d+$/

/** Gloom's install folder: where the installer put it, which keeps updates in versions\. */
export function installRoot(exe = process.execPath): string {
  const dir = dirname(exe)
  return basename(dirname(dir)).toLowerCase() === 'versions' ? dirname(dirname(dir)) : dir
}

const versionsDir = (root: string) => join(root, 'versions')

function entries(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/** The newest version in versions\ that has run before and is newer than `than`. */
export function newestStarted(root: string, than: string, exeName: string): { version: string; exe: string } | null {
  let best: { version: string; exe: string } | null = null
  for (const name of entries(versionsDir(root))) {
    if (!VERSION_DIR.test(name) || !isNewer(name, best?.version ?? than)) continue
    const exe = join(versionsDir(root), name, exeName)
    if (existsSync(exe) && existsSync(join(versionsDir(root), name, STARTED))) best = { version: name, exe }
  }
  return best
}

/**
 * At launch: when a newer version is installed beside this copy and has run
 * before, it runs instead, with the same arguments. Call it holding the
 * single-instance lock, which it hands on.
 */
export function startNewerVersion(): boolean {
  if (!app.isPackaged) return false
  const newer = newestStarted(installRoot(), app.getVersion(), basename(process.execPath))
  if (!newer) return false
  app.releaseSingleInstanceLock()
  spawn(newer.exe, process.argv.slice(1), { cwd: dirname(newer.exe), detached: true, stdio: 'ignore' }).unref()
  app.exit(0)
  return true
}

const tarExe = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

/** Whether an update can unpack beside this copy: a packaged build, Windows' tar, and an install folder it can write to. */
export function canInstallBeside(): boolean {
  if (!app.isPackaged || !existsSync(tarExe())) return false
  try {
    mkdirSync(versionsDir(installRoot()), { recursive: true })
    return true
  } catch {
    return false
  }
}

/** The version being unpacked right now, which tidying leaves alone. */
let unpacking: string | null = null

/**
 * Unpacks a version's zip into versions\<version>, and returns its exe. It
 * unpacks in place, with no rename at the end: Windows' virus scan holds the
 * new files for a while, and a folder can't be moved meanwhile. A version cut
 * short never runs anyway (it has never shown its window).
 */
export async function unpack(zip: string, version: string): Promise<string> {
  const dest = join(versionsDir(installRoot()), version)
  const exe = join(dest, basename(process.execPath))
  unpacking = version
  try {
    await promises.rm(dest, { recursive: true, force: true, maxRetries: 10 })
    mkdirSync(dest, { recursive: true })
    await new Promise<void>((resolve, reject) =>
      execFile(tarExe(), ['-xf', zip, '-C', dest], { windowsHide: true }, (error, _stdout, stderr) =>
        error ? reject(new Error(`Couldn’t unpack the update: ${stderr.trim() || error.message}`)) : resolve()
      )
    )
    if (!existsSync(exe) || !existsSync(join(dest, 'resources', 'app.asar'))) throw new Error('The update is missing files.')
    return exe
  } catch (error) {
    void remove(dest)
    throw error
  } finally {
    unpacking = null
  }
}

/** A version is removed again when it couldn't take over. */
export function discard(exe: string): void {
  void remove(dirname(exe))
}

/**
 * This version has its window up: from now on it may be started at launch,
 * and Gloom's shortcuts start it directly.
 */
export function markStarted(): void {
  const here = dirname(process.execPath)
  if (installRoot() === here) return
  try {
    writeFileSync(join(here, STARTED), `${new Date().toISOString()}\n`)
  } catch {
    // Without the mark, the next launch runs the installer's copy, which updates again.
    return
  }
  for (const { lnk, target } of shortcuts()) {
    if (target.toLowerCase() === process.execPath.toLowerCase()) continue
    // Only where it points: the taskbar's app ID and the icon stay.
    shell.writeShortcutLink(lnk, 'update', { target: process.execPath, cwd: here })
  }
}

/** Gloom's shortcuts (Start menu, desktop, pinned to the taskbar) that start a copy in this install folder. */
function shortcuts(): { lnk: string; target: string }[] {
  const root = `${installRoot().toLowerCase()}\\`
  const places = [
    join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    app.getPath('desktop'),
    join(app.getPath('appData'), 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
  ]
  const found: { lnk: string; target: string }[] = []
  for (const dir of places) {
    for (const name of entries(dir)) {
      if (!name.toLowerCase().endsWith('.lnk')) continue
      try {
        const { target } = shell.readShortcutLink(join(dir, name))
        if (target.toLowerCase().startsWith(root)) found.push({ lnk: join(dir, name), target })
      } catch {
        // Not a shortcut Windows can read.
      }
    }
  }
  return found
}

/** Removes a folder in the background, or as much of it as isn't in use; the rest goes next time. */
async function remove(path: string): Promise<void> {
  try {
    await promises.rm(path, { recursive: true, force: true, maxRetries: 10 })
  } catch (error) {
    console.warn('[updater]', error instanceof Error ? error.message : error)
  }
}

/** Once this version has settled in: the older versions beside it and any half unpacked one go. */
export async function removeOldVersions(): Promise<void> {
  const root = installRoot()
  const running = basename(dirname(process.execPath))
  // A version a shortcut still starts stays, or the shortcut would break.
  const linked = new Set(shortcuts().map(({ target }) => basename(dirname(target)).toLowerCase()))
  for (const name of entries(versionsDir(root))) {
    if (name === running || name === unpacking || linked.has(name.toLowerCase())) continue
    // A newer version that has run is kept; anything else is leftover.
    if (VERSION_DIR.test(name) && existsSync(join(versionsDir(root), name, STARTED)) && isNewer(name, app.getVersion())) continue
    await remove(join(versionsDir(root), name))
  }
}
