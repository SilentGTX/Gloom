import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type CommandDispatch, type WindowState } from '@shared/ipc'
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
  onCommand: (listener) => subscribe<CommandDispatch>(IPC.dispatchCommand, listener)
}

contextBridge.exposeInMainWorld('gloom', api)
