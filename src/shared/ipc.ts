// IPC channel names and payloads shared by main, preload and renderer.
import type { CommandId } from './commands'
import type { LibraryData, LibraryOp, SessionMeta } from './library'
import type { PetKind } from './live'
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
  /** invoke(sessionId) → boolean: opens its working folder in the code editor (else File Explorer); false if it's gone */
  openInEditor: 'library:open-in-editor',
  /** invoke → string | null: the code editor a folder opens in, by name (VS Code, when it's installed) */
  editorName: 'library:editor-name',
  /** invoke → string | null: a folder chosen in the system's folder picker */
  pickFolder: 'library:pick-folder',
  /** invoke(TranscriptRequest) → TranscriptPage */
  readTranscript: 'transcript:read',
  /** invoke(sessionId, BlobRef) → an image's data URL, a long text, a whole diff */
  transcriptBlob: 'transcript:blob',
  /** invoke(sessionId?): stops reporting that transcript's changes (every one, without an ID) */
  unfollowTranscript: 'transcript:unfollow',
  /** main → renderer: TranscriptChange, as the open transcript grows */
  transcriptChanged: 'transcript:changed',
  /** invoke(sessionId, { check }) → ResumeResult: opens `claude --resume` in a terminal window */
  resumeSession: 'session:resume',
  /** invoke(sessionId) → ExportResult: a zip of its transcripts in Downloads */
  exportSession: 'session:export',
  /** invoke(query, includeArchived) → TranscriptSearch: sessions whose conversations say it */
  searchTranscripts: 'library:search',
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
  /** invoke → [key, value][] | null: the settings kept under file://, once, for the page to take over */
  storageToMove: 'storage:to-move',

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
  /** invoke(sessionId, SetRequest): model, mode, effort, fast mode, output style or folders */
  liveSet: 'live:set',
  /** invoke(sessionId, serverName, enabled): turns one of its MCP servers off or on */
  liveToggleMcp: 'live:toggle-mcp',
  /** invoke(sessionId, serverName): connects one of its MCP servers again */
  liveReconnectMcp: 'live:reconnect-mcp',
  /** invoke(sessionId, taskId): stops one of its background tasks */
  liveStopTask: 'live:stop-task',
  /** invoke(sessionId, path) → FileRead: a file inside the session's folders, for the File pane */
  fileRead: 'file:read',
  /** invoke(sessionId) → CommandInfo[]: its slash commands */
  liveCommands: 'live:commands',
  /** invoke(sessionId) → FileListing: what `@` offers, from its working folder */
  liveFiles: 'live:files',
  /** invoke → ModelChoice[] */
  liveModels: 'live:models',
  /** invoke → UsageInfo | null */
  liveUsage: 'live:usage',
  /** invoke → AccountSummary | null: who Claude Code is signed in as */
  liveAccount: 'live:account',
  /** invoke → ClaudeDefaults: the effort Claude Code starts on when nothing picks one */
  liveDefaults: 'live:defaults',
  /** invoke(maxAgeMs): asks for your plan's usage when what's known is older; it arrives as a LiveEvent */
  liveRefreshUsage: 'live:refresh-usage',
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
  setBadge: 'attention:badge',

  /** invoke(sessionId, messageId) → RewindPreview: what rewinding to before a message can restore */
  liveRewindPreview: 'live:rewind-preview',
  /** invoke(sessionId, RewindRequest) → CodeRewind | null: rewinds; the code part's result */
  liveRewind: 'live:rewind',
  /** invoke(sessionId): takes back a conversation rewind nothing has been sent after */
  liveRewindUndo: 'live:rewind-undo',
  /** invoke(sessionId) → boolean: makes its missing working folder again (a worktree from its branch) */
  liveRecreate: 'live:recreate',

  /** invoke(folder) → RepoInfo | null: the git repository a folder is in */
  gitRepo: 'git:repo',
  /** invoke(sessionId) → WorktreeInfo | null: the worktree a session works in */
  gitWorktree: 'git:worktree',
  /** invoke(sessionId) → MergeResult: lands its worktree's branch on the branch it came from */
  gitMerge: 'git:merge',
  /** invoke(sessionId, force) → RemoveResult: removes its worktree (the branch stays) */
  gitRemoveWorktree: 'git:remove-worktree',

  /** invoke(sessionId) → SessionDiff: Claude's edits in the session */
  diffSession: 'diff:session',
  /** invoke(sessionId) → TreeDiff: what git sees in its working folder */
  diffTree: 'diff:tree',
  /** invoke(path) → boolean: shows a file in File Explorer; false if it's gone */
  revealFile: 'diff:reveal',

  /** invoke → ShellInfo[]: the shells installed */
  terminalShells: 'terminal:shells',
  /** invoke(TerminalCreate) → TerminalInfo */
  terminalCreate: 'terminal:create',
  /** invoke → TerminalInfo[]: every terminal open */
  terminalList: 'terminal:list',
  /** invoke(id) → TerminalAttach: its recent output, to catch up */
  terminalAttach: 'terminal:attach',
  /** send(id, data): typed into it */
  terminalInput: 'terminal:input',
  /** send(id, cols, rows) */
  terminalResize: 'terminal:resize',
  /** send(id, chars): drawn this much of what it was sent */
  terminalAck: 'terminal:ack',
  /** invoke(id): ends its shell */
  terminalClose: 'terminal:close',
  /** main → renderer: TerminalData */
  terminalData: 'terminal:data',
  /** main → renderer: TerminalExit */
  terminalExit: 'terminal:exit',
  /** main → renderer: TerminalInfo, a terminal Claude opened (Gloom's terminal tools) */
  terminalOpened: 'terminal:opened',
  /** invoke(id, code, title, WidgetTheme) → string: the URL an inline widget's frame loads */
  widgetServe: 'widget:serve',
  /** invoke(taskId) → string: starts a session Claude proposed; its ID */
  sideStart: 'side:start',
  /** invoke(sessionId, taskId): withdraws a proposal */
  sideDismiss: 'side:dismiss',
  /** invoke(taskId) → boolean: whether a proposal still waits */
  sidePending: 'side:pending',
  /** invoke(sessionId, {x, y, width, height}): the Browser pane shows the session's page there */
  browserShow: 'browser:show',
  /** invoke: the Browser pane went away, or something covers it */
  browserHide: 'browser:hide',
  /** invoke(sessionId, address) → BrowserState */
  browserNavigate: 'browser:navigate',
  /** invoke(sessionId, 'back' | 'forward' | 'reload') */
  browserGo: 'browser:go',
  /** invoke(sessionId) → BrowserState */
  browserState: 'browser:state',
  /** main → renderer: BrowserState, as a page loads or changes */
  browserChanged: 'browser:changed',
  /** main → renderer: sessionId, whose Browser pane Claude is using (it comes up if that session shows) */
  browserOpen: 'browser:open',
  /** invoke(sessionId) → PreviewList: the dev servers .claude/launch.json defines, and the ones running */
  previewList: 'preview:list',
  /** invoke(sessionId, name) → PreviewServer */
  previewStart: 'preview:start',
  /** invoke(serverId) */
  previewStop: 'preview:stop',
  /** invoke(pane, sessionId): opens a pane in a window of its own */
  popOut: 'window:pop-out',
  /** invoke(sessionId, maxAgeMs?) → PrStatus | null: the session's pull request */
  prStatus: 'pr:status',
  /** invoke(sessionId, url | null): links a pull request by hand (null: found from the branch again) */
  prBind: 'pr:bind',
  /** invoke(sessionId, 'squash' | 'merge' | 'rebase') */
  prMerge: 'pr:merge',
  /** invoke(sessionId, enabled, method) */
  prAutoMerge: 'pr:auto-merge',
  /** invoke(sessionId, { autoFix?, autoArchive? }) */
  prMonitor: 'pr:monitor',
  /** invoke → RoutineList */
  routinesList: 'routines:list',
  /** invoke(routine) → Routine: adds or changes one */
  routinesSave: 'routines:save',
  /** invoke(id) */
  routinesDelete: 'routines:delete',
  /** invoke(id) → string: runs it now; the new session's ID */
  routinesRun: 'routines:run',
  /** main → renderer: RoutineList, as routines change or run */
  routinesChanged: 'routines:changed',
  /** invoke(folder, task) → CloudSession: starts a cloud session (claude --cloud) and opens it on claude.ai */
  cloudStart: 'cloud:start',
  /** invoke → CloudSession[]: the cloud sessions Gloom started */
  cloudList: 'cloud:list',
  /** send(PetState[]): the main window's renderer says what the pet should show: a card per session that wants you, most urgent first */
  petReport: 'pet:report',
  /** invoke → PetView: what the pet window shows as it opens */
  petCurrent: 'pet:current',
  /** main → pet window: PetView, as it changes */
  petView: 'pet:view',
  /** send(boolean): the pointer is over the pet or its bubble (the rest of its window lets clicks through) */
  petHover: 'pet:hover',
  /** send('start' | 'move' | 'end'): the pet is being dragged; main moves its window with the cursor */
  petDrag: 'pet:drag',
  /** send: the pet was clicked; Gloom minimizes when it is in front, else comes forward */
  petOpen: 'pet:open',
  /** send(PetAction): a button on the toolbar the pet shows under the pointer */
  petAction: 'pet:action',
  /** invoke → CustomPet[]: the pets you created (Gloom's pets folder) */
  petsList: 'pets:list',
  /** main → renderer: CustomPet[], as that folder changes */
  petsChanged: 'pets:changed',
  /** invoke(name, idea) → sessionId: starts a Claude Code session that draws a new pet */
  petsCreate: 'pets:create',
  /** invoke(id): deletes a pet you created */
  petsRemove: 'pets:remove',
  /** invoke: shows the pets folder in Explorer */
  petsReveal: 'pets:reveal'
} as const

