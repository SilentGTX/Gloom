import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type CommandDispatch, type LibraryChange, type SessionsChange, type TranscriptChange, type UpdateScreen, type UpdateState, type WindowState } from '@shared/ipc'
import type { LiveEvent, Settings } from '@shared/live'
import type { TerminalData, TerminalExit } from '@shared/terminal'
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
  getUpdateScreen: () => ipcRenderer.invoke(IPC.updateScreen),
  onUpdateScreen: (listener) => subscribe<UpdateScreen | null>(IPC.updateScreenChanged, listener),
  handoverWait: () => ipcRenderer.invoke(IPC.handoverWait),
  handoverDone: () => ipcRenderer.invoke(IPC.handoverDone),
  storageToMove: () => ipcRenderer.invoke(IPC.storageToMove),
  getLibrary: () => ipcRenderer.invoke(IPC.library),
  applyLibrary: (op) => ipcRenderer.invoke(IPC.libraryApply, op),
  onLibrary: (listener) => subscribe<LibraryChange>(IPC.libraryChanged, listener),
  onSessions: (listener) => subscribe<SessionsChange>(IPC.sessionsChanged, listener),
  revealSession: (id) => ipcRenderer.invoke(IPC.revealSession, id),
  copySessionId: (id) => ipcRenderer.invoke(IPC.copySessionId, id),
  openInEditor: (id) => ipcRenderer.invoke(IPC.openInEditor, id),
  editorName: () => ipcRenderer.invoke(IPC.editorName),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  readTranscript: (request) => ipcRenderer.invoke(IPC.readTranscript, request),
  transcriptBlob: (id, ref) => ipcRenderer.invoke(IPC.transcriptBlob, id, ref),
  unfollowTranscript: () => ipcRenderer.invoke(IPC.unfollowTranscript),
  onTranscript: (listener) => subscribe<TranscriptChange>(IPC.transcriptChanged, listener),
  resumeSession: (id, options) => ipcRenderer.invoke(IPC.resumeSession, id, options),
  live: {
    list: () => ipcRenderer.invoke(IPC.liveList),
    snapshot: (id) => ipcRenderer.invoke(IPC.liveSnapshot, id),
    onEvent: (listener) => subscribe<LiveEvent>(IPC.liveEvent, listener),
    create: (request) => ipcRenderer.invoke(IPC.liveCreate, request),
    discard: (id) => ipcRenderer.invoke(IPC.liveDiscard, id),
    check: (id) => ipcRenderer.invoke(IPC.liveCheck, id),
    send: (request) => ipcRenderer.invoke(IPC.liveSend, request),
    interrupt: (id) => ipcRenderer.invoke(IPC.liveInterrupt, id),
    unqueue: (id, queuedId) => ipcRenderer.invoke(IPC.liveUnqueue, id, queuedId),
    answer: (id, answer) => ipcRenderer.invoke(IPC.liveAnswer, id, answer),
    set: (id, request) => ipcRenderer.invoke(IPC.liveSet, id, request),
    commands: (id) => ipcRenderer.invoke(IPC.liveCommands, id),
    files: (id) => ipcRenderer.invoke(IPC.liveFiles, id),
    models: () => ipcRenderer.invoke(IPC.liveModels),
    usage: () => ipcRenderer.invoke(IPC.liveUsage),
    account: () => ipcRenderer.invoke(IPC.liveAccount),
    rewindPreview: (id, messageId) => ipcRenderer.invoke(IPC.liveRewindPreview, id, messageId),
    rewind: (id, request) => ipcRenderer.invoke(IPC.liveRewind, id, request),
    undoRewind: (id) => ipcRenderer.invoke(IPC.liveRewindUndo, id),
    recreate: (id) => ipcRenderer.invoke(IPC.liveRecreate, id)
  },
  git: {
    repo: (folder) => ipcRenderer.invoke(IPC.gitRepo, folder),
    worktree: (id) => ipcRenderer.invoke(IPC.gitWorktree, id),
    merge: (id) => ipcRenderer.invoke(IPC.gitMerge, id),
    removeWorktree: (id, force) => ipcRenderer.invoke(IPC.gitRemoveWorktree, id, force)
  },
  claude: {
    info: (options) => ipcRenderer.invoke(IPC.claudeInfo, options?.fresh === true),
    inTerminal: (what) => ipcRenderer.invoke(IPC.claudeTerminal, what),
    locate: () => ipcRenderer.invoke(IPC.claudeLocate)
  },
  getSettings: () => ipcRenderer.invoke(IPC.settings),
  setSettings: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
  onSettings: (listener) => subscribe<Settings>(IPC.settingsChanged, listener),
  setBadge: (count, png) => ipcRenderer.invoke(IPC.setBadge, count, png),
  pathForFile: (file) => webUtils.getPathForFile(file),
  diff: {
    session: (id) => ipcRenderer.invoke(IPC.diffSession, id),
    tree: (id) => ipcRenderer.invoke(IPC.diffTree, id),
    reveal: (path) => ipcRenderer.invoke(IPC.revealFile, path)
  },
  terminal: {
    shells: () => ipcRenderer.invoke(IPC.terminalShells),
    list: () => ipcRenderer.invoke(IPC.terminalList),
    create: (request) => ipcRenderer.invoke(IPC.terminalCreate, request),
    attach: (id) => ipcRenderer.invoke(IPC.terminalAttach, id),
    close: (id) => ipcRenderer.invoke(IPC.terminalClose, id),
    input: (id, data) => ipcRenderer.send(IPC.terminalInput, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.terminalResize, id, cols, rows),
    ack: (id, chars) => ipcRenderer.send(IPC.terminalAck, id, chars),
    onData: (listener) => subscribe<TerminalData>(IPC.terminalData, listener),
    onExit: (listener) => subscribe<TerminalExit>(IPC.terminalExit, listener)
  }
}

contextBridge.exposeInMainWorld('gloom', api)
