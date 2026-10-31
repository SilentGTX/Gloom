// The typed `window.gloom` bridge, as the renderer sees it.
import type { CommandId } from '../shared/commands'
import type {
  AppInfo,
  ApplyResult,
  CommandDispatch,
  LibraryChange,
  LibrarySnapshot,
  ResumeResult,
  SessionsChange,
  TerminalCreate,
  TranscriptChange,
  TranscriptRequest,
  UpdateScreen,
  UpdateState,
  WindowState
} from '../shared/ipc'
import type { SessionDiff, TreeDiff } from '../shared/diff'
import type { ShellInfo, TerminalAttach, TerminalData, TerminalExit, TerminalInfo } from '../shared/terminal'
import type { LibraryOp } from '../shared/library'
import type { MergeResult, RemoveResult, RepoInfo, WorktreeInfo } from '../shared/git'
import type {
  AccountSummary,
  CanSend,
  CardAnswer,
  ClaudeInfo,
  CodeRewind,
  CommandInfo,
  FileListing,
  LiveEvent,
  LiveSnapshot,
  LiveSummary,
  ModelChoice,
  NewSessionRequest,
  Queued,
  RewindPreview,
  RewindRequest,
  SendRequest,
  SetRequest,
  Settings,
  UsageInfo
} from '../shared/live'
import type { BlobRef, TranscriptPage } from '../shared/transcript'

/** The sessions Gloom runs. */
export interface LiveApi {
  list(): Promise<LiveSummary[]>
  snapshot(id: string): Promise<LiveSnapshot | null>
  onEvent(listener: (event: LiveEvent) => void): () => void
  /** A new session in this folder; nothing runs until its first message. Resolves to its ID. */
  create(request: NewSessionRequest): Promise<string>
  /** A new session you left without a message goes. */
  discard(id: string): Promise<void>
  check(id: string): Promise<CanSend>
  /** Rejects with the reason when it can't (its folder is gone, say). */
  send(request: SendRequest): Promise<void>
  /** Stops the turn; resolves to what was queued, for the composer. */
  interrupt(id: string): Promise<Queued[]>
  unqueue(id: string, queuedId: string): Promise<void>
  answer(id: string, answer: CardAnswer): Promise<void>
  set(id: string, request: SetRequest): Promise<void>
  commands(id: string): Promise<CommandInfo[]>
  /** The files and folders `@` offers, from the session's working folder. */
  files(id: string): Promise<FileListing>
  models(): Promise<ModelChoice[]>
  usage(): Promise<UsageInfo | null>
  /** Who Claude Code is signed in as, from its config (or a session's process). */
  account(): Promise<AccountSummary | null>
  /** What rewinding to before one of your messages can restore. */
  rewindPreview(id: string, messageId: string): Promise<RewindPreview>
  /** Rewinds; resolves to what the code part restored. Rejects with the reason when it can't. */
  rewind(id: string, request: RewindRequest): Promise<CodeRewind | null>
  /** Takes back a conversation rewind nothing was sent after; false when a message has gone since. */
  undoRewind(id: string): Promise<boolean>
  /** Makes a session's missing working folder again; false if it couldn't. */
  recreate(id: string): Promise<boolean>
}

/** Worktree sessions. */
export interface GitApi {
  /** The repository a folder is in, or null. */
  repo(folder: string): Promise<RepoInfo | null>
  /** The worktree a session works in, or null. */
  worktree(id: string): Promise<WorktreeInfo | null>
  /** Lands its branch on the branch it came from. */
  merge(id: string): Promise<MergeResult>
  /** Removes its worktree; one with uncommitted changes only when `force`. Its branch stays. */
  removeWorktree(id: string, force: boolean): Promise<RemoveResult>
}

