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

/** Gloom's own pets are at most 22 × 27 pixels; a pet you add can be bigger (up to 128 × 128). */
const BUILT_IN = { w: 26, h: 27 }

/** The chosen pet's size in its pixels: the biggest of its loops. */
function petPixels(): { w: number; h: number } {
  const kind = settings().petKind
  const custom = kind.startsWith('custom:') ? pets?.get(kind.slice(7)) : null
  if (!custom) return BUILT_IN
  const loops = Object.values(custom.loops)
  return { w: Math.max(BUILT_IN.w, ...loops.map((l) => l.w)), h: Math.max(BUILT_IN.h, ...loops.map((l) => l.h)) }
}

/** The window for the pet at `size` screen pixels per pixel: the pet, its toolbar and its card under it. */
function sizeFor(size: number) {
  const pet = petPixels()
  // A pet taller than Gloom's own is drawn at their height (Pet.tsx's petScale): the window follows.
  const k = pet.h > BUILT_IN.h ? BUILT_IN.h / pet.h : 1
  return { width: Math.max(320, Math.round(pet.w * size * k) + 24), height: 148 + Math.round(pet.h * size * k) }
}
/** From the work area's corner: clear of the taskbar and the screen's edge. */
const MARGIN = 12
const MOODS = new Set(['rest', 'busy', 'needs', 'ready'])

let win: BrowserWindow | null = null
/** A card per session that wants your attention, most urgent first (the main window works them out). */
let cards: PetState[] = []
let drag: { x: number; y: number; cursorX: number; cursorY: number } | null = null
let pets: Pets | null = null
/** The pet's menu is up: the pet mustn't come up over it. */
let menuOpen = false

/**
 * Puts the pet back on top. Windows can leave an always-on-top window that never
 * takes the focus (as the pet's can't) under ordinary ones: it still says it's on
 * top, but Gloom's own window, Chrome or Explorer show over it. Setting it on top
 * again (off, then on: Windows only re-applies a change) and raising it fixes that.
 * Done when it's likely needed (a drag, Gloom's window coming and going), never on
 * a timer: Codex's pet doesn't poll either, and a timer would keep jumping the pet
 * over every other always-on-top window.
 */
function keepOnTop() {
  if (!win || win.isDestroyed() || menuOpen || !win.isVisible()) return
  win.setAlwaysOnTop(false)
  win.setAlwaysOnTop(true, 'floating')
  win.moveTop()
}

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
  return { cards, kind: petKind.startsWith('custom:') && !custom ? 'blob' : petKind, size: petSize, custom }
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
    // As Codex's pet window: no resizing border, corners or accent edge, so nothing of the window shows.
    thickFrame: false,
    roundedCorners: false,
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
  // A floating panel's level, as Codex's pet has.
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true)
  // Clicks go through until the pointer is over the pet (petHover); moves still arrive, so the page can tell.
  win.setIgnoreMouseEvents(true, { forward: true })
  // Raised, then shown without taking the focus, as Codex shows its pet.
  win.once('ready-to-show', () => {
    win?.moveTop()
    win?.showInactive()
  })
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
    menuOpen = true
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
    ]).popup({
      window: win,
      callback: () => {
        menuOpen = false
        keepOnTop()
      }
    })
  }

  const fromPet = (event: IpcMainEvent) => trusted(event) && !!win && !win.isDestroyed() && event.sender === win.webContents
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)

  /** One card, checked; null when it isn't one. */
  const card = (raw: unknown): PetState | null => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const title = text(r.title, 120)
    const detail = text(r.detail, 300)
    const sessionId = text(r.sessionId, 100)
    if (typeof r.mood !== 'string' || !MOODS.has(r.mood) || r.mood === 'rest' || title === null || detail === null || !sessionId) return null
    return { mood: r.mood as PetState['mood'], title, detail, sessionId }
  }
  ipcMain.on(IPC.petReport, (event, next: unknown) => {
    if (!trusted(event) || !Array.isArray(next)) return
    const checked = next.slice(0, 8).map(card)
    if (checked.some((c) => c === null)) return
    cards = checked as PetState[]
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
      keepOnTop()
    } else if (phase === 'move' && drag) {
      win!.setPosition(Math.round(drag.x + cursor.x - drag.cursorX), Math.round(drag.y + cursor.y - drag.cursorY))
      win!.moveTop()
    } else if (phase === 'end') {
      drag = null
      savePlace()
      keepOnTop()
    }
  })
  ipcMain.on(IPC.petOpen, (event) => {
    if (fromPet(event)) toggle()
  })
  ipcMain.on(IPC.petAction, (event, what: unknown, sessionId: unknown) => {
    if (!fromPet(event)) return
    if (what === 'new-session') {
      show()
      runCommand('session.new', mainWindow, false)
    } else if (what === 'open-card') {
      // The card's session (one of the pet's cards), or a new one when nothing's going on.
      const id = cards.find((c) => c.sessionId === sessionId)?.sessionId ?? cards[0]?.sessionId
      if (id && !mainWindow.isDestroyed()) reveal(mainWindow, id)
      else {
        show()
        runCommand('session.new', mainWindow, false)
      }
    } else if (what === 'next-pet') nextPet()
    else if (what === 'menu') menu()
    else if (what === 'hide') updateSettings({ pet: false })
  })

  // Gloom's window coming and going is when Windows tends to push the pet under it.
  for (const event of ['focus', 'blur', 'show', 'restore', 'minimize'] as const) mainWindow.on(event as 'focus', () => setTimeout(keepOnTop, 50))

  onSettings(apply)
  if (mainWindow.isVisible()) apply(settings())
  else mainWindow.once('show', () => apply(settings()))
  return {
    changed: () => {
      // A pet you added may have changed size.
      resize()
      push()
    }
  }
}
