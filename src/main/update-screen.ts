// The update screen: Gloom's own window becomes Sync's update window (Discord's,
// before it), at the size it is. It checks for an update at launch, downloads
// and installs it with progress; the installer then starts the new version.
// Clicking Update runs the same steps, and the app is back if they fail. This
// module holds what the screen shows; index.ts hands it to the window.
import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import type { UpdateScreen } from '@shared/ipc'
import { download, findUpdate, install, offerUpdate, pendingUpdate, updatesEnabled, type Release } from './updater'

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
  const { version, size } = release
  applying = true
  try {
    let sentAt = 0
    show({ status: 'downloading', version, received: 0, total: size })
    const file = await download(release, (received) => {
      if (Date.now() - sentAt < 50 && received < size) return
      sentAt = Date.now()
      show({ status: 'downloading', version, received, total: size })
    })
    show({ status: 'installing', version })
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
  const release = await findUpdate(LAUNCH_CHECK_MS).catch((error: unknown) => {
    // Offline, or no GitHub sign-in: Gloom starts as it is.
    console.warn('[updater]', error instanceof Error ? error.message : error)
    return null
  })
  if (release) {
    offerUpdate(release)
    if (await apply(release)) return
  }
  await pause(MIN_SHOWN_MS - (Date.now() - startedAt))
  show(null)
}

/** The Update button: the window becomes the update screen, which downloads and installs. */
export async function installPending(): Promise<void> {
  const release = pendingUpdate()
  if (!release || applying) return
  if (!(await apply(release))) show(null)
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
  show({ status: 'installing', version })
  await pause(2_200)
  show(null)
}

// The end-to-end tests set what the screen shows (development builds only).
if (!app.isPackaged) Object.assign(globalThis, { gloomUpdateScreen: { show } })
