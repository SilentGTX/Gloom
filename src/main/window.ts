// The main window: hidden title bar with the real caption buttons drawn over the
// page (titleBarOverlay), and the theme, accent and focus state the renderer
// styles itself from. The page paints everything itself (paper, and the dusk sky
// in the sidebar's column), which would hide Mica, so the window just starts in
// the paper's colour.
import { app, BrowserWindow, nativeTheme, screen, shell, systemPreferences } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC, type WindowState } from '@shared/ipc'

export const TITLE_BAR_HEIGHT = 48
const DEFAULT_SIZE = { width: 1280, height: 820 }
/** Gloom's own accent for when Windows doesn't report one: a dusk indigo. */
const FALLBACK_ACCENT = '#5b5bd6'

interface SavedBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

const boundsFile = () => join(app.getPath('userData'), 'window-state.json')

function loadBounds(): SavedBounds {
  try {
    if (existsSync(boundsFile())) {
      const saved = JSON.parse(readFileSync(boundsFile(), 'utf8')) as SavedBounds
      // Only reuse a position that is still on a connected display.
      const onScreen =
        saved.x !== undefined &&
        saved.y !== undefined &&
        screen.getAllDisplays().some(({ workArea: a }) => saved.x! < a.x + a.width - 100 && saved.x! + saved.width > a.x + 100 && saved.y! >= a.y - 8 && saved.y! < a.y + a.height - 100)
      return onScreen ? saved : { width: saved.width, height: saved.height, maximized: saved.maximized }
    }
  } catch {
    // A corrupt file just means default bounds.
  }
  return { ...DEFAULT_SIZE, maximized: false }
}

/** Saves the window's size and place, which the next window opens with. */
export function saveWindowState(win: BrowserWindow): void {
  if (!win.isDestroyed()) saveBounds(win)
}

function saveBounds(win: BrowserWindow) {
  const bounds = win.getNormalBounds()
  const saved: SavedBounds = { ...bounds, maximized: win.isMaximized() }
  try {
    writeFileSync(boundsFile(), JSON.stringify(saved))
  } catch {
    // Not worth failing a quit over.
  }
}

function accentColor(): string {
  try {
    const rgba = systemPreferences.getAccentColor() // "rrggbbaa"
    if (/^[0-9a-f]{6}/i.test(rgba)) return `#${rgba.slice(0, 6)}`
  } catch {
    // Not available on this system.
  }
  return FALLBACK_ACCENT
}

/** The paper's colour, shown before the page paints. Matches --surface. */
function paperColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#16151b' : '#dfdee3'
}

function overlayColors() {
  // Transparent, so the paper shows under the caption buttons.
  return {
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1f1f1f',
    height: TITLE_BAR_HEIGHT
  }
}

export function windowState(win: BrowserWindow): WindowState {
  return {
    focused: win.isFocused(),
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen(),
    dark: nativeTheme.shouldUseDarkColors,
    accent: accentColor(),
    titleBarHeight: TITLE_BAR_HEIGHT
  }
}

/** The renderer's own URL, which IPC senders and navigations must match. */
export function rendererUrl(): string {
  return process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
}

/** How long Windows takes to zoom a new window in. */
const OPENING_MS = 350
/** A frame or so for the screen to show the window once it's opaque. */
const COMPOSITED_MS = 50

/**
 * The main window. It shows once its page has painted, maximized if it was
 * when it last closed. With `handover` it takes over from the previous
 * version's window (handover.ts): it opens on top of it, shows only the update
 * screen until the app may load, and calls `onShown` once it's fully in view.
 */
export function createMainWindow({ handover = false, onShown }: { handover?: boolean; onShown?: () => void } = {}): BrowserWindow {
  const saved = loadBounds()
  const win = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    width: saved.width,
    height: saved.height,
    minWidth: 640,
    minHeight: 420,
    show: false,
    title: 'Gloom',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    backgroundColor: paperColor(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.windowStateChanged, windowState(win))
  }
  for (const event of ['focus', 'blur', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
    win.on(event as 'focus', send)
  }
  const onTheme = () => {
    if (win.isDestroyed()) return
    win.setTitleBarOverlay(overlayColors())
    win.setBackgroundColor(paperColor())
    send()
  }
  nativeTheme.on('updated', onTheme)
  systemPreferences.on('accent-color-changed', send)
  win.on('closed', () => {
    nativeTheme.off('updated', onTheme)
    systemPreferences.off('accent-color-changed', send)
  })

  win.on('close', () => saveBounds(win))
  win.once('ready-to-show', () => {
    // Taking over, Windows' opening zoom plays while the window is still clear;
    // then it turns opaque at once over the old window, which shows the same.
    if (onShown) win.setOpacity(0)
    if (saved.maximized) win.maximize()
    else win.show()
    if (!onShown) return
    win.moveTop()
    setTimeout(() => {
      if (win.isDestroyed()) return
      win.setOpacity(1)
      setTimeout(onShown, COMPOSITED_MS)
    }, OPENING_MS)
  })

  // Model output is untrusted: no in-app navigation, no new windows, and only
  // http(s) links leave for the browser.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(rendererUrl())) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const query = handover ? '?handover' : ''
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}`)
  else void win.loadFile(join(__dirname, '../renderer/index.html'), handover ? { search: 'handover' } : undefined)
  return win
}
