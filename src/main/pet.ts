// The pet's own window: small, clear and frameless, on top of every app on the
// desktop (as Codex's pet is), not inside Gloom's window. It shows Gloom's page
// with ?pet, which draws only the pet and its bubble. The main window's renderer
// works out what the pet should say (it knows which turns you haven't looked at
// yet) and reports it here; this passes it on with the pet you chose.
//
// The window is bigger than the pet, so its clear parts let clicks through to
// whatever is under them; only the pet and its bubble take the pointer. Dragging
// the pet moves the window, and Gloom keeps the place for next time.
import { app, BrowserWindow, ipcMain, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type PetState, type PetView } from '@shared/ipc'
import type { Settings } from '@shared/live'
import { onSettings, settings } from './claude/settings'
import { isRendererUrl, rendererUrl } from './window'

const SIZE = { width: 220, height: 180 }
/** From the work area's corner: clear of the taskbar and the screen's edge. */
const MARGIN = 12
const MOODS = new Set(['rest', 'busy', 'needs', 'ready'])

let win: BrowserWindow | null = null
let state: PetState = { mood: 'rest', text: '' }
let drag: { x: number; y: number; cursorX: number; cursorY: number } | null = null

const placeFile = () => join(app.getPath('userData'), 'pet-window.json')

/** Where the pet was left, if that's still on a connected display; else the primary display's bottom-right corner. */
function place(): { x: number; y: number } {
  try {
    if (existsSync(placeFile())) {
      const saved = JSON.parse(readFileSync(placeFile(), 'utf8')) as { x?: unknown; y?: unknown }
      const { x, y } = saved
      if (
        typeof x === 'number' &&
        typeof y === 'number' &&
        screen.getAllDisplays().some(({ workArea: a }) => x + SIZE.width > a.x + 40 && x < a.x + a.width - 40 && y + SIZE.height > a.y + 40 && y < a.y + a.height - 40)
      )
        return { x: Math.round(x), y: Math.round(y) }
    }
  } catch {
    // A corrupt file: the corner.
  }
  const a = screen.getPrimaryDisplay().workArea
  return { x: a.x + a.width - SIZE.width - MARGIN, y: a.y + a.height - SIZE.height - MARGIN }
}

function savePlace() {
  if (!win || win.isDestroyed()) return
  const [x, y] = win.getPosition()
  try {
    writeFileSync(placeFile(), JSON.stringify({ x, y }))
  } catch {
    // Not worth a failure: next time it starts in the corner.
  }
}

const view = (): PetView => ({ ...state, kind: settings().petKind })

function push() {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.petView, view())
}

function open() {
  if (win && !win.isDestroyed()) return
  const at = place()
  win = new BrowserWindow({
    ...SIZE,
    ...at,
    show: false,
    title: 'Gloom Pet',
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Clicking the pet never takes the keyboard from the app you're in.
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  // Above ordinary always-on-top windows too, as a floating panel is.
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true)
  // Clicks go through until the pointer is over the pet (petHover); moves still arrive, so the page can tell.
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => win?.showInactive())
  win.on('closed', () => {
    win = null
    drag = null
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isRendererUrl(url)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void win.loadURL(`${rendererUrl()}?pet`)
}

function close() {
  if (win && !win.isDestroyed()) win.close()
  win = null
}

function apply(next: Settings) {
  if (next.pet) {
    open()
    push()
  } else close()
}

/**
 * Starts the pet: its window opens once Gloom's has shown (so Gloom's stays the
 * first window), and opens or closes as the setting changes.
 */
export function startPet({
  trusted,
  mainWindow,
  bringForward
}: {
  trusted: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean
  mainWindow: BrowserWindow
  bringForward: () => void
}): void {
  const fromPet = (event: IpcMainEvent) => trusted(event) && !!win && !win.isDestroyed() && event.sender === win.webContents

  ipcMain.on(IPC.petReport, (event, next: unknown) => {
    if (!trusted(event) || !next || typeof next !== 'object') return
    const { mood, text } = next as Record<string, unknown>
    if (typeof mood !== 'string' || !MOODS.has(mood) || typeof text !== 'string' || text.length > 200) return
    state = { mood: mood as PetState['mood'], text }
    push()
  })
  ipcMain.handle(IPC.petCurrent, (event) => {
    if (!trusted(event)) throw new Error('untrusted sender')
    return view()
  })
  ipcMain.on(IPC.petHover, (event, over: unknown) => {
    if (!fromPet(event)) return
    win!.setIgnoreMouseEvents(!over && !drag, { forward: true })
  })
  ipcMain.on(IPC.petDrag, (event, phase: unknown) => {
    if (!fromPet(event)) return
    const cursor = screen.getCursorScreenPoint()
    if (phase === 'start') {
      const [x, y] = win!.getPosition()
      drag = { x, y, cursorX: cursor.x, cursorY: cursor.y }
    } else if (phase === 'move' && drag) {
      win!.setPosition(Math.round(drag.x + cursor.x - drag.cursorX), Math.round(drag.y + cursor.y - drag.cursorY))
    } else if (phase === 'end') {
      drag = null
      savePlace()
    }
  })
  ipcMain.on(IPC.petOpen, (event) => {
    if (fromPet(event)) bringForward()
  })

  onSettings(apply)
  if (mainWindow.isVisible()) apply(settings())
  else mainWindow.once('show', () => apply(settings()))
}
