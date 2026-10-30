// The sidebar's size, and the rule for whether it fits beside the chat.

export const SIDEBAR = { min: 220, max: 420, initial: 288 }
/** Narrower than this, the chat pushes the sidebar out into a sheet. */
export const CHAT_MIN = 480

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
