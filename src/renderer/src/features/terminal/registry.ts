// Each terminal's screen: an xterm made the first time its tab shows and kept
// while the terminal lives, so switching tabs or sessions finds every screen
// as it was. Output arrives for every terminal; one not shown here yet catches
// up from main's copy when it first shows. A screen says how much it has drawn,
// so main can pause a shell that floods it.
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { COMMANDS, matchesAccelerator, type CommandId, type CommandSpec } from '@shared/commands'
import type { TerminalData } from '@shared/terminal'
import { terminalHooks } from '../../stores/terminals'
import { useUi } from '../../stores/ui'

/** Gloom's own shortcuts that still work with a terminal focused; every other key goes to the shell (Ctrl+R, Ctrl+A…). */
const APP_KEYS = new Set<CommandId>([
  'view.toggleTerminal',
  'terminal.new',
  'view.toggleDiff',
  'view.refreshDiff',
  'view.toggleSidebar',
  'view.search',
  'view.textBigger',
  'view.textSmaller',
  'view.textReset',
  'view.fullScreen',
  'folder.new',
  'app.settings',
  'app.quit',
  'dev.devTools'
])
const appAccelerators = (COMMANDS as readonly CommandSpec[]).filter((c) => c.accelerator && APP_KEYS.has(c.id as CommandId)).map((c) => c.accelerator!)

interface Screen {
  term: Terminal
  fit: FitAddon
  /** xterm's own element lives in here, moved between panes as tabs show. */
  host: HTMLDivElement
  /** Output drawn so far, as main counts it. */
  seq: number
  /** Caught up with main's copy. Until then output waits here. */
  ready: boolean
  waiting: TerminalData[]
  opened: boolean
  cols: number
  rows: number
}

const screens = new Map<string, Screen>()
let windowsBuild = 0

/** Gloom's terminal palette, from the stylesheet, so it follows light and dark. */
function theme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const v = (name: string) => style.getPropertyValue(`--terminal-${name}`).trim()
  return {
    background: v('bg'),
    foreground: v('fg'),
    cursor: v('cursor'),
    cursorAccent: v('bg'),
    selectionBackground: v('selection'),
    black: v('black'),
    red: v('red'),
    green: v('green'),
    yellow: v('yellow'),
    blue: v('blue'),
    magenta: v('magenta'),
    cyan: v('cyan'),
    white: v('white'),
    brightBlack: v('bright-black'),
    brightRed: v('bright-red'),
    brightGreen: v('bright-green'),
    brightYellow: v('bright-yellow'),
    brightBlue: v('bright-blue'),
    brightMagenta: v('bright-magenta'),
    brightCyan: v('bright-cyan'),
    brightWhite: v('bright-white')
  }
}

const fontSize = () => Math.round(13 * useUi.getState().textScale)

function write(id: string, screen: Screen, data: TerminalData): void {
  if (data.seq <= screen.seq) return
  screen.seq = data.seq
  screen.term.write(data.data, () => window.gloom?.terminal.ack(id, data.data.length))
}

