import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { existsSync, writeFileSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { findCommand, type CommandId } from '@shared/commands'
import type { TreeDiff } from '@shared/diff'
import { IPC, type AppInfo, type ResumeResult, type TerminalCreate } from '@shared/ipc'
import { displayTitle } from '@shared/library'
import { parseRef, type Cursor } from '@shared/transcript'
import { attend, setBadge } from './attention'
import { claudeInfo } from './claude/binary'
import { parseAnswer, parseNewSession, parseSend, parseSet, sessionId } from './claude/parse'
import { Sessions } from './claude/sessions'
import { knownModels, loadSettings, onSettings, settings, updateSettings } from './claude/settings'
import { installApplicationMenu, runCommand } from './commands'
import { parseTakeover, takeOver } from './handover'
import { LibraryService } from './library/service'
import { runPtySmoke } from './smoke'
import { workingTreeDiff } from './git/diff'
import { Terminals } from './pty/terminals'
import { claudeInTerminal, resumeInTerminal } from './terminal'
import { deferUpdatesWhile, finishStarting, installPending, launchCheck, onUpdateScreen, sessionsQuiet, showStarting, updateScreen } from './update-screen'
import { checkOnFocus, onUpdateState, startBackgroundChecks, updateState } from './updater'
import { markStarted, removeOldVersions, startNewerVersion } from './versions'
import { createMainWindow, rendererUrl, windowState } from './window'

/** Started by the version it takes the window over from (handover.ts). */
const takeover = parseTakeover(process.argv)
/** Older versions are removed once this one has settled in. */
const TIDY_AFTER_MS = 10_000

// `Gloom.exe --smoke-pty[=<file>]` runs the packaging smoke test headless and
// exits with its result, so an installed build can be checked from a script.
const smokeArg = process.argv.find((a) => a === '--smoke-pty' || a.startsWith('--smoke-pty='))
if (smokeArg) {
  void app.whenReady().then(async () => {
    const result = await runPtySmoke()
    const file = smokeArg.includes('=') ? smokeArg.slice('--smoke-pty='.length) : join(app.getPath('temp'), 'gloom-smoke.json')
    writeFileSync(file, JSON.stringify({ ...result, version: app.getVersion(), packaged: app.isPackaged }, null, 2))
    app.exit(result.ok ? 0 : 1)
  })
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else if (!takeover && startNewerVersion()) {
  // A newer version installed beside this copy runs instead (versions.ts).
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  /** IPC from anything but our own page's main frame is ignored. */
  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent) =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame && event.senderFrame.url.startsWith(rendererUrl())

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.silentgtx.gloom')
    loadSettings()
    installApplicationMenu()

    ipcMain.handle(IPC.windowState, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const win = BrowserWindow.fromWebContents(event.sender)
      return win ? windowState(win) : null
    })
    ipcMain.handle(IPC.appInfo, (event): AppInfo => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const windowsBuild = process.platform === 'win32' ? Number(release().split('.')[2]) || 0 : 0
      return { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, windowsBuild }
    })
    ipcMain.handle(IPC.runCommand, (event, id: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      if (typeof id !== 'string' || !findCommand(id)) throw new Error(`unknown command: ${String(id)}`)
      runCommand(id as CommandId, BrowserWindow.fromWebContents(event.sender), false)
    })
    ipcMain.handle(IPC.updateState, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      return updateState()
    })
    ipcMain.handle(IPC.installUpdate, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      void installPending()
    })
    ipcMain.handle(IPC.updateScreen, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      return updateScreen()
    })
    onUpdateState((state) => mainWindow?.webContents.send(IPC.updateStateChanged, state))
    onUpdateScreen((screen) => mainWindow?.webContents.send(IPC.updateScreenChanged, screen))

    const library = new LibraryService({
      library: (change) => mainWindow?.webContents.send(IPC.libraryChanged, change),
      sessions: (change) => mainWindow?.webContents.send(IPC.sessionsChanged, change),
      transcript: (change) => mainWindow?.webContents.send(IPC.transcriptChanged, change)
    })
    // Taking over, the old version's library runs until it has quit.
    if (!takeover) library.start()
    app.on('before-quit', () => library.stop())
    ipcMain.handle(IPC.library, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      return library.snapshot()
    })
    ipcMain.handle(IPC.libraryApply, (event, op: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      return library.apply(op)
    })
    ipcMain.handle(IPC.revealSession, async (event, id: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const cwd = typeof id === 'string' ? library.session(id)?.cwd : undefined
      if (!cwd || library.session(id as string)?.remote || !existsSync(cwd)) return false
      return (await shell.openPath(cwd)) === ''
    })
    ipcMain.handle(IPC.copySessionId, (event, id: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      if (typeof id === 'string' && library.session(id)) clipboard.writeText(id)
    })
    ipcMain.handle(IPC.readTranscript, (event, request: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const { id, cursor, follow } = (request ?? {}) as Record<string, unknown>
      if (typeof id !== 'string') throw new Error('bad transcript request')
      const c = cursor as Cursor | null
      const valid = c === null || (typeof c === 'object' && Number.isSafeInteger(c.offset) && c.offset >= 0 && typeof c.want === 'string' && c.want.length < 200)
      if (!valid) throw new Error('bad transcript cursor')
      return library.readTranscript(id, c, follow === true)
    })
    ipcMain.handle(IPC.transcriptBlob, (event, id: unknown, ref: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const at = parseRef(ref)
      if (typeof id !== 'string' || !at) throw new Error('bad transcript reference')
      // A line the stream showed before the file had it: no length, read from memory.
      return at.length === 0 ? sessions.blob(id, ref as string) : library.readBlob(id, ref as string)
    })
    ipcMain.handle(IPC.unfollowTranscript, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      library.unfollow()
    })
    ipcMain.handle(IPC.resumeSession, (event, id: unknown, options: unknown): ResumeResult => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const session = typeof id === 'string' ? library.session(id) : undefined
      if (!session) return { ok: false, reason: 'That session’s transcript is gone.' }
      return resumeInTerminal(session, { check: (options as { check?: unknown } | undefined)?.check === true })
    })
    ipcMain.handle(IPC.pickFolder, async (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = { title: 'Choose a Working Folder', properties: ['openDirectory' as const] }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })

    // ─── Sessions Gloom runs ───────────────────────────────────────────────
    const handle = (channel: string, run: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
      ipcMain.handle(channel, (event, ...args) => {
        if (!trusted(event)) throw new Error('untrusted sender')
        return run(event, ...args)
      })
    const titleOf = (id: string) => {
      const meta = library.session(id)
      return meta ? displayTitle(meta, library.entry(id)) : 'New Session'
    }
    const sessions = new Sessions(
      {
        event: (event) => mainWindow?.webContents.send(IPC.liveEvent, event),
        attention: (id, kind, card) => attend(mainWindow, id, titleOf(id), kind, card),
        quiet: () => sessionsQuiet()
      },
      (id) => library.session(id)
    )
    deferUpdatesWhile(() => sessions.busy())
    app.on('before-quit', () => sessions.closeAll())
    handle(IPC.liveList, () => sessions.list())
    handle(IPC.liveSnapshot, (_event, id) => sessions.snapshot(sessionId(id)))
    handle(IPC.liveCreate, (_event, raw) => {
      const request = parseNewSession(raw)
      if (!existsSync(request.cwd)) throw new Error('That folder doesn’t exist.')
      return sessions.create(request)
    })
    handle(IPC.liveDiscard, (_event, id) => sessions.discard(sessionId(id)))
    handle(IPC.liveCheck, (_event, id) => sessions.check(sessionId(id)))
    handle(IPC.liveSend, (_event, raw) => {
      const request = parseSend(raw)
      sessions.send(request.id, request.text, request.images)
    })
    handle(IPC.liveInterrupt, (_event, id) => sessions.interrupt(sessionId(id)))
    handle(IPC.liveUnqueue, (_event, id, queuedId) => sessions.unqueue(sessionId(id), String(queuedId)))
    handle(IPC.liveAnswer, (_event, id, answer) => sessions.answer(sessionId(id), parseAnswer(answer)))
    handle(IPC.liveSet, (_event, id, request) => sessions.set(sessionId(id), parseSet(request)))
    handle(IPC.liveCommands, (_event, id) => sessions.commands(sessionId(id)))
    handle(IPC.liveModels, () => knownModels())
    handle(IPC.liveUsage, () => sessions.usage())
    handle(IPC.claudeInfo, (_event, fresh) => claudeInfo({ fresh: fresh === true }))
    handle(IPC.claudeTerminal, (_event, what) => (what === 'login' || what === 'update' ? claudeInTerminal(what) : false))
    handle(IPC.claudeLocate, async (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const options = { title: 'Choose claude.exe', properties: ['openFile' as const], filters: [{ name: 'Claude Code', extensions: ['exe'] }] }
      const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })
    handle(IPC.settings, () => settings())
    handle(IPC.settingsSet, (_event, patch) => updateSettings(patch))
    onSettings((next) => mainWindow?.webContents.send(IPC.settingsChanged, next))
    handle(IPC.setBadge, (_event, count, png) =>
      setBadge(mainWindow, typeof count === 'number' ? count : 0, typeof png === 'string' && png.startsWith('data:image/png;base64,') ? png : null)
    )

    // ─── The diff pane ─────────────────────────────────────────────────────
    handle(IPC.diffSession, (_event, id) => {
      const sid = sessionId(id)
      return library.sessionEdits(sid, sessions.cwdOf(sid))
    })
    handle(IPC.diffTree, (_event, id): TreeDiff | Promise<TreeDiff> => {
      const sid = sessionId(id)
      if (library.session(sid)?.remote) return { kind: 'remote' }
      const cwd = sessions.cwdOf(sid)
      return cwd ? workingTreeDiff(cwd) : { kind: 'missing-folder' }
    })
    handle(IPC.revealFile, (_event, path) => {
      // Shown in its folder, never opened: the path came from the model.
      if (typeof path !== 'string' || !isAbsolute(path) || !existsSync(path)) return false
      shell.showItemInFolder(path)
      return true
    })

    // ─── The terminal pane ─────────────────────────────────────────────────
    const terminals = new Terminals({
      data: (data) => mainWindow?.webContents.send(IPC.terminalData, data),
      exit: (exit) => mainWindow?.webContents.send(IPC.terminalExit, exit)
    })
    app.on('before-quit', () => terminals.closeAll())
    const size = (v: unknown, max: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? Math.min(v, max) : 80)
    handle(IPC.terminalShells, () => terminals.shells())
    handle(IPC.terminalList, () => terminals.list())
    handle(IPC.terminalCreate, (_event, raw) => {
      const request = (raw ?? {}) as Partial<TerminalCreate>
      const sid = request.sessionId == null ? null : sessionId(request.sessionId)
      const cwd = (sid && sessions.cwdOf(sid)) || homedir()
      return terminals.create(cwd, settings().shell, size(request.cols, 1000), size(request.rows, 500))
    })
    handle(IPC.terminalAttach, (_event, id) => terminals.attach(String(id)))
    handle(IPC.terminalClose, (_event, id) => terminals.close(String(id)))
    const on = (channel: string, run: (...args: unknown[]) => void) =>
      ipcMain.on(channel, (event, ...args) => {
        if (trusted(event)) run(...args)
      })
    on(IPC.terminalInput, (id, data) => typeof data === 'string' && data.length < 1_000_000 && terminals.input(String(id), data))
    on(IPC.terminalResize, (id, cols, rows) => terminals.resize(String(id), size(cols, 1000), size(rows, 500)))
    on(IPC.terminalAck, (id, chars) => typeof chars === 'number' && terminals.ack(String(id), chars))

    // Taking over from the previous version: this window opens on top of its
    // window, on the update screen, and the app loads once that one has quit.
    // Otherwise the update screen checks for an update as the window opens; it
    // goes up first, so the window's first paint is already the screen.
    let handedOver: Promise<void> = Promise.resolve()
    if (takeover) {
      showStarting()
      let shown!: () => void
      handedOver = new Promise<void>((resolve) => (shown = resolve))
        .then(() => takeOver(takeover))
        .then(() => {
          library.start()
          markStarted()
          mainWindow?.focus()
        })
      mainWindow = createMainWindow({ handover: true, onShown: () => shown() })
    } else {
      void launchCheck()
      mainWindow = createMainWindow()
      mainWindow.once('ready-to-show', markStarted)
    }
    ipcMain.handle(IPC.handoverWait, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      return handedOver
    })
    ipcMain.handle(IPC.handoverDone, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      finishStarting()
    })
    mainWindow.on('closed', () => {
      mainWindow = null
    })
    mainWindow.on('focus', checkOnFocus)
    mainWindow.on('focus', () => mainWindow?.flashFrame(false))
    // Quitting mid-turn stops Claude where it is: say so first.
    let quitAnyway = false
    mainWindow.on('close', (event) => {
      const win = mainWindow
      // The end-to-end tests close the app mid-turn on purpose (development builds only).
      const testing = !app.isPackaged && process.env.GLOOM_QUIT_WITHOUT_ASKING === '1'
      if (quitAnyway || testing || !win || !sessions.busy()) return
      event.preventDefault()
      const working = sessions.list().filter((s) => s.state === 'starting' || s.state === 'working' || s.state === 'waiting').length
      void dialog
        .showMessageBox(win, {
          type: 'warning',
          message: 'Quit Gloom while Claude is working?',
          detail: `${working === 1 ? 'A session stops' : `${working} sessions stop`} where ${working === 1 ? 'it is' : 'they are'}. Send ${working === 1 ? 'it' : 'one'} a message later to pick up from there.`,
          buttons: ['Quit', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          noLink: true
        })
        .then(({ response }) => {
          if (response !== 0) return
          quitAnyway = true
          app.quit()
        })
    })
    startBackgroundChecks()
    if (app.isPackaged) void handedOver.then(() => setTimeout(() => void removeOldVersions(), TIDY_AFTER_MS))
  })

  app.on('window-all-closed', () => app.quit())
}