export interface GloomApi {
  getWindowState(): Promise<WindowState | null>
  onWindowState(listener: (state: WindowState) => void): () => void
  getAppInfo(): Promise<AppInfo>
  /** Runs a command that lives in the main process. */
  runCommand(id: CommandId): Promise<void>
  /** Commands the main process hands to the renderer (accelerators, menu). */
  onCommand(listener: (dispatch: CommandDispatch) => void): () => void
  getUpdateState(): Promise<UpdateState>
  onUpdateState(listener: (state: UpdateState) => void): () => void
  /** Turns the window into the update screen, which downloads and installs the update and restarts Gloom. */
  installUpdate(): Promise<void>
  /** What the update screen shows, or null when it's down. */
  getUpdateScreen(): Promise<UpdateScreen | null>
  onUpdateScreen(listener: (screen: UpdateScreen | null) => void): () => void
  /** Taking over from the previous version: resolves once that one has quit and the app may load. */
  handoverWait(): Promise<void>
  /** The app is drawn under the update screen, which can go. */
  handoverDone(): Promise<void>
  /** The page's localStorage entries from when it was a file:// page, the first time a profile asks; else null. */
  storageToMove(): Promise<[string, string][] | null>
  getLibrary(): Promise<LibrarySnapshot>
  /** Rejects with the reason when the library refuses (e.g. a folder moved inside itself). */
  applyLibrary(op: LibraryOp): Promise<ApplyResult>
  onLibrary(listener: (change: LibraryChange) => void): () => void
  onSessions(listener: (change: SessionsChange) => void): () => void
  /** Opens the session's working folder in Explorer; false if it no longer exists. */
  revealSession(id: string): Promise<boolean>
  copySessionId(id: string): Promise<void>
  /** Opens the session's working folder in the code editor (File Explorer without one); false if it no longer exists. */
  openInEditor(id: string): Promise<boolean>
  /** The code editor a folder opens in, by name ("Visual Studio Code"), or null without one. */
  editorName(): Promise<string | null>
  /** A folder chosen in the system's folder picker, or null. */
  pickFolder(): Promise<string | null>
  /** A page of a session's transcript, newest first; following it sends its changes to `onTranscript`. */
  readTranscript(request: TranscriptRequest): Promise<TranscriptPage>
  /** What a page left in the file: an image's data URL, a long text, a whole diff. */
  transcriptBlob(id: string, ref: BlobRef): Promise<unknown>
  unfollowTranscript(): Promise<void>
  onTranscript(listener: (change: TranscriptChange) => void): () => void
  /** Opens `claude --resume` in a terminal window; with `check`, only says whether it can. */
  resumeSession(id: string, options?: { check?: boolean }): Promise<ResumeResult>
  live: LiveApi
  claude: {
    /** Where claude.exe is and its version; `fresh` asks it again (after an update). */
    info(options?: { fresh?: boolean }): Promise<ClaudeInfo>
    /** Runs `claude auth login` or `claude update` in a terminal window; false when there's no claude to run. */
    inTerminal(what: 'login' | 'update'): Promise<boolean>
    /** A claude.exe chosen in a file picker, or null. */
    locate(): Promise<string | null>
  }
  getSettings(): Promise<Settings>
  /** Changes some settings; resolves to all of them. */
  setSettings(patch: Partial<Settings>): Promise<Settings>
  onSettings(listener: (settings: Settings) => void): () => void
  /** The taskbar badge: how many sessions wait for you, drawn as a PNG. */
  setBadge(count: number, png: string | null): Promise<void>
  /** Where a dropped or picked file lives on disk ('' for one made in the page, a pasted image say). */
  pathForFile(file: File): string
  diff: DiffApi
  terminal: TerminalApi
  git: GitApi
}

/** The diff pane's two sources. */
export interface DiffApi {
  /** Claude's edits in the session, composed per file. */
  session(id: string): Promise<SessionDiff>
  /** What git sees in the session's working folder. */
  tree(id: string): Promise<TreeDiff>
  /** Shows a file in File Explorer (never opens it); false if it's gone. */
  reveal(path: string): Promise<boolean>
}

/** The terminal pane's shells. */
export interface TerminalApi {
  shells(): Promise<ShellInfo[]>
  list(): Promise<TerminalInfo[]>
  /** Rejects with the reason when it can't (the folder is gone, no shell found). */
  create(request: TerminalCreate): Promise<TerminalInfo>
  /** Its recent output, to catch up; from then on `onData` carries the rest. */
  attach(id: string): Promise<TerminalAttach>
  close(id: string): Promise<void>
  input(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  /** Drawn this many characters of what was sent. */
  ack(id: string, chars: number): void
  onData(listener: (data: TerminalData) => void): () => void
  onExit(listener: (exit: TerminalExit) => void): () => void
}

declare global {
  interface Window {
    /** Missing when the renderer runs in a plain browser (layout previews). */
    gloom?: GloomApi
  }
}
