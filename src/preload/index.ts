import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type CommandDispatch, type LibraryChange, type SessionsChange, type SplashState, type UpdateState, type WindowState } from '@shared/ipc'
import type { GloomApi } from './api'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: GloomApi = {
  getWindowState: () => ipcRenderer.invoke(IPC.windowState),
  onWindowState: (listener) => subscribe<WindowState>(IPC.windowStateChanged, listener),
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  runCommand: (id) => ipcRenderer.invoke(IPC.runCommand, id),
  onCommand: (listener) => subscribe<CommandDispatch>(IPC.dispatchCommand, listener),
  getUpdateState: () => ipcRenderer.invoke(IPC.updateState),
  onUpdateState: (listener) => subscribe<UpdateState>(IPC.updateStateChanged, listener),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  onSplashState: (listener) => subscribe<SplashState>(IPC.splashState, listener),
  getLibrary: () => ipcRenderer.invoke(IPC.library),
  applyLibrary: (op) => ipcRenderer.invoke(IPC.libraryApply, op),
  onLibrary: (listener) => subscribe<LibraryChange>(IPC.libraryChanged, listener),
  onSessions: (listener) => subscribe<SessionsChange>(IPC.sessionsChanged, listener),
  revealSession: (id) => ipcRenderer.invoke(IPC.revealSession, id),
  copySessionId: (id) => ipcRenderer.invoke(IPC.copySessionId, id),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder)
}

contextBridge.exposeInMainWorld('gloom', api)
