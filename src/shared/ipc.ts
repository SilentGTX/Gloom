// IPC channel names and payloads shared by main, preload and renderer.
import type { CommandId } from './commands'
import type { LibraryData, LibraryOp, SessionMeta } from './library'
import type { Cursor, TranscriptUpdate } from './transcript'

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
  /** invoke(TranscriptRequest) → TranscriptPage */
  readTranscript: 'transcript:read',
  /** invoke(sessionId, BlobRef) → an image's data URL, a long text, a whole diff */
  transcriptBlob: 'transcript:blob',
  /** invoke: stops reporting the open transcript's changes */
  unfollowTranscript: 'transcript:unfollow',
  /** main → renderer: TranscriptChange, as the open transcript grows */
  transcriptChanged: 'transcript:changed',
  /** invoke(sessionId, { check }) → ResumeResult: opens `claude --resume` in a terminal window */
  resumeSession: 'session:resume',
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
  /** invoke: the window becomes the update screen, which downloads and installs the update and restarts Gloom */
  installUpdate: 'update:install',
  /** invoke → UpdateScreen | null: what the update screen shows, or null when it's down */
  updateScreen: 'update:screen',
  /** main → renderer: UpdateScreen | null */
  updateScreenChanged: 'update:screen-changed',
  /** invoke: resolves once the previous version has quit, when this window took it over */
  handoverWait: 'handover:wait',
  /** invoke: the app is drawn under the update screen, which can go */
  handoverDone: 'handover:done',

  /** invoke → LiveSummary[]: every session Gloom runs */
  liveList: 'live:list',
  /** invoke(sessionId) → LiveSnapshot | null: its state, provisional entries and stream */
  liveSnapshot: 'live:snapshot',
  /** main → renderer: LiveEvent */
  liveEvent: 'live:event',
  /** invoke(NewSessionRequest) → string: the new session's ID */
  liveCreate: 'live:create',
  /** invoke(sessionId): a new session left without a message goes */
  liveDiscard: 'live:discard',
  /** invoke(sessionId) → CanSend */
  liveCheck: 'live:check',
  /** invoke(SendRequest): sends, or queues while Claude works */
  liveSend: 'live:send',
  /** invoke(sessionId) → Queued[]: stops the turn, handing back what was queued */
  liveInterrupt: 'live:interrupt',
  /** invoke(sessionId, queuedId) */
  liveUnqueue: 'live:unqueue',
  /** invoke(sessionId, CardAnswer) */
  liveAnswer: 'live:answer',
  /** invoke(sessionId, SetRequest): model, mode or effort */
  liveSet: 'live:set',
  /** invoke(sessionId) → CommandInfo[]: its slash commands */
  liveCommands: 'live:commands',
  /** invoke → ModelChoice[] */
  liveModels: 'live:models',
  /** invoke → UsageInfo | null */
  liveUsage: 'live:usage',
  /** invoke → ClaudeInfo */
  claudeInfo: 'claude:info',
  /** invoke('login' | 'update') → boolean: runs it in a terminal window */
  claudeTerminal: 'claude:terminal',
  /** invoke → string | null: a claude.exe chosen in a file picker */
  claudeLocate: 'claude:locate',
  /** invoke → Settings */
  settings: 'settings:get',
  /** invoke(Partial<Settings>) → Settings */
  settingsSet: 'settings:set',
  /** main → renderer: Settings */
  settingsChanged: 'settings:changed',
  /** invoke(count, png data URL | null): the taskbar badge */
  setBadge: 'attention:badge'
} as const

export interface UpdateState {
  /** 'available' lights up the Update button; 'disabled' in development builds. */
  status: 'idle' | 'available' | 'disabled'
  current: string
  /** The newer version, once a check finds one. */
  available?: string
  /** You clicked Update while Claude was working: it installs once no session is mid-turn. */
  waiting?: boolean
}

/** What the update screen shows. */
export type UpdateScreen =
  | { status: 'checking' }
  | { status: 'downloading'; version: string; received: number; total: number }
  /** `reopens`: the installer runs, so Gloom closes and reopens; otherwise it unpacks beside the running copy. */
  | { status: 'installing'; version: string; reopens: boolean }
  /** The new version is starting in this window (handover.ts). */
  | { status: 'starting'; version: string }
  /** The update failed; the screen goes in `seconds` and Gloom carries on as it is. */
  | { status: 'failed'; seconds: number }

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

export interface TranscriptRequest {
  id: string
  /** Null for the newest page. */
  cursor: Cursor | null
  /** Report the transcript's changes from now on (the newest page only). */
  follow: boolean
}

export interface TranscriptChange {
  id: string
  update: TranscriptUpdate
}

/** Whether a session can be opened in a terminal, and if not, why. */
export type ResumeResult = { ok: true; command: string } | { ok: false; reason: string }

export interface ApplyResult {
  rev: number
  library: LibraryData
  /** The op that puts things back, for an Undo button. */
  undo?: LibraryOp
  /** The folder createFolder made. */
  folderId?: string
}

/** main → transcripts worker */
export type WorkerRequest =
  | { type: 'start'; projectsDir: string; cacheFile: string }
  | { type: 'stop' }
  /** A page of a transcript; with `follow`, its appended entries are reported from then on. */
  | { type: 'page'; reqId: number; file: string; cursor: Cursor | null; follow: boolean }
  /** An image or a long text left out of a page. */
  | { type: 'blob'; reqId: number; file: string; ref: string }
  | { type: 'unfollow' }

/** transcripts worker → main */
export type WorkerReply =
  | { type: 'ready'; sessions: SessionMeta[]; stats: { files: number; read: number; ms: number } }
  | { type: 'changed'; upsert: SessionMeta[]; remove: string[] }
  | { type: 'error'; message: string }
  | { type: 'answer'; reqId: number; value: unknown }
  | { type: 'failed'; reqId: number; message: string }
  /** The followed transcript grew. */
  | { type: 'transcript'; file: string; update: TranscriptUpdate }
  /** Entry types Gloom doesn't know yet, met while reading `file`. */
  | { type: 'unknown'; file: string; types: string[] }
