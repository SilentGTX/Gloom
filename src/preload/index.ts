import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type BrowserState, type CommandDispatch, type CustomPet, type PetView, type RoutineList, type SetupState, type LibraryChange, type SessionsChange, type TranscriptChange, type UpdateScreen, type UpdateState, type WindowState } from '@shared/ipc'
import type { LiveEvent, Settings } from '@shared/live'
import type { TerminalData, TerminalExit, TerminalInfo } from '@shared/terminal'
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
  unfollowTranscript: (id) => ipcRenderer.invoke(IPC.unfollowTranscript, id),
  onTranscript: (listener) => subscribe<TranscriptChange>(IPC.transcriptChanged, listener),
  resumeSession: (id, options) => ipcRenderer.invoke(IPC.resumeSession, id, options),
  exportSession: (id) => ipcRenderer.invoke(IPC.exportSession, id),
  readFile: (id, path) => ipcRenderer.invoke(IPC.fileRead, id, path),
  searchTranscripts: (query, includeArchived) => ipcRenderer.invoke(IPC.searchTranscripts, query, includeArchived),
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
    toggleMcp: (id, name, enabled) => ipcRenderer.invoke(IPC.liveToggleMcp, id, name, enabled),
    reconnectMcp: (id, name) => ipcRenderer.invoke(IPC.liveReconnectMcp, id, name),
    stopTask: (id, taskId) => ipcRenderer.invoke(IPC.liveStopTask, id, taskId),
    commands: (id) => ipcRenderer.invoke(IPC.liveCommands, id),
    files: (id) => ipcRenderer.invoke(IPC.liveFiles, id),
    models: () => ipcRenderer.invoke(IPC.liveModels),
    usage: () => ipcRenderer.invoke(IPC.liveUsage),
    account: () => ipcRenderer.invoke(IPC.liveAccount),
    defaults: () => ipcRenderer.invoke(IPC.liveDefaults),
    refreshUsage: (maxAgeMs) => ipcRenderer.invoke(IPC.liveRefreshUsage, maxAgeMs),
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
  setup: {
    check: () => ipcRenderer.invoke(IPC.setupCheck),
    install: () => ipcRenderer.invoke(IPC.setupInstall),
    login: () => ipcRenderer.invoke(IPC.setupLogin),
    code: (code) => ipcRenderer.invoke(IPC.setupCode, code),
    cancel: () => ipcRenderer.invoke(IPC.setupCancel),
    onChange: (listener) => subscribe<SetupState>(IPC.setupChanged, listener)
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
    onExit: (listener) => subscribe<TerminalExit>(IPC.terminalExit, listener),
    onOpened: (listener) => subscribe<TerminalInfo>(IPC.terminalOpened, listener)
  },
  widget: (id, code, title, theme) => ipcRenderer.invoke(IPC.widgetServe, id, code, title, theme),
  popOut: (pane, id) => ipcRenderer.invoke(IPC.popOut, pane, id),
  pet: {
    report: (cards) => ipcRenderer.send(IPC.petReport, cards),
    current: () => ipcRenderer.invoke(IPC.petCurrent),
    onView: (listener) => subscribe<PetView>(IPC.petView, listener),
    hover: (over) => ipcRenderer.send(IPC.petHover, over),
    drag: (phase) => ipcRenderer.send(IPC.petDrag, phase),
    open: () => ipcRenderer.send(IPC.petOpen),
    action: (what, sessionId) => ipcRenderer.send(IPC.petAction, what, sessionId)
  },
  pets: {
    list: () => ipcRenderer.invoke(IPC.petsList),
    onChanged: (listener) => subscribe<CustomPet[]>(IPC.petsChanged, listener),
    create: (name, idea) => ipcRenderer.invoke(IPC.petsCreate, name, idea),
    remove: (id) => ipcRenderer.invoke(IPC.petsRemove, id),
    reveal: () => ipcRenderer.invoke(IPC.petsReveal)
  },
  cloud: {
    start: (folder, task) => ipcRenderer.invoke(IPC.cloudStart, folder, task),
    list: () => ipcRenderer.invoke(IPC.cloudList)
  },
  routines: {
    list: () => ipcRenderer.invoke(IPC.routinesList),
    save: (routine) => ipcRenderer.invoke(IPC.routinesSave, routine),
    remove: (id) => ipcRenderer.invoke(IPC.routinesDelete, id),
    run: (id) => ipcRenderer.invoke(IPC.routinesRun, id),
    onChanged: (listener) => subscribe<RoutineList>(IPC.routinesChanged, listener)
  },
  pr: {
    status: (id, maxAgeMs) => ipcRenderer.invoke(IPC.prStatus, id, maxAgeMs),
    bind: (id, url) => ipcRenderer.invoke(IPC.prBind, id, url),
    merge: (id, method) => ipcRenderer.invoke(IPC.prMerge, id, method),
    autoMerge: (id, enabled, method) => ipcRenderer.invoke(IPC.prAutoMerge, id, enabled, method),
    monitor: (id, switches) => ipcRenderer.invoke(IPC.prMonitor, id, switches)
  },
  browser: {
    show: (id, bounds) => ipcRenderer.invoke(IPC.browserShow, id, bounds),
    hide: () => ipcRenderer.invoke(IPC.browserHide),
    navigate: (id, address) => ipcRenderer.invoke(IPC.browserNavigate, id, address),
    go: (id, where) => ipcRenderer.invoke(IPC.browserGo, id, where),
    state: (id) => ipcRenderer.invoke(IPC.browserState, id),
    onChanged: (listener) => subscribe<BrowserState>(IPC.browserChanged, listener),
    onOpen: (listener) => subscribe<string>(IPC.browserOpen, listener),
    previews: (id) => ipcRenderer.invoke(IPC.previewList, id),
    startPreview: (id, name) => ipcRenderer.invoke(IPC.previewStart, id, name),
    stopPreview: (serverId) => ipcRenderer.invoke(IPC.previewStop, serverId)
  },
  side: {
    start: (taskId) => ipcRenderer.invoke(IPC.sideStart, taskId),
    dismiss: (sessionId, taskId) => ipcRenderer.invoke(IPC.sideDismiss, sessionId, taskId),
    pending: (taskId) => ipcRenderer.invoke(IPC.sidePending, taskId)
  }
}

contextBridge.exposeInMainWorld('gloom', api)
