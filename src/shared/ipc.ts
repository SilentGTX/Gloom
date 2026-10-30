// IPC channel names and payloads shared by main, preload and renderer.
import type { CommandId } from './commands'
import type { LibraryData, LibraryOp, SessionMeta } from './library'

export const IPC = {
  /** invoke → LibrarySnapshot */
  library: 'library:get',
  /** invoke(LibraryOp) → ApplyResult */
  libraryApply: 'library:apply',
  /** main → renderer: LibraryChange, whenever the library changes */
  libraryChanged: 'library:changed',
  /** main → renderer: SessionsChange, as the index finds new and changed transcripts */
  sessionsChanged: 'library:sessions',
  /** invoke(sessionId) → boolean: opens its working folder in Explorer; false if it's gone */
  revealSession: 'library:reveal',
  /** invoke(sessionId): copies the session ID to the clipboard */
  copySessionId: 'library:copy-id',
  /** invoke → string | null: a folder chosen in the system's folder picker */
  pickFolder: 'library:pick-folder',
  /** invoke → WindowState */
  windowState: 'window:state',
  /** main → renderer: WindowState */
  windowStateChanged: 'window:state-changed',
  /** invoke(CommandId): runs a command that lives in the main process */
  runCommand: 'command:run',
  /** main → renderer: CommandDispatch, for commands the renderer handles */
  dispatchCommand: 'command:dispatch',
  /** invoke → AppInfo */
  appInfo: 'app:info',
  /** invoke → UpdateState */
  updateState: 'update:state',
  /** main → renderer: UpdateState */
  updateStateChanged: 'update:state-changed',
  /** invoke: the update window takes over, downloads and installs the update, and restarts Gloom */
  installUpdate: 'update:install',
  /** main → update window: SplashState */
  splashState: 'splash:state'
} as const

export interface UpdateState {
  /** 'available' lights up the Update button; 'disabled' in development builds. */
  status: 'idle' | 'available' | 'disabled'
  current: string
  /** The newer version, once a check finds one. */
  available?: string
}

/** What the update window shows. */
export type SplashState =
  | { status: 'checking' }
  | { status: 'downloading'; version: string; received: number; total: number }
  | { status: 'installing'; version: string }
  /** The update failed; Gloom carries on as it is in `seconds`. */
  | { status: 'failed'; seconds: number }
  | { status: 'launching' }

export interface WindowState {
  focused: boolean
  maximized: boolean
  fullscreen: boolean
  dark: boolean
  /** Windows' accent colour as #rrggbb. */
  accent: string
  /** Height of the caption-button overlay in CSS pixels. */
  titleBarHeight: number
}

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
}

export interface CommandDispatch {
  id: CommandId
  /** Keyboard-triggered actions don't animate. */
  viaKeyboard: boolean
}

/** Everything the session list and folder tree start from. */
export interface LibrarySnapshot {
  /** Counts up with every change, so an older update never overwrites a newer one. */
  rev: number
  library: LibraryData
  sessions: SessionMeta[]
  /** False until the first index is done. */
  indexed: boolean
}

export interface LibraryChange {
  rev: number
  library: LibraryData
}

export interface SessionsChange {
  upsert: SessionMeta[]
  remove: string[]
  indexed: boolean
}

export interface ApplyResult {
  rev: number
  library: LibraryData
  /** The op that puts things back, for an Undo button. */
  undo?: LibraryOp
  /** The folder createFolder made. */
  folderId?: string
}

/** main → transcripts worker */
export type WorkerRequest = { type: 'start'; projectsDir: string; cacheFile: string } | { type: 'stop' }

/** transcripts worker → main */
export type WorkerReply =
  | { type: 'ready'; sessions: SessionMeta[]; stats: { files: number; read: number; ms: number } }
  | { type: 'changed'; upsert: SessionMeta[]; remove: string[] }
  | { type: 'error'; message: string }
