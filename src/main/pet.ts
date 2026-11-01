// The pet's own window: small, clear and frameless, on top of every app on the
// desktop (as Codex's pet is), not inside Gloom's window. It shows Gloom's page
// with ?pet, which draws only the pet, its toolbar and its card. The main
// window's renderer works out what the pet should say (it knows which turns you
// haven't looked at yet) and reports it here; this passes it on with the pet you
// chose, at the size you chose.
//
// The window is bigger than the pet, so its clear parts let clicks through to
// whatever is under them; only the pet, its toolbar and its card take the pointer.
// Dragging the pet moves the window, and Gloom keeps the place for next time.
import { app, BrowserWindow, ipcMain, Menu, screen, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type PetState, type PetView } from '@shared/ipc'
import { PET_KINDS, type PetKind, type Settings } from '@shared/live'
import { reveal } from './attention'
import { onSettings, settings, updateSettings } from './claude/settings'
import { runCommand } from './commands'
import type { Pets } from './pets'
import { isRendererUrl, rendererUrl } from './window'

/** The window for a pet `size` screen pixels per pixel: the pet, its toolbar and its card under it. */
const sizeFor = (size: number) => ({ width: Math.max(320, 26 * size + 24), height: 122 + 27 * size })
/** From the work area's corner: clear of the taskbar and the screen's edge. */
const MARGIN = 12
const MOODS = new Set(['rest', 'busy', 'needs', 'ready'])

let win: BrowserWindow | null = null
let state: PetState = { mood: 'rest', title: '', detail: '', sessionId: null }
let drag: { x: number; y: number; cursorX: number; cursorY: number } | null = null
let pets: Pets | null = null

const placeFile = () => join(app.getPath('userData'), 'pet-window.json')

/** Where the pet was left, if that's still on a connected display; else the primary display's bottom-right corner. */
function place(size: { width: number; height: number }): { x: number; y: number } {
  try {
    if (existsSync(placeFile())) {
      const { x, y } = JSON.parse(readFileSync(placeFile(), 'utf8')) as { x?: unknown; y?: unknown }
      if (
        typeof x === 'number' &&
        typeof y === 'number' &&
        screen.getAllDisplays().some(({ workArea: a }) => x + size.width > a.x + 40 && x < a.x + a.width - 40 && y + size.height > a.y + 40 && y < a.y + a.height - 40)
      )
        return { x: Math.round(x), y: Math.round(y) }
    }
  } catch {
    // A corrupt file: the corner.
  }
  const a = screen.getPrimaryDisplay().workArea
  return { x: a.x + a.width - size.width - MARGIN, y: a.y + a.height - size.height - MARGIN }
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

function view(): PetView {
  const { petKind, petSize } = settings()
  const custom = petKind.startsWith('custom:') ? (pets?.get(petKind.slice(7)) ?? null) : null
  // A pet you created that's gone (its folder deleted) is Blob until you choose another.
  return { ...state, kind: petKind.startsWith('custom:') && !custom ? 'blob' : petKind, size: petSize, custom }
}

function push() {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.petView, view())
}

/** Every pet to choose from: Gloom's, then yours. */
function allKinds(): PetKind[] {
  return [...PET_KINDS, ...(pets?.all() ?? []).map((p) => `custom:${p.id}` as const)]
}

function nextPet() {
  const kinds = allKinds()
  updateSettings({ petKind: kinds[(kinds.indexOf(settings().petKind) + 1) % kinds.length] })
}

function open() {
  if (win && !win.isDestroyed()) return
  const size = sizeFor(settings().petSize)
  win = new BrowserWindow({
    ...size,
    ...place(size),
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

/** A new pet size: the window grows or shrinks about its bottom-right corner, where the pet stands. */
function resize() {
  if (!win || win.isDestroyed()) return
  const b = win.getBounds()
  const next = sizeFor(settings().petSize)
  if (next.width === b.width && next.height === b.height) return
  win.setBounds({ x: b.x + b.width - next.width, y: b.y + b.height - next.height, ...next })
  savePlace()
}

function close() {
  if (win && !win.isDestroyed()) win.close()
  win = null
}

function apply(next: Settings) {
  if (next.pet) {
    open()
    resize()
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
  customPets
}: {
  trusted: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean
  mainWindow: BrowserWindow
  customPets: Pets
}): { changed(): void } {
  pets = customPets
  const show = () => {
    if (mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  // Clicking the pet never takes the focus (its window can't), so Gloom in front
  // is still the focused window: then it minimizes; minimized or behind another app,
  // it comes forward.
  const toggle = () => {
    if (mainWindow.isDestroyed()) return
    if (mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) mainWindow.minimize()
    else show()
  }
  /** Right-click, or the toolbar's chevron: the pet's settings, the next pet, or no pet. */
  const menu = () => {
    if (!win || win.isDestroyed()) return
    Menu.buildFromTemplate([
      {
        label: 'Pet Settings…',
        click: () => {
          show()
          runCommand('app.petSettings', mainWindow, false)
        }
      },
      { label: 'Next Pet', click: nextPet },
      { type: 'separator' },
      { label: 'Hide Pet', click: () => updateSettings({ pet: false }) }
    ]).popup({ window: win })
  }

  const fromPet = (event: IpcMainEvent) => trusted(event) && !!win && !win.isDestroyed() && event.sender === win.webContents
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)

  ipcMain.on(IPC.petReport, (event, next: unknown) => {
    if (!trusted(event) || !next || typeof next !== 'object') return
    const raw = next as Record<string, unknown>
    const title = text(raw.title, 120)
    const detail = text(raw.detail, 300)
    const sessionId = raw.sessionId === null ? null : text(raw.sessionId, 100)
    if (typeof raw.mood !== 'string' || !MOODS.has(raw.mood) || title === null || detail === null || sessionId === undefined) return
    state = { mood: raw.mood as PetState['mood'], title, detail, sessionId }
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
    if (fromPet(event)) toggle()
  })
  ipcMain.on(IPC.petAction, (event, what: unknown) => {
    if (!fromPet(event)) return
    if (what === 'new-session') {
      show()
      runCommand('session.new', mainWindow, false)
    } else if (what === 'open-card') {
      // The card's session, or a new one when nothing's going on.
      if (state.sessionId && !mainWindow.isDestroyed()) reveal(mainWindow, state.sessionId)
      else {
        show()
        runCommand('session.new', mainWindow, false)
      }
    } else if (what === 'next-pet') nextPet()
    else if (what === 'menu') menu()
    else if (what === 'hide') updateSettings({ pet: false })
  })

  onSettings(apply)
  if (mainWindow.isVisible()) apply(settings())
  else mainWindow.once('show', () => apply(settings()))
  return { changed: push }
}
