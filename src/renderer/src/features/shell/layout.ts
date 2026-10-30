// Column sizes and the rule for which columns fit inline at a window width.

export const FOLDERS = { min: 180, max: 360, initial: 232 }
export const SESSIONS = { min: 240, max: 480, initial: 320 }
/** Narrower than this, the chat pushes the folders and then the session list out. */
export const CHAT_MIN = 480

export interface ColumnPrefs {
  folderWidth: number
  sessionWidth: number
  /** Hidden by the user; narrow windows also collapse columns on their own. */
  foldersHidden: boolean
  sessionsHidden: boolean
}

export interface Layout {
  foldersInline: boolean
  sessionsInline: boolean
  foldersFit: boolean
  sessionsFit: boolean
}

/**
 * Which columns sit inline at this window width. Folders fold away first: they
 * only stay beside a session list that is itself inline (or one you hid).
 */
export function computeLayout(width: number, p: ColumnPrefs): Layout {
  const sessionsFit = width - CHAT_MIN >= p.sessionWidth
  const sessionsInline = !p.sessionsHidden && sessionsFit
  const foldersFit = (sessionsInline || p.sessionsHidden) && width - CHAT_MIN - (sessionsInline ? p.sessionWidth : 0) >= p.folderWidth
  return { foldersInline: !p.foldersHidden && foldersFit, sessionsInline, foldersFit, sessionsFit }
}
