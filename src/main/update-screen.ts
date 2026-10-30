// The update screen: Gloom's own window becomes Sync's update window (Discord's,
// before it), at the size it is. It checks for an update at launch, downloads
// it with progress and unpacks it beside the running copy, then the new
// version takes the window over (handover.ts) and the screen gives way to it.
// Where an update can't unpack beside it, the installer runs instead and
// Gloom closes and reopens. Clicking Update runs the same steps, and the app
// is back if they fail. This module holds what the screen shows; index.ts
// hands it to the window.
import { app, BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import type { UpdateScreen } from '@shared/ipc'
import { handOver } from './handover'
import { download, findUpdate, install, offerUpdate, pendingUpdate, removeDownloads, setUpdateWaiting, updatesEnabled, type Release } from './updater'
import { canInstallBeside, discard, unpack } from './versions'
import { saveWindowState } from './window'

/** How long the launch check may keep the screen up. */
const LAUNCH_CHECK_MS = 6_000
/** At launch the screen stays up at least this long, so it never just flickers past. */
const MIN_SHOWN_MS = 1_000

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

let screen: UpdateScreen | null = null
let applying = false
const listeners = new Set<(screen: UpdateScreen | null) => void>()

/** What the screen shows, or null when it's down. */
export function updateScreen(): UpdateScreen | null {
  return screen
}

export function onUpdateScreen(listener: (screen: UpdateScreen | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function show(next: UpdateScreen | null): void {
  screen = next
  for (const listener of listeners) listener(next)
}

/** Downloads and installs on the screen. Resolves false, after saying so, if that failed. */
async function apply(release: Release): Promise<boolean> {
  const { version } = release
  applying = true
  try {
    const beside = release.zip !== undefined && canInstallBeside()
    const asset = beside ? release.zip : release.installer
    if (!asset) throw new Error(`Gloom ${version} can only install beside this copy, which can't be done here.`)
    const { size } = asset
    let sentAt = 0
    show({ status: 'downloading', version, received: 0, total: size })
    const file = await download(asset, (received) => {
      if (Date.now() - sentAt < 50 && received < size) return
      sentAt = Date.now()
      show({ status: 'downloading', version, received, total: size })
    })
    show({ status: 'installing', version, reopens: !beside })
    // GLOOM_UPDATE_DRY_RUN: everything but installing, for trying a packaged build.
    if (process.env.GLOOM_UPDATE_DRY_RUN) {
      await pause(2_000)
      app.quit()
      return true
    }
    if (beside) {
      const exe = await unpack(file, version)
      removeDownloads()
      // The new version opens its window where this one is, on top of it.
      show({ status: 'starting', version })
      for (const win of BrowserWindow.getAllWindows()) saveWindowState(win)
      if (await handOver(exe)) {
        app.quit()
        return true
      }
      discard(exe)
      throw new Error(`Gloom ${version} didn’t start.`)
    }
    await pause(800)
    install(file)
    // The installer waits a moment for Gloom to close; the screen stays up meanwhile.
    await pause(1_200)
    app.quit()
    return true
  } catch (error) {
    console.warn('[updater]', error instanceof Error ? error.message : error)
    for (let seconds = 3; seconds > 0; seconds--) {
      show({ status: 'failed', seconds })
      await pause(1_000)
    }
    applying = false
    return false
  }
}

/**
 * Launch: the screen is up before the window first paints, and checks for an
 * update while the app loads behind it. An update installs right away;
 * otherwise the screen goes. Call it before creating the window, which asks
 * for the screen as it loads.
 */
export async function launchCheck(): Promise<void> {
  if (!updatesEnabled() || process.argv.includes('--no-update')) return
  const startedAt = Date.now()
  show({ status: 'checking' })
  let checked = false
  const release = await findUpdate(LAUNCH_CHECK_MS).then(
    (found) => ((checked = true), found),
    (error: unknown) => {
      // Offline, or no GitHub sign-in: Gloom starts as it is.
      console.warn('[updater]', error instanceof Error ? error.message : error)
      return null
    }
  )
  if (release) {
    offerUpdate(release)
    if (await apply(release)) return
  } else if (checked) {
    // Up to date: whatever was downloaded before is installed.
    removeDownloads()
  }
  await pause(MIN_SHOWN_MS - (Date.now() - startedAt))
  show(null)
}

/** Taking over from the previous version (handover.ts): the screen says this one is starting. */
export function showStarting(): void {
  show({ status: 'starting', version: app.getVersion() })
}

/** The app is drawn under the screen. After a moment, so the swap of windows has settled, the screen goes. */
export function finishStarting(): void {
  if (screen?.status === 'starting') setTimeout(() => screen?.status === 'starting' && show(null), 400)
}

/** Whether a session is mid-turn or waiting for you: an update waits for it, as the Claude app's do. */
let sessionsBusy: () => boolean = () => false
let deferred = false

export function deferUpdatesWhile(busy: () => boolean): void {
  sessionsBusy = busy
}

/**
 * The Update button: the window becomes the update screen, which downloads and
 * installs. While Claude is working it waits, and goes once no session is
 * (the open session and the window come back after; stopped sessions resume on
 * their next message).
 */
export async function installPending(): Promise<void> {
  const release = pendingUpdate()
  if (!release || applying) return
  if (sessionsBusy()) {
    deferred = true
    setUpdateWaiting(true)
    return
  }
  deferred = false
  setUpdateWaiting(false)
  if (!(await apply(release))) show(null)
}

/** No session is mid-turn: a waiting update goes now. */
export function sessionsQuiet(): void {
  if (deferred) void installPending()
}

/** Help → Check for Updates…: checks now and offers to install what it finds. */
export async function checkNow(parent: BrowserWindow | null): Promise<void> {
  if (screen) return
  const ask = (options: MessageBoxOptions) => (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
  let release: Release | null
  try {
    release = await findUpdate(20_000)
  } catch (error) {
    await ask({ type: 'error', message: 'Couldn’t check for updates.', detail: error instanceof Error ? error.message : String(error) })
    return
  }
  if (!release) {
    await ask({ type: 'info', message: 'Gloom is up to date.', detail: `You have version ${app.getVersion()}.` })
    return
  }
  offerUpdate(release)
  const { response } = await ask({
    type: 'info',
    message: `Gloom ${release.version} is available.`,
    detail: `You have version ${app.getVersion()}. Gloom restarts to install it.`,
    buttons: ['Update Now', 'Later'],
    defaultId: 0,
    cancelId: 1
  })
  if (response === 0) await installPending()
}

/** Developer → Preview Update Screen: the whole sequence with a pretend download. Installs nothing. */
export async function preview(): Promise<void> {
  if (screen) return
  const [major, minor, patch] = app.getVersion().split('.').map(Number)
  const version = `${major}.${minor}.${patch + 1}`
  const total = 115_000_000
  show({ status: 'checking' })
  await pause(1_800)
  for (let step = 0; step <= 60; step++) {
    show({ status: 'downloading', version, received: Math.round((total * step) / 60), total })
    await pause(50)
  }
  show({ status: 'installing', version, reopens: false })
  await pause(2_200)
  show({ status: 'starting', version })
  await pause(1_200)
  show(null)
}

// The end-to-end tests set what the screen shows (development builds only).
if (!app.isPackaged) Object.assign(globalThis, { gloomUpdateScreen: { show } })
