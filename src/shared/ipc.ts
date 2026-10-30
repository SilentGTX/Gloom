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
  /** invoke: quit, install the downloaded update silently and relaunch */
  installUpdate: 'update:install'
} as const

export interface UpdateState {
  /** 'disabled' in development builds. */
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'disabled'
  current: string
  /** The newer version, once one is found. */
  available?: string
  /** 0..1 while downloading. */
  progress?: number
  error?: string
}

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
