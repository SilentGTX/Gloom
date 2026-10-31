// The panes' sizes, and the rules for what fits beside what.

export const SIDEBAR = { min: 220, max: 420, initial: 288 }
/** Narrower than this, the chat pushes the sidebar out into a sheet. */
export const CHAT_MIN = 480
/** The diff pane, beside the chat on the trailing side. */
export const DIFF = { min: 320, max: 960, initial: 460 }
/** The side pane (File, Plan, Tasks, Browser, Artifacts), on the trailing side like the diff pane. */
export const SIDE = { min: 360, max: 1200, initial: 560 }
/** Narrower than this beside the diff pane, the chat lets the pane float over it instead. */
export const CHAT_MIN_BESIDE_DIFF = 560
/** The terminal pane, under the chat. */
export const TERMINAL = { min: 120, initial: 260 }
/** The chat keeps at least this much height above the terminal. */
export const CHAT_MIN_HEIGHT = 220
/** The sidebar floats this far inside the window's edges. */
export const FRAME = 8
/** The concept's inspector, beside the chat on the trailing side. */
export const INSPECTOR = { width: 300 }
/** Narrower than this beside the inspector (a window under about 1240 px), the chat lets it float over it. */
export const CHAT_MIN_BESIDE_INSPECTOR = 640

export interface ColumnPrefs {
  sidebarWidth: number
  /** Hidden by the user; narrow windows also fold it away on their own. */
  sidebarHidden: boolean
}

export interface Layout {
  sidebarInline: boolean
  /** There's room for it beside the chat (hidden or not). */
  sidebarFits: boolean
}

export function computeLayout(width: number, p: ColumnPrefs): Layout {
  const sidebarFits = width - CHAT_MIN >= p.sidebarWidth
  return { sidebarInline: !p.sidebarHidden && sidebarFits, sidebarFits }
}

/** Whether the diff pane fits beside the chat, given what the sidebar takes. */
export function diffFits(width: number, sidebarColumn: number, diffWidth: number): boolean {
  return width - sidebarColumn - diffWidth >= CHAT_MIN_BESIDE_DIFF
}

/** Whether the concept's inspector fits beside the chat, given what the sidebar takes. */
export function inspectorFits(width: number, p: ColumnPrefs): boolean {
  const sidebarColumn = computeLayout(width, p).sidebarInline ? p.sidebarWidth + FRAME * 2 : 0
  return width - sidebarColumn - INSPECTOR.width >= CHAT_MIN_BESIDE_INSPECTOR
}
