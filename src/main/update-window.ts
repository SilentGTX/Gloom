// The update window: Sync's splash (Discord's, before it) in Gloom's look. A
// small frameless window checks for an update at launch, downloads and installs
// it with progress, and then hands over to the main window, or to the
// installer, which starts the new version. Clicking Update runs the same steps:
// the main window closes and this one takes over.
import { app, BrowserWindow, dialog, nativeTheme, type MessageBoxOptions } from 'electron'
import { join } from 'node:path'
import { IPC, type SplashState } from '@shared/ipc'
import { download, findUpdate, install, offerUpdate, pendingUpdate, updatesEnabled, type Release } from './updater'
import type { MainWindow } from './window'

/** How long the launch check may hold up the main window. */
const LAUNCH_CHECK_MS = 6_000
/** The window stays up at least this long, so it never just flickers past. */
const MIN_SHOWN_MS = 1_000

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

export interface MainWindowHooks {
  /** Creates the main window; with `show` false it waits for `reveal()`. */
  open(show: boolean): MainWindow
  current(): BrowserWindow | null
}

let main: MainWindowHooks
let win: BrowserWindow | null = null
let openedAt = 0
let updating = false

export function updateWindow(): BrowserWindow | null {
  return win
}

function openWindow(): Promise<BrowserWindow> {
  if (win) return Promise.resolve(win)
  const w = new BrowserWindow({
    width: 300,
    height: 350, // Discord's size, like Sync's
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    show: false,
    title: 'Gloom',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16151b' : '#dfdee3',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  })
  win = w
  openedAt = Date.now()
  w.on('closed', () => {
    if (win === w) win = null
  })
  w.once('ready-to-show', () => w.show())
  w.webContents.on('will-navigate', (event) => event.preventDefault())
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const loaded = new Promise<BrowserWindow>((resolve) => {
    w.webContents.once('did-finish-load', () => resolve(w))
    w.webContents.once('did-fail-load', () => resolve(w))
  })
  const version = app.getVersion()
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}/splash.html?version=${encodeURIComponent(version)}`)
  else void w.loadFile(join(__dirname, '../renderer/splash.html'), { query: { version } })
  return loaded
}

function show(state: SplashState): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.splashState, state)
}

/** "Starting Gloom", then the main window takes over once it has painted. */
async function handOver(next: MainWindow): Promise<void> {
  show({ status: 'launching' })
  await Promise.all([next.ready, pause(MIN_SHOWN_MS - (Date.now() - openedAt))])
  next.reveal()
  win?.close()
}

/** Downloads and installs in this window. Resolves false, after saying so, if that failed. */
async function apply(release: Release): Promise<boolean> {
  const { version, size } = release
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
    // The installer waits a moment for Gloom to close; the window stays up meanwhile.
    await pause(1_200)
    app.quit()
    return true
  } catch (error) {
    console.warn('[updater]', error instanceof Error ? error.message : error)
    for (let seconds = 3; seconds > 0; seconds--) {
      show({ status: 'failed', seconds })
      await pause(1_000)
    }
    return false
  }
}

/**
 * Launch: this window checks for an update while the main window loads behind
 * it. An update installs right away; otherwise the main window takes over.
 */
export async function launch(hooks: MainWindowHooks): Promise<void> {
  main = hooks
  if (!updatesEnabled() || process.argv.includes('--no-update')) {
    hooks.open(true)
    return
  }
  await openWindow()
  show({ status: 'checking' })
  const next = hooks.open(false)
  const release = await findUpdate(LAUNCH_CHECK_MS).catch((error: unknown) => {
    // Offline, or no GitHub sign-in: Gloom starts as it is.
    console.warn('[updater]', error instanceof Error ? error.message : error)
    return null
  })
  if (!release) return handOver(next)
  offerUpdate(release)
  next.win.destroy()
  if (await apply(release)) return
  await handOver(hooks.open(false))
}

/** The Update button: the main window gives way to this one, which downloads and installs. */
export async function installPending(): Promise<void> {
  const release = pendingUpdate()
  if (!release || updating) return
  updating = true
  await openWindow()
  // Closing saves its size and place; this window keeps Gloom running.
  main.current()?.close()
  if (await apply(release)) return
  updating = false
  await handOver(main.open(false))
}

/** Help → Check for Updates…: checks now and offers to install what it finds. */
export async function checkNow(parent: BrowserWindow | null): Promise<void> {
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

/** Developer → Preview Update Window: the whole sequence with a pretend download. Installs nothing. */
export async function preview(): Promise<void> {
  if (win) return
  const w = await openWindow()
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
  show({ status: 'launching' })
  await pause(1_200)
  if (!w.isDestroyed()) w.close()
}

// The end-to-end tests open this window and set what it shows (development builds only).
if (!app.isPackaged) Object.assign(globalThis, { gloomUpdateWindow: { open: openWindow, show } })
