// The terminal pane's tabs: every terminal open, and which one shows in each
// working folder. Sessions in the same folder share them. The screens
// themselves (xterm) live in features/terminal/registry.ts.
import { useEffect } from 'react'
import { create } from 'zustand'
import { folderKey, type TerminalInfo } from '@shared/terminal'
import { notify } from '../lib/toast'
import { useUi } from './ui'

interface TerminalsState {
  terminals: TerminalInfo[]
  /** The tab showing, by folder key. */
  active: Record<string, string>
  /** Folders a terminal couldn't open in, with why. */
  failed: Record<string, string>
  /** Opens a terminal in a session's working folder and shows it. */
  open(sessionId: string, folder: string): Promise<TerminalInfo | null>
  /** Ends its shell; the last tab in the folder takes the pane with it. */
  close(id: string): void
  select(id: string): void
}

const failure = (error: unknown) => String((error as Error)?.message ?? error).replace(/^.*?Error: /, '')

/**
 * The next screen to show takes the keyboard: set when you open the pane, a
 * tab or a new terminal, never when a session switch brings other tabs in.
 */
let focusWanted = false
export const wantFocus = () => {
  focusWanted = true
}
export function takeFocusWish(): boolean {
  const wanted = focusWanted
  focusWanted = false
  return wanted
}

/** Called as a terminal closes, so its screen can go (set by the registry). */
export const terminalHooks: { closed: (id: string) => void; exited: (id: string, code: number) => void } = { closed: () => {}, exited: () => {} }

export const useTerminals = create<TerminalsState>()((set, get) => ({
  terminals: [],
  active: {},
  failed: {},

  open: async (sessionId, folder) => {
    const api = window.gloom
    if (!api) return null
    const key = folderKey(folder)
    try {
      const info = await api.terminal.create({ sessionId, cols: 100, rows: 24 })
      const { [key]: _gone, ...failed } = get().failed
      set({ terminals: [...get().terminals, info], active: { ...get().active, [folderKey(info.cwd)]: info.id }, failed })
      return info
    } catch (error) {
      set({ failed: { ...get().failed, [key]: failure(error) } })
      return null
    }
  },

  close: (id) => {
    const s = get()
    const info = s.terminals.find((t) => t.id === id)
    if (!info) return
    const key = folderKey(info.cwd)
    const siblings = s.terminals.filter((t) => folderKey(t.cwd) === key)
    const at = siblings.findIndex((t) => t.id === id)
    const next = siblings[at + 1] ?? siblings[at - 1]
    const active = { ...s.active }
    if (next) active[key] = next.id
    else delete active[key]
    set({ terminals: s.terminals.filter((t) => t.id !== id), active })
    void window.gloom?.terminal.close(id)
    terminalHooks.closed(id)
    // The folder's last tab closing puts the pane away, as the last tab of a window closes it.
    if (!next && useUi.getState().terminalOpen) useUi.getState().toggleTerminal(false, false)
  },

  select: (id) => {
    const info = get().terminals.find((t) => t.id === id)
    if (info) set({ active: { ...get().active, [folderKey(info.cwd)]: id } })
  }
}))

/** The terminals open in a folder, oldest first. */
export function folderTerminals(terminals: TerminalInfo[], folder: string | null): TerminalInfo[] {
  if (!folder) return []
  const key = folderKey(folder)
  return terminals.filter((t) => folderKey(t.cwd) === key)
}

/**
 * Keeps the list in step with main: what's open after the window reloads, and
 * shells that end. One that ends cleanly (exit) closes its tab, as Terminal
 * does; one that fails stays, so you can read why.
 */
export function useTerminalsBridge(): void {
  useEffect(() => {
    const api = window.gloom
    if (!api) return
    void api.terminal.list().then((terminals) => {
      if (!terminals.length) return
      const active: Record<string, string> = {}
      for (const t of terminals) active[folderKey(t.cwd)] ??= t.id
      useTerminals.setState({ terminals, active })
    })
    return api.terminal.onExit(({ id, code }) => {
      const s = useTerminals.getState()
      if (!s.terminals.some((t) => t.id === id)) return
      if (code === 0) {
        s.close(id)
        return
      }
      useTerminals.setState({ terminals: s.terminals.map((t) => (t.id === id ? { ...t, exitCode: code } : t)) })
      terminalHooks.exited(id, code)
    })
  }, [])
}

/** Opens a terminal for the open session, showing the pane; says why when it can't. */
export async function newTerminal(sessionId: string | null, folder: string | null, viaKeyboard: boolean): Promise<void> {
  if (!sessionId || !folder) {
    notify('Open a session first: a terminal opens in its working folder.')
    return
  }
  useUi.getState().toggleTerminal(viaKeyboard, true)
  wantFocus()
  const info = await useTerminals.getState().open(sessionId, folder)
  if (!info) notify(`Can’t open a terminal. ${useTerminals.getState().failed[folderKey(folder)] ?? ''}`.trim())
}
