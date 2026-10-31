// The command palette's state: whether it's up, and what it remembers between
// launches: when you last settled on each session (Recent lists where you've
// been, newest first) and when you last picked each result (ties go to what
// you use).
import { useEffect } from 'react'
import { flushSync } from 'react-dom'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useUi } from './ui'

/** How many sessions and picks it remembers. */
const KEEP = 60
/** A session counts as visited once it has stayed open this long: arrowing past rows in the sidebar doesn't. */
const SETTLE_MS = 1000

interface PaletteState {
  open: boolean
  /** Shown or put away from the keyboard, so it comes and goes without animating. */
  instant: boolean
  /** When you last settled on each session, by its ID. */
  viewed: Record<string, number>
  /** When you last picked each result: 'command:<id>', 'session:<id>' or 'folder:<id>'. */
  picked: Record<string, number>
  noteViewed(id: string, at: number): void
  notePicked(key: string): void
}

/** The newest `KEEP` entries. */
function newest(times: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(times)
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP)
  )
}

export const usePalette = create<PaletteState>()(
  persist(
    (set, get) => ({
      open: false,
      instant: false,
      viewed: {},
      picked: {},
      noteViewed: (id, at) => set({ viewed: newest({ ...get().viewed, [id]: at }) }),
      notePicked: (key) => set({ picked: newest({ ...get().picked, [key]: Date.now() }) })
    }),
    { name: 'gloom.palette', version: 1, partialize: (s) => ({ viewed: s.viewed, picked: s.picked }) }
  )
)

/** Where the keyboard was before the palette came up. The window under it is inert meanwhile, which takes focus away. */
let returnTo: HTMLElement | null = null

/** A sheet is up (New Session, Settings…): it keeps the keyboard until it's done, so the palette waits. */
const sheetOpen = () => document.querySelector('[data-sheet]') !== null

export function openPalette(viaKeyboard: boolean): void {
  if (usePalette.getState().open || sheetOpen()) return
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // Chosen from a menu, it goes back to the menu's button: the item is gone by then.
  returnTo = active?.closest('[role="menu"]') ? document.querySelector<HTMLElement>('[aria-haspopup="menu"][aria-expanded="true"]') : active
  // The session's info card floats outside the window's inert part; it goes, as a popover does when something else comes up.
  useUi.getState().setInfo(false)
  usePalette.setState({ open: true, instant: viaKeyboard })
}

/**
 * Puts the palette away and gives the keyboard back where it was, at once, so
 * a command run from it (or by its shortcut while it's up) can take the
 * keyboard on from there.
 */
export function closePalette(viaKeyboard: boolean): void {
  if (!usePalette.getState().open) return
  flushSync(() => usePalette.setState({ open: false, instant: viaKeyboard }))
  const to = returnTo
  returnTo = null
  if (to?.isConnected) to.focus({ preventScroll: true })
}

export function togglePalette(viaKeyboard: boolean): void {
  if (usePalette.getState().open) closePalette(viaKeyboard)
  else openPalette(viaKeyboard)
}

/** Notes each session you settle on, for the palette's Recent. */
export function useSessionVisits(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (selection: string[]) => {
      clearTimeout(timer)
      if (selection.length !== 1) return
      const [id] = selection
      const at = Date.now()
      timer = setTimeout(() => usePalette.getState().noteViewed(id, at), SETTLE_MS)
    }
    settle(useUi.getState().selection)
    const off = useUi.subscribe((s, before) => s.selection !== before.selection && settle(s.selection))
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [])
}