/** What the pet shows: the most urgent state across the sessions, and the bubble's words (empty at rest). */
export interface PetState {
  mood: 'rest' | 'busy' | 'needs' | 'ready'
  /** The session it's about (its title), or empty at rest. */
  title: string
  /** What's happening in it: what Claude is saying or doing, what it needs, how it ended. */
  detail: string
  /** That session, so clicking the card opens it; null at rest. */
  sessionId: string | null
}

/** The pet toolbar's buttons: a new session in Gloom, the next pet, or no pet. */
export type PetAction = 'new-session' | 'next-pet' | 'hide' | 'open-card' | 'menu'

/** One of a pet's loops: a horizontal strip of w × h frames, each shown for its duration (ms). */
export interface PetLoopData {
  src: string
  w: number
  h: number
  durations: number[]
  once?: boolean
  /** After the first time through, the loop starts again from this frame: an intro that plays once (a laptop appearing), then the rest repeats. */
  loopFrom?: number
}
export const PET_LOOPS = ['idle', 'busy', 'walk', 'fall', 'happy', 'jump'] as const
export type PetLoopKey = (typeof PET_LOOPS)[number]

/** A pet you created: its folder in Gloom's pets folder, its name and its loops (PNG data URLs). */
export interface CustomPet {
  id: string
  name: string
  description: string
  loops: Record<PetLoopKey, PetLoopData>
  /** Where its status dot goes, in its own pixels (the dot's top-left); else the top right of a Gloom-sized pet. */
  badge?: { x: number; y: number }
}