/** The screen for a terminal, made (and caught up) the first time it's asked for. */
export function screenFor(id: string): Screen {
  const existing = screens.get(id)
  if (existing) return existing
  const term = new Terminal({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--typeface-mono').trim() || 'Cascadia Mono, monospace',
    fontSize: fontSize(),
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 5000,
    theme: theme(),
    ...(windowsBuild ? { windowsPty: { backend: 'conpty' as const, buildNumber: windowsBuild } } : {})
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  // Links open in your browser (the main process only lets http(s) out).
  term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))
  const host = document.createElement('div')
  host.className = 'terminal-host'
  const screen: Screen = { term, fit, host, seq: 0, ready: false, waiting: [], opened: false, cols: 0, rows: 0 }
  screens.set(id, screen)

  term.onData((data) => window.gloom?.terminal.input(id, data))
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true
    // Gloom's own shortcuts go to its menu.
    if (appAccelerators.some((a) => matchesAccelerator(a, e))) return false
    // Copy and paste as Windows terminals do: Ctrl+C copies when there's a selection
    // (else it interrupts), Ctrl+V and Ctrl+Shift+V paste, Ctrl+Shift+C copies.
    const key = e.key.toLowerCase()
    if (e.ctrlKey && !e.altKey && key === 'c' && (e.shiftKey || term.hasSelection())) {
      if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
      e.preventDefault()
      return false
    }
    // Left to the browser, which pastes into xterm's field.
    if (e.ctrlKey && !e.altKey && key === 'v') return false
    return true
  })
  host.addEventListener('contextmenu', (e) => {
    // A right click copies the selection, or pastes: the Windows console's way.
    e.preventDefault()
    if (term.hasSelection()) {
      void navigator.clipboard.writeText(term.getSelection())
      term.clearSelection()
    } else void navigator.clipboard.readText().then((text) => text && term.paste(text), () => {})
  })

  void window.gloom?.terminal.attach(id).then(
    (caught) => {
      if (!screens.has(id)) return
      if (caught.data) term.write(caught.data)
      screen.seq = caught.seq
      screen.ready = true
      for (const data of screen.waiting) write(id, screen, data)
      screen.waiting = []
      if (caught.exitCode !== null && caught.exitCode !== 0) exitedNote(term, caught.exitCode)
    },
    () => term.write('\r\n\x1b[2mThis terminal has closed.\x1b[0m\r\n')
  )
  return screen
}

function exitedNote(term: Terminal, code: number): void {
  term.write(`\r\n\x1b[2m[The shell ended with code ${code}. Close the tab when you’re done reading.]\x1b[0m\r\n`)
}

/** Shows a terminal's screen in `container`, sized to it. */
export function mountScreen(id: string, container: HTMLElement): Screen {
  const screen = screenFor(id)
  if (screen.host.parentElement !== container) {
    container.replaceChildren(screen.host)
  }
  if (!screen.opened) {
    screen.term.open(screen.host)
    screen.opened = true
  }
  fitScreen(id)
  return screen
}

/** Fits the screen to its pane and tells the shell its new size. */
export function fitScreen(id: string): void {
  const screen = screens.get(id)
  if (!screen?.opened || !screen.host.isConnected || !screen.host.clientWidth) return
  try {
    screen.fit.fit()
  } catch {
    return
  }
  const { cols, rows } = screen.term
  if (cols === screen.cols && rows === screen.rows) return
  screen.cols = cols
  screen.rows = rows
  window.gloom?.terminal.resize(id, cols, rows)
}

export function focusScreen(id: string): void {
  screens.get(id)?.term.focus()
}

export function screenHasFocus(): boolean {
  return !!document.activeElement?.closest('.terminal-host')
}

function disposeScreen(id: string): void {
  const screen = screens.get(id)
  if (!screen) return
  screens.delete(id)
  screen.term.dispose()
  screen.host.remove()
}

/** Output for every terminal, from main; light and dark, and text size, for every screen. */
export function startScreens(): () => void {
  const api = window.gloom
  if (!api) return () => {}
  void api.getAppInfo().then((info) => (windowsBuild = info.windowsBuild ?? 0))
  terminalHooks.closed = disposeScreen
  terminalHooks.exited = (id, code) => {
    const screen = screens.get(id)
    if (screen) exitedNote(screen.term, code)
  }
  const offData = api.terminal.onData((data) => {
    const screen = screens.get(data.id)
    if (!screen) return
    if (!screen.ready) screen.waiting.push(data)
    else write(data.id, screen, data)
  })
  const dark = window.matchMedia('(prefers-color-scheme: dark)')
  const retheme = () => {
    const next = theme()
    for (const screen of screens.values()) screen.term.options.theme = next
  }
  dark.addEventListener('change', retheme)
  const offScale = useUi.subscribe((s, before) => {
    if (s.textScale === before.textScale) return
    for (const [id, screen] of screens) {
      screen.term.options.fontSize = fontSize()
      fitScreen(id)
    }
  })
  return () => {
    offData()
    offScale()
    dark.removeEventListener('change', retheme)
  }
}
