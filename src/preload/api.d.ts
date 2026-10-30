// The typed `window.gloom` bridge, as the renderer sees it.
import type { CommandId } from '../shared/commands'
import type { AppInfo, CommandDispatch, SplashState, UpdateState, WindowState } from '../shared/ipc'

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
}

declare global {
  interface Window {
    /** Missing when the renderer runs in a plain browser (layout previews). */
    gloom?: GloomApi
  }
}