export interface PetView {
  /** A card per session that wants your attention, most urgent first; none at rest. */
  cards: PetState[]
  kind: PetKind
  size: number
  /** The loops of a pet you created, when that's the pet. */
  custom: CustomPet | null
}

/** A new terminal: in the session's working folder (your home folder without one), sized to the pane. */
export interface TerminalCreate {
  sessionId: string | null
  cols: number
  rows: number
}

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
  /** Windows' build number (26100), which xterm wants for ConPTY; 0 elsewhere. */
  windowsBuild: number
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

/** A file the File pane shows: its text (cut past a size), or why it can't. */
export type FileRead = { ok: true; path: string; text: string; size: number; truncated: boolean } | { ok: false; path: string; reason: string }

/** The Browser pane's page: where it is and whether it can go back. */
export interface BrowserState {
  sessionId: string
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

/** A dev server from .claude/launch.json. */
export interface PreviewServerInfo {
  id: string
  name: string
  cwd: string
  url: string | null
  status: 'starting' | 'running' | 'exited' | 'failed'
  exitCode: number | null
  started: number
}

export interface PreviewList {
  file: string
  problem: string | null
  configurations: { name: string; port: number | null; url: string | null }[]
  running: PreviewServerInfo[]
}

/** The routines, and when each runs next (ms, or null). */
export interface RoutineList {
  routines: import('./routines').Routine[]
  next: Record<string, number | null>
}

/** Where an exported session's zip went. */
export interface ExportResult {
  path: string
  size: number
}

/** Sessions whose conversations say what you searched for, newest first; `done` is false when a newer search cut it short. */
export interface TranscriptSearch {
  hits: { id: string; snippet: string }[]
  done: boolean
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
export type WorkerRequest =
  | { type: 'start'; projectsDir: string; cacheFile: string }
  | { type: 'stop' }
  /** A page of a transcript; with `follow`, its appended entries are reported from then on. */
  | { type: 'page'; reqId: number; file: string; cursor: Cursor | null; follow: boolean }
  /** An image or a long text left out of a page. */
  | { type: 'blob'; reqId: number; file: string; ref: string }
  /** Claude's edits in a transcript, composed per file; paths shown relative to `cwd`. */
  | { type: 'edits'; reqId: number; file: string; cwd: string | null }
  /** The entry before a line on the chain (its parentUuid): null for the first, undefined when the line isn't there. */
  | { type: 'parent'; reqId: number; file: string; uuid: string }
  /** Which of these transcripts say `query` (newest first), with a snippet each; a newer search ends this one. */
  | { type: 'search'; reqId: number; query: string; files: { id: string; file: string }[]; limit: number }
  /** Stops following a transcript (every one, without a file). */
  | { type: 'unfollow'; file?: string }

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
