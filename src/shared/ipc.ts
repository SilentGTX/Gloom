// IPC channel names and payloads shared by main, preload and renderer.
import type { CommandId } from './commands'

export const IPC = {
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
