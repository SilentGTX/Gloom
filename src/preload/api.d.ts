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
  SplashState,
  TranscriptChange,
  TranscriptRequest,
  UpdateState,
  WindowState
} from '../shared/ipc'
import type { LibraryOp } from '../shared/library'
import type { BlobRef, TranscriptPage } from '../shared/transcript'

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
  /** Hands over to the update window, which downloads and installs the update and restarts Gloom. */
  installUpdate(): Promise<void>
  /** The update window's page listens here for what to show. */
  onSplashState(listener: (state: SplashState) => void): () => void
  getLibrary(): Promise<LibrarySnapshot>
  /** Rejects with the reason when the library refuses (e.g. a folder moved inside itself). */
  applyLibrary(op: LibraryOp): Promise<ApplyResult>
  onLibrary(listener: (change: LibraryChange) => void): () => void
  onSessions(listener: (change: SessionsChange) => void): () => void
  /** Opens the session's working folder in Explorer; false if it no longer exists. */
  revealSession(id: string): Promise<boolean>
  copySessionId(id: string): Promise<void>
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
}

declare global {
  interface Window {
    /** Missing when the renderer runs in a plain browser (layout previews). */
    gloom?: GloomApi
  }
}
