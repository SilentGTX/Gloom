// The typed `window.gloom` bridge, as the renderer sees it.
import type { CommandId } from '../shared/commands'
import type {
  AppInfo,
  ApplyResult,
  CommandDispatch,
  BrowserState,
  ExportResult,
  FileRead,
  PreviewList,
  PreviewServerInfo,
  RoutineList,
  TranscriptSearch,
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
import type { PrStatus } from '../shared/pr'
import type { CustomPet, PetAction, PetState, PetView } from '../shared/ipc'
import type { Routine } from '../shared/routines'

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
  /** Turns one of a running session's MCP servers off or on; rejects with the reason when it can't. */
  toggleMcp(id: string, name: string, enabled: boolean): Promise<void>
  /** Connects one of a running session's MCP servers again. */
  reconnectMcp(id: string, name: string): Promise<void>
  /** Stops one of a session's background tasks. */
  stopTask(id: string, taskId: string): Promise<void>
  commands(id: string): Promise<CommandInfo[]>
  /** The files and folders `@` offers, from the session's working folder. */
  files(id: string): Promise<FileListing>
  models(): Promise<ModelChoice[]>
  usage(): Promise<UsageInfo | null>
  /** Who Claude Code is signed in as, from its config (or a session's process). */
  account(): Promise<AccountSummary | null>
  /** Asks for your plan's usage when what's known is older than this; the answer comes as a `usage` event. */
  refreshUsage(maxAgeMs?: number): Promise<void>
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
  /** Stops reporting a transcript's changes (every one, without an ID). */
  unfollowTranscript(id?: string): Promise<void>
  onTranscript(listener: (change: TranscriptChange) => void): () => void
  /** Opens `claude --resume` in a terminal window; with `check`, only says whether it can. */
  resumeSession(id: string, options?: { check?: boolean }): Promise<ResumeResult>
  /** Writes a zip of the session's transcripts to Downloads; rejects with the reason when it can't. */
  exportSession(id: string): Promise<ExportResult>
  /** A file inside the session's folders (its working folder and the ones added to it), for the File pane. */
  readFile(id: string, path: string): Promise<FileRead>
  /** Sessions whose conversations say `query` (2 characters or more), newest first. */
  searchTranscripts(query: string, includeArchived: boolean): Promise<TranscriptSearch>
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
  /** Cloud sessions (claude --cloud): Gloom starts them and opens them on claude.ai. */
  cloud: {
    start(folder: string, task: string): Promise<{ url: string; title: string; cwd: string; created: number }>
    list(): Promise<{ url: string; title: string; cwd: string; created: number }[]>
  }
  /** Routines: prompts Gloom runs on a schedule, each in a new session. */
  routines: {
    list(): Promise<RoutineList>
    /** Adds or changes a routine; rejects with what's wrong with it. */
    save(routine: Partial<Routine>): Promise<Routine>
    remove(id: string): Promise<boolean>
    /** Runs it now; resolves to the new session's ID. */
    run(id: string): Promise<string>
    onChanged(listener: (list: RoutineList) => void): () => void
  }
  /** The session's pull request (through gh): read it, link one, merge, auto-merge, and its monitor. */
  pr: {
    status(id: string, maxAgeMs?: number): Promise<PrStatus | null>
    bind(id: string, url: string | null): Promise<PrStatus | null>
    merge(id: string, method: 'squash' | 'merge' | 'rebase'): Promise<void>
    autoMerge(id: string, enabled: boolean, method: 'squash' | 'merge' | 'rebase'): Promise<void>
    monitor(id: string, switches: { autoFix?: boolean; autoArchive?: boolean }): Promise<void>
  }
  /** Opens a pane (diff, terminal, file, plan, tasks, browser, artifacts) in a window of its own, for the session. */
  popOut(pane: 'diff' | 'terminal' | 'file' | 'plan' | 'tasks' | 'browser' | 'artifacts' | 'pr', id: string): Promise<void>
  /** The pet's window, on top of every app (main/pet.ts). */
  pet: {
    /** From the main window: what the pet should show. */
    report(state: PetState): void
    /** From the pet window: what to show, now and as it changes. */
    current(): Promise<PetView>
    onView(listener: (view: PetView) => void): () => void
    /** The pointer is over the pet or its bubble, so the window takes clicks there. */
    hover(over: boolean): void
    /** Dragging the pet: main moves its window with the cursor. */
    drag(phase: 'start' | 'move' | 'end'): void
    /** The pet was clicked: Gloom minimizes when it is in front, else comes forward. */
    open(): void
    /** A button on the pet's toolbar. */
    action(what: PetAction): void
  }
  /** The pets you created, in Gloom's pets folder (main/pets.ts). */
  pets: {
    list(): Promise<CustomPet[]>
    onChanged(listener: (pets: CustomPet[]) => void): () => void
    /** Starts a Claude Code session that draws a new pet; its ID. */
    create(name: string, idea: string): Promise<string>
    remove(id: string): Promise<void>
    /** Shows the pets folder in Explorer. */
    reveal(): Promise<string>
  }
  /** An inline widget's page (show_widget): the URL its sandboxed frame loads. */
  widget(id: string, code: string, title: string, theme: { dark: boolean; accent: string }): Promise<string>
  /** The Browser pane: a page per session, laid over the pane's place; and the project's dev servers. */
  browser: {
    show(id: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>
    hide(): Promise<void>
    navigate(id: string, address: string): Promise<BrowserState>
    go(id: string, where: 'back' | 'forward' | 'reload'): Promise<void>
    state(id: string): Promise<BrowserState>
    onChanged(listener: (state: BrowserState) => void): () => void
    /** Claude is using a session's Browser pane. */
    onOpen(listener: (sessionId: string) => void): () => void
    previews(id: string): Promise<PreviewList>
    startPreview(id: string, name: string): Promise<PreviewServerInfo>
    stopPreview(serverId: string): Promise<void>
  }
  /** Sessions Claude proposed or offered (side sessions). */
  side: {
    /** Starts a proposal; resolves to the new session's ID. Rejects with the reason when it can't. */
    start(taskId: string): Promise<string>
    dismiss(sessionId: string, taskId: string): Promise<string>
    pending(taskId: string): Promise<boolean>
  }
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
  /** A terminal Claude opened, for the pane to list. */
  onOpened(listener: (info: TerminalInfo) => void): () => void
}

declare global {
  interface Window {
    /** Missing when the renderer runs in a plain browser (layout previews). */
    gloom?: GloomApi
  }
}
