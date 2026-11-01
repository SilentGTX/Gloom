import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { findCommand, type CommandId } from '@shared/commands'
import type { TreeDiff } from '@shared/diff'
import type { RemoveResult } from '@shared/git'
import { IPC, type AppInfo, type ResumeResult, type TerminalCreate } from '@shared/ipc'
import { displayTitle, inactiveSessions } from '@shared/library'
import { isMode, type FileListing, type LiveEvent } from '@shared/live'
import { parseRef, type Cursor } from '@shared/transcript'
import { attend, reveal, setBadge } from './attention'
import { claudeInfo } from './claude/binary'
import { parseAnswer, parseNewSession, parseRewind, parseSend, parseSet, serverName, sessionId } from './claude/parse'
import { Sessions } from './claude/sessions'
import { knownModels, loadSettings, onSettings, settings, updateSettings } from './claude/settings'
import { installApplicationMenu, runCommand } from './commands'
import { exportSession } from './export'
import { readSessionFile } from './files'
import { listFiles } from './files'
import { parseTakeover, takeOver } from './handover'
import { claudeDir, LibraryService } from './library/service'
import { connectionFolder, projectFolder } from '@shared/ssh'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { KeepAwake } from './power'
import { Browsers } from './browser'
import { PreviewServers, readLaunch } from './preview'
import { PrService } from './git/pr-service'
import { Routines } from './routines'
import { cloudSessions, loadCloud, startCloud } from './cloud'
import { mergePr, setAutoMerge } from './git/pr'
import { registerAppScheme, serveApp, serveWidget } from './protocol'
import { widgetPage } from './widget-page'
import { gloomServer, type SessionRow, type ToolHost } from './claude/gloom-tools'
import { SideSessions } from './claude/side-sessions'
import type { PlanStep } from '@shared/plan'
import { folderKey } from '@shared/terminal'
import { runPtySmoke } from './smoke'
import { storageToMove } from './storage'
import { workingTreeDiff } from './git/diff'
import { createWorktree, mergeWorktree, recreateFolder, removeWorktree, repoInfo, sessionWorktree, worktreeInfo } from './git/worktrees'
import { Terminals } from './pty/terminals'
import { claudeInTerminal, resumeInTerminal } from './terminal'
import { deferUpdatesWhile, finishStarting, installPending, launchCheck, onUpdateScreen, sessionsQuiet, showStarting, updateScreen } from './update-screen'
import { checkOnFocus, onUpdateState, startBackgroundChecks, updateState } from './updater'
import { markStarted, removeOldVersions, startNewerVersion } from './versions'
import { startPet } from './pet'
import { Pets } from './pets'
import { createMainWindow, createPopOutWindow, isRendererUrl, POP_OUT_PANES, windowState, type PopOutPane } from './window'

/** Started by the version it takes the window over from (handover.ts). */
const takeover = parseTakeover(process.argv)
// The page's own scheme has to be known before the app is ready.
registerAppScheme()
/** Older versions are removed once this one has settled in. */
const TIDY_AFTER_MS = 10_000
/** Inactive sessions are looked for this long after launch, then every hour. */
const ARCHIVE_FIRST_MS = 60_000
const ARCHIVE_EVERY_MS = 60 * 60 * 1000

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

  /** Gloom's own windows: the main one and any pane popped out into a window of its own. */
  const appWindows = () => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && isRendererUrl(w.webContents.getURL()))
  const broadcast = (channel: string, payload: unknown) => {
    for (const w of appWindows()) w.webContents.send(channel, payload)
  }

  /** IPC from anything but our own page's main frame is ignored. */
  const trusted = (event: IpcMainInvokeEvent | IpcMainEvent) =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame && isRendererUrl(event.senderFrame.url)

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.silentgtx.gloom')
    serveApp()
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
      library: (change) => broadcast(IPC.libraryChanged, change),
      sessions: (change) => broadcast(IPC.sessionsChanged, change),
      transcript: (change) => broadcast(IPC.transcriptChanged, change)
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
      // A folder opens in File Explorer; anything else the transcript names would be run, so it's only shown.
      if (!statSync(cwd).isDirectory()) {
        shell.showItemInFolder(cwd)
        return true
      }
      return (await shell.openPath(cwd)) === ''
    })
    // A folder opens in VS Code through its own link (vscode://file/…), so nothing is run by name
    // from the folder; without VS Code it opens in File Explorer.
    const editorName = () => app.getApplicationNameForProtocol('vscode://') || null
    ipcMain.handle(IPC.editorName, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      return editorName()
    })
    ipcMain.handle(IPC.openInEditor, async (event, id: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const meta = typeof id === 'string' ? library.session(id) : undefined
      const cwd = meta?.cwd
      if (!cwd || meta.remote || !existsSync(cwd) || !statSync(cwd).isDirectory()) return false
      if (!editorName()) return (await shell.openPath(cwd)) === ''
      const path = cwd
        .replace(/\\/g, '/')
        .split('/')
        .map((part, i) => (i === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
        .join('/')
      await shell.openExternal(`vscode://file/${path}`)
      return true
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
    ipcMain.handle(IPC.unfollowTranscript, (event, id: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      library.unfollow(typeof id === 'string' ? id : undefined)
    })
    ipcMain.handle(IPC.exportSession, (event, id: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const meta = typeof id === 'string' ? library.session(id) : undefined
      if (!meta) throw new Error('That session’s transcript is gone.')
      return exportSession(meta, library.entry(meta.id))
    })
    ipcMain.handle(IPC.searchTranscripts, (event, query: unknown, includeArchived: unknown) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      if (typeof query !== 'string' || query.trim().length < 2 || query.length > 500) return { hits: [], done: true }
      return library.searchTranscripts(query.trim(), includeArchived === true, 20)
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
    /** An SSH session's transcript, copied from the other machine into ~/.claude/projects/ssh-<connection>/. */
    const copyBack = async (id: string) => {
      const remote = sessions.remoteOf(id)
      const host = library.entry(id)?.ssh?.host
      if (!remote || !host) return
      const folder = join(claudeDir(), 'projects', connectionFolder(host))
      const file = `~/.claude/projects/${projectFolder(remote.cwd)}/${id}.jsonl`
      try {
        const { stdout } = await promisify(execFile)(remote.exe, ['-T', '-o', 'BatchMode=yes', remote.host, `cat ${file}`], { windowsHide: true, timeout: 120_000, maxBuffer: 512 * 1024 * 1024, encoding: 'buffer' })
        mkdirSync(folder, { recursive: true })
        writeFileSync(join(folder, `${id}.jsonl.tmp`), stdout)
        renameSync(join(folder, `${id}.jsonl.tmp`), join(folder, `${id}.jsonl`))
      } catch (error) {
        console.warn('Gloom: couldn’t copy an SSH session’s transcript back:', error)
      }
    }

    // The computer stays awake while a session works (Settings › Sessions).
    const awake = new KeepAwake()
    let anyBusy = (): boolean => false
    // Set once the terminals exist (below): Gloom's tools for each process, and side sessions' reports.
    const plans = new Map<string, PlanStep[]>()
    let toolsFor: ((id: string) => Record<string, ReturnType<typeof gloomServer>>) | null = null
    let turnEndedHook: ((id: string, ok: boolean) => void) | null = null
    const sessions = new Sessions(
      {
        event: (event) => {
          broadcast(IPC.liveEvent, event)
          if (event.type === 'summary' || event.type === 'closed') awake.update(anyBusy())
        },
        attention: (id, kind, card) => attend(mainWindow, id, titleOf(id), kind, card),
        quiet: () => sessionsQuiet(),
        tools: (id) => toolsFor?.(id),
        turnEnded: (id, ok) => {
          turnEndedHook?.(id, ok)
          // An SSH session's transcript comes back after each turn, beside the Claude app's copies.
          void copyBack(id)
        }
      },
      (id) => library.session(id),
      (id, uuid) => library.chainParent(id, uuid),
      (id) => library.entry(id)
    )
    anyBusy = () => sessions.busy()
    onSettings(() => awake.update(sessions.busy()))
    deferUpdatesWhile(() => sessions.busy())
    app.on('before-quit', () => {
      sessions.closeAll()
      awake.stop()
    })

    // Settings › Sessions › Archive inactive sessions, as the Claude app does it: never one
    // Gloom is running, pinned or marked unread; a clean worktree goes with it, one with
    // uncommitted changes stays on disk.
    const archiveInactive = async () => {
      const days = settings().archiveAfterDays
      if (days <= 0) return
      const snap = library.snapshot()
      if (!snap.indexed) return
      const ids = inactiveSessions(snap.sessions, snap.library.sessions, days, Date.now(), (id) => sessions.running(id))
      if (!ids.length) return
      library.apply({ type: 'setArchived', ids, archived: true })
      for (const id of ids) {
        const cwd = library.session(id)?.cwd
        if (cwd && sessionWorktree(cwd) && existsSync(cwd)) await removeWorktree(cwd, false).catch(() => null)
      }
    }
    setTimeout(() => {
      void archiveInactive()
      setInterval(() => void archiveInactive(), ARCHIVE_EVERY_MS).unref()
    }, ARCHIVE_FIRST_MS).unref()
    handle(IPC.liveList, () => sessions.list())
    handle(IPC.liveSnapshot, (_event, id) => sessions.snapshot(sessionId(id)))
    handle(IPC.liveCreate, async (_event, raw) => {
      const request = parseNewSession(raw)
      // On another machine: its folder is there, and the session is kept as an SSH one.
      if (request.ssh) {
        const id = sessions.create(request)
        library.apply({ type: 'setSsh', id, host: request.ssh, cwd: request.cwd })
        library.apply({ type: 'setSessionRun', id, model: request.model, effort: request.effort })
        return id
      }
      if (!existsSync(request.cwd)) throw new Error('That folder doesn’t exist.')
      // In a git repository, a worktree of its own (unless you switched it off); the session works there.
      if (request.worktree && (await repoInfo(request.cwd))) {
        try {
          request.cwd = (await createWorktree(request.cwd)).cwd
        } catch (error) {
          throw new Error(`Couldn’t make a worktree: ${String((error as { stderr?: string }).stderr || (error as Error).message).trim().split('\n')[0]}`)
        }
      }
      const id = sessions.create(request)
      library.apply({ type: 'setSessionRun', id, model: request.model, effort: request.effort })
      return id
    })
    handle(IPC.liveRewindPreview, (_event, id, messageId) => sessions.rewindPreview(sessionId(id), sessionId(messageId)))
    handle(IPC.liveRewind, (_event, id, raw) => sessions.rewind(sessionId(id), parseRewind(raw)))
    handle(IPC.liveRewindUndo, (_event, id) => sessions.undoRewind(sessionId(id)))
    handle(IPC.liveRecreate, async (_event, id) => {
      const cwd = sessions.cwdOf(sessionId(id))
      if (!cwd || existsSync(cwd)) return false
      await recreateFolder(cwd)
      return existsSync(cwd)
    })

    // ─── Worktrees ─────────────────────────────────────────────────────────
    handle(IPC.gitRepo, (_event, folder) => (typeof folder === 'string' && isAbsolute(folder) ? repoInfo(folder) : null))
    handle(IPC.gitWorktree, (_event, id) => {
      const cwd = sessions.cwdOf(sessionId(id))
      return cwd ? worktreeInfo(cwd) : null
    })
    handle(IPC.gitMerge, (_event, id) => {
      const cwd = sessions.cwdOf(sessionId(id))
      return cwd ? mergeWorktree(cwd) : { ok: false, reason: 'Gloom doesn’t know where this session works.' }
    })
    handle(IPC.gitRemoveWorktree, (_event, id, force): Promise<RemoveResult> | RemoveResult => {
      const sid = sessionId(id)
      const cwd = sessions.cwdOf(sid)
      if (!cwd) return { removed: false, reason: 'Gloom doesn’t know where this session works.' }
      if (!sessionWorktree(cwd)) return { removed: false, reason: 'It doesn’t work in a worktree.' }
      // A working session keeps its folder; an idle one's process closes first.
      if (!sessions.closeIdle(sid)) return { removed: false, reason: 'Claude is working in it.' }
      return removeWorktree(cwd, force === true)
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
    handle(IPC.liveSet, async (_event, id, request) => {
      const sid = sessionId(id)
      const parsed = parseSet(request)
      await sessions.set(sid, parsed)
      // A session's extra folders are kept with it, for every process it starts; so are its model and effort.
      if ('folders' in parsed) library.apply({ type: 'setSessionFolders', id: sid, folders: parsed.folders })
      if ('model' in parsed) library.apply({ type: 'setSessionRun', id: sid, model: parsed.model })
      if ('effort' in parsed) library.apply({ type: 'setSessionRun', id: sid, effort: parsed.effort })
    })
    handle(IPC.liveToggleMcp, (_event, id, name, enabled) => sessions.toggleMcp(sessionId(id), serverName(name), enabled === true))
    handle(IPC.liveStopTask, (_event, id, taskId) => sessions.stopTask(sessionId(id), String(taskId).slice(0, 200)))
    handle(IPC.fileRead, (_event, id, path) => {
      const sid = sessionId(id)
      const cwd = sessions.cwdOf(sid)
      const folders = [cwd, ...(library.entry(sid)?.folders ?? [])].filter((f): f is string => !!f)
      return readSessionFile(typeof path === 'string' ? path : '', folders)
    })
    handle(IPC.liveReconnectMcp, (_event, id, name) => sessions.reconnectMcp(sessionId(id), serverName(name)))
    handle(IPC.liveCommands, (_event, id) => sessions.commands(sessionId(id)))
    handle(IPC.liveFiles, (_event, id): FileListing | Promise<FileListing> => {
      const sid = sessionId(id)
      const cwd = sessions.cwdOf(sid)
      // A session run on another machine, or whose folder is gone, has nothing here to offer.
      if (!cwd || library.session(sid)?.remote || !existsSync(cwd)) return { top: [], all: [], truncated: false }
      return listFiles(cwd)
    })
    handle(IPC.liveModels, () => knownModels())
    handle(IPC.liveUsage, () => sessions.usage())
    handle(IPC.liveAccount, () => sessions.account())
    // The usage panel asks for fresher than five minutes, never more often than every ten seconds.
    handle(IPC.liveRefreshUsage, (_event, maxAge) => sessions.refreshUsage(typeof maxAge === 'number' && Number.isFinite(maxAge) ? Math.max(10_000, maxAge) : undefined))
    // Your plan's use as it is now, and Claude Code may have been updated (with new models) or have
    // fetched your usage meanwhile (in a terminal, in the Claude app).
    void sessions.refreshUsage()
    void sessions.checkModels()
    app.on('browser-window-focus', () => {
      sessions.readConfig()
      void sessions.refreshUsage()
      void sessions.checkModels()
    })
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
    onSettings((next) => broadcast(IPC.settingsChanged, next))
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
      data: (data) => broadcast(IPC.terminalData, data),
      exit: (exit) => broadcast(IPC.terminalExit, exit),
      opened: (info) => broadcast(IPC.terminalOpened, info)
    })

    // ─── The Browser pane and dev servers ──────────────────────────────────
    const browsers = new Browsers(
      () => mainWindow,
      (state) => broadcast(IPC.browserChanged, state)
    )
    const previews = new PreviewServers(() => {})
    app.on('before-quit', () => {
      previews.stopAll()
      browsers.closeAll()
    })
    const bounds = (v: unknown) => {
      const b = (v ?? {}) as Record<string, unknown>
      const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.round(x)) : 0)
      return { x: n(b.x), y: n(b.y), width: n(b.width), height: n(b.height) }
    }
    handle(IPC.browserShow, (event, id, b) => browsers.show(sessionId(id), bounds(b), BrowserWindow.fromWebContents(event.sender)))
    handle(IPC.browserHide, (event) => browsers.hide(BrowserWindow.fromWebContents(event.sender)))
    handle(IPC.popOut, (event, pane, id) => {
      if (typeof pane !== 'string' || !(POP_OUT_PANES as readonly string[]).includes(pane)) throw new Error('bad pane')
      const sid = sessionId(id)
      createPopOutWindow(pane as PopOutPane, sid, titleOf(sid), BrowserWindow.fromWebContents(event.sender))
    })
    handle(IPC.browserNavigate, (_event, id, address) => browsers.navigate(sessionId(id), typeof address === 'string' ? address.slice(0, 4000) : ''))
    handle(IPC.browserGo, (_event, id, where) => {
      const sid = sessionId(id)
      if (where === 'back') browsers.back(sid)
      else if (where === 'forward') browsers.forward(sid)
      else if (where === 'reload') browsers.reload(sid)
    })
    handle(IPC.browserState, (_event, id) => browsers.state(sessionId(id)))
    handle(IPC.previewList, (_event, id) => {
      const cwd = sessions.cwdOf(sessionId(id)) ?? homedir()
      const { configs, problem, file } = readLaunch(cwd)
      return { file, problem, configurations: configs.map((c) => ({ name: c.name, port: c.port, url: c.url })), running: previews.list(cwd) }
    })
    handle(IPC.previewStart, async (_event, id, name) => {
      const sid = sessionId(id)
      const server = await previews.start(sessions.cwdOf(sid) ?? homedir(), String(name).slice(0, 100))
      if (server.url && server.status === 'running') await browsers.navigate(sid, server.url)
      return server
    })
    handle(IPC.previewStop, (_event, serverId) => previews.stop(String(serverId)))

    // ─── Pull requests ─────────────────────────────────────────────────────
    const prs = new PrService({
      cwd: (id) => sessions.cwdOf(id),
      entry: (id) => library.entry(id),
      // Monitored sessions, and (when closing archives) any whose PR Gloom has seen open.
      watched: () => {
        const entries = library.snapshot().library.sessions
        return Object.entries(entries).flatMap(([id, e]) => (!e.archived && (e.pr?.autoFix || e.pr?.autoArchive || (settings().archiveOnPrClose && prs.cached(id)?.state === 'OPEN')) ? [id] : []))
      },
      applyLibrary: (op) => void library.apply(op),
      send: (id, text) => {
        try {
          sessions.send(id, text, [])
        } catch (error) {
          console.warn('Gloom: Auto-fix couldn’t reach the session:', error)
        }
      },
      archiveOnClose: () => settings().archiveOnPrClose,
      changed: (id, status) => broadcast(IPC.liveEvent, { type: 'pr', id, status } satisfies LiveEvent)
    })
    prs.start()
    app.on('before-quit', () => prs.stop())
    const prCwd = (id: string) => {
      const cwd = sessions.cwdOf(id)
      if (!cwd) throw new Error('Gloom doesn’t know where this session works.')
      return cwd
    }
    const prUrl = async (id: string) => {
      const status = await prs.status(id)
      if (!status) throw new Error('This session has no pull request.')
      return status.url
    }
    const method = (v: unknown) => (v === 'merge' || v === 'rebase' ? v : 'squash')
    handle(IPC.prStatus, (_event, id, maxAge) => prs.status(sessionId(id), typeof maxAge === 'number' ? Math.max(5_000, maxAge) : undefined))
    handle(IPC.prBind, async (_event, id, url) => {
      const sid = sessionId(id)
      library.apply({ type: 'setPr', id: sid, pr: typeof url === 'string' ? { ...(library.entry(sid)?.pr ?? {}), url } : null })
      return prs.status(sid, 0)
    })
    handle(IPC.prMerge, async (_event, id, how) => {
      const sid = sessionId(id)
      await mergePr(prCwd(sid), await prUrl(sid), method(how))
      await prs.status(sid, 0)
    })
    handle(IPC.prAutoMerge, async (_event, id, enabled, how) => {
      const sid = sessionId(id)
      await setAutoMerge(prCwd(sid), await prUrl(sid), enabled === true, method(how))
      await prs.status(sid, 0)
    })
    handle(IPC.prMonitor, (_event, id, raw) => {
      const sid = sessionId(id)
      const switches = (raw ?? {}) as { autoFix?: unknown; autoArchive?: unknown }
      const pr = library.entry(sid)?.pr ?? { url: null }
      library.apply({
        type: 'setPr',
        id: sid,
        pr: { ...pr, ...(typeof switches.autoFix === 'boolean' ? { autoFix: switches.autoFix } : {}), ...(typeof switches.autoArchive === 'boolean' ? { autoArchive: switches.autoArchive } : {}) }
      })
    })

    // ─── Routines ──────────────────────────────────────────────────────────
    const routines = new Routines({
      run: async (r) => {
        if (!existsSync(r.cwd)) throw new Error(`Its folder, ${r.cwd}, no longer exists.`)
        const id = sessions.create({ cwd: r.cwd, model: r.model, mode: isMode(r.mode) ? r.mode : 'default', effort: null })
        library.apply({ type: 'setRoutine', id, routine: r.id })
        library.apply({ type: 'renameSession', id, title: r.name })
        sessions.send(id, r.prompt, [])
        return id
      },
      changed: (list) => broadcast(IPC.routinesChanged, { routines: list, next: routines.nextRuns() })
    })
    routines.load()
    routines.start()
    loadCloud()
    handle(IPC.cloudList, () => cloudSessions())
    handle(IPC.cloudStart, async (_event, folder, task) => {
      if (typeof folder !== 'string' || !existsSync(folder)) throw new Error('Choose the repository’s folder.')
      if (typeof task !== 'string' || !task.trim()) throw new Error('Say what the cloud session should do.')
      const session = await startCloud(folder, task.slice(0, 20_000))
      void shell.openExternal(session.url)
      return session
    })
    app.on('before-quit', () => routines.stop())
    handle(IPC.routinesList, () => ({ routines: routines.all(), next: routines.nextRuns() }))
    handle(IPC.routinesSave, (_event, raw) => routines.save(raw))
    handle(IPC.routinesDelete, (_event, id) => routines.remove(String(id)))
    handle(IPC.routinesRun, (_event, id) => routines.runNow(String(id)))

    // ─── Gloom's tools for Claude, and side sessions ───────────────────────
    const send = (event: LiveEvent) => broadcast(IPC.liveEvent, event)
    const side = new SideSessions({
      meta: (id) => library.session(id),
      entry: (id) => library.entry(id),
      summary: (id) => sessions.list().find((s) => s.id === id),
      create: async (r) => {
        let cwd = r.cwd
        if (r.worktree && (await repoInfo(cwd))) cwd = (await createWorktree(cwd)).cwd
        return sessions.create({ cwd, model: r.model, mode: r.mode, effort: null, ...(r.forkFrom ? { forkFrom: r.forkFrom } : {}) })
      },
      send: (id, text) => sessions.send(id, text, []),
      lastReply: (id) => sessions.lastReply(id),
      applyLibrary: (op) => void library.apply(op),
      offer: (from, title) => sessions.offer(from, title),
      event: send
    })
    /** Tabs Claude opened, which it may type into again. */
    const toolTabs = new Set<string>()
    const sessionCwd = (id: string) => sessions.cwdOf(id) ?? homedir()
    const host: ToolHost = {
      listSessions: ({ limit, includeArchived, folder, linkedTo }) => {
        const snap = library.snapshot()
        const folders = new Map(snap.library.folders.map((f) => [f.id, f]))
        const family = linkedTo ? new Set([linkedTo, snap.library.sessions[linkedTo]?.startedBy, ...Object.entries(snap.library.sessions).filter(([, e]) => e.startedBy === linkedTo).map(([sid]) => sid)].filter(Boolean) as string[]) : null
        return snap.sessions
          .filter((m) => {
            const e = snap.library.sessions[m.id]
            return (includeArchived || !e?.archived) && (!folder || e?.folderId === folder || folders.get(e?.folderId ?? '')?.name === folder) && (!family || family.has(m.id))
          })
          .sort((a, b) => b.updated - a.updated)
          .slice(0, limit)
          .map((m): SessionRow => {
            const e = snap.library.sessions[m.id]
            const f = e?.folderId ? folders.get(e.folderId) : undefined
            return {
              sessionId: m.id,
              title: displayTitle(m, e),
              cwd: m.cwd,
              folder: f ? { id: f.id, name: f.name } : null,
              pinned: !!e?.pinned,
              archived: !!e?.archived,
              unread: !!e?.unread,
              running: sessions.running(m.id),
              lastActivityAt: new Date(m.updated).toISOString(),
              ...(e?.name || e?.startedBy ? { linked: { name: e?.name ?? '', startedBy: e?.startedBy ?? null } } : {})
            }
          })
      },
      folders: () => {
        const snap = library.snapshot()
        return snap.library.folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, sessions: Object.values(snap.library.sessions).filter((e) => e.folderId === f.id && !e.archived).length }))
      },
      applyLibrary: (op) => {
        const result = library.apply(op)
        return { folderId: result.folderId }
      },
      searchTranscripts: (query, includeArchived, limit) => library.searchTranscripts(query, includeArchived, limit),
      exportSession: (id) => {
        const meta = library.session(id)
        if (!meta) throw new Error('That session’s transcript is gone.')
        return exportSession(meta, library.entry(id))
      },
      markCompleted: (ids) => {
        library.apply({ type: 'setUnread', ids, unread: false })
        send({ type: 'completed', ids })
      },
      setTranscriptView: (id, view) => send({ type: 'view', id, view }),
      terminalTabs: (id) => {
        const key = folderKey(sessionCwd(id))
        return terminals
          .list()
          .filter((t) => folderKey(t.cwd) === key)
          .map((t) => ({ tab_id: t.id, title: t.title ?? t.short, cwd: t.cwd, running: null, reusable: toolTabs.has(t.id) && t.exitCode === null }))
      },
      readTerminal: async (tab, lines, waitMs) => {
        if (!terminals.has(tab)) throw new Error('That terminal has closed.')
        if (waitMs > 0) await terminals.waitForOutput(tab, waitMs)
        return terminals.screen(tab, lines) || '(nothing on screen yet)'
      },
      runInTerminal: async (id, command, { tabId, cwd, title }) => {
        let tab = tabId
        if (tab) {
          if (!terminals.has(tab)) throw new Error('That terminal has closed: run without tab_id to open a new one.')
        } else {
          const folder = cwd ? (isAbsolute(cwd) ? cwd : join(sessionCwd(id), cwd)) : sessionCwd(id)
          tab = terminals.openFor(folder, settings().shell, title ?? 'Claude').id
          toolTabs.add(tab)
          // The shell's first prompt, before the command goes in.
          await terminals.waitForOutput(tab, 4000)
          await new Promise((r) => setTimeout(r, 300))
        }
        terminals.input(tab, command + '\r')
        return tab
      },
      openTerminal: (id, { cwd, title }) => {
        const folder = cwd ? (isAbsolute(cwd) ? cwd : join(sessionCwd(id), cwd)) : sessionCwd(id)
        const tab = terminals.openFor(folder, settings().shell, title ?? 'Claude').id
        toolTabs.add(tab)
        return tab
      },
      stopTerminal: (tab) => {
        terminals.close(tab)
        toolTabs.delete(tab)
        broadcast(IPC.terminalExit, { id: tab, code: 0 })
      },
      settings: () => settings(),
      setSetting: (key, value) => updateSettings({ [key]: value }),
      browsers,
      previews,
      cwd: (id) => sessionCwd(id),
      showBrowser: (id) => mainWindow?.webContents.send(IPC.browserOpen, id),
      prs,
      routines,
      // Switches not named keep their value.
      setPr: (id, pr) => void library.apply({ type: 'setPr', id, pr: pr ? { ...(library.entry(id)?.pr ?? {}), ...pr } : null }),
      mergePr: async (id, how, auto) => {
        const url = await prUrl(id)
        if (auto === null) await mergePr(prCwd(id), url, how)
        else await setAutoMerge(prCwd(id), url, auto, how)
        return prs.status(id, 0)
      },
      startSession: (from, request) => side.start(from, request),
      dismissTask: (from, taskId) => side.dismiss(from, taskId),
      handOff: (from, title, plan) => side.handOff(from, title, plan),
      sendMessage: (from, to, text) => side.send(from, to, text)
    }
    toolsFor = (id) => ({ gloom: gloomServer(id, host, plans) })
    turnEndedHook = (id, ok) => side.turnEnded(id, ok, false)
    handle(IPC.sideStart, (_event, taskId) => side.startProposal(String(taskId)))
    handle(IPC.sideDismiss, (_event, id, taskId) => side.dismiss(sessionId(id), String(taskId)))
    handle(IPC.sidePending, (_event, taskId) => side.pending(String(taskId)))
    handle(IPC.widgetServe, (_event, id, code, title, theme) => {
      if (typeof id !== 'string' || id.length > 200 || typeof code !== 'string' || code.length > 500_000) throw new Error('bad widget')
      const t = (theme ?? {}) as { dark?: unknown; accent?: unknown }
      return serveWidget(id, widgetPage(code, typeof title === 'string' ? title.slice(0, 80) : 'widget', { dark: t.dark === true, accent: typeof t.accent === 'string' ? t.accent : '' }))
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
    // Asked once the previous version has quit (handoverWait), since it holds the storage until then.
    ipcMain.handle(IPC.storageToMove, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      return storageToMove()
    })
    mainWindow.on('closed', () => {
      mainWindow = null
      // Panes in windows of their own go with the main window.
      for (const w of appWindows()) w.close()
    })
    mainWindow.on('focus', checkOnFocus)
    mainWindow.on('focus', () => mainWindow?.flashFrame(false))
    // The pet: a window of its own on top of every app, which Settings › Pets or /pet shows.
    // Pets you create: Gloom's pets folder, watched; a new one is chosen once it's built.
    const pets = new Pets(
      app.getPath('userData'),
      (list) => {
        broadcast(IPC.petsChanged, list)
        pet.changed()
      },
      (id) => updateSettings({ pet: true, petKind: `custom:${id}` })
    )
    pets.start()
    app.on('before-quit', () => pets.stop())
    const pet = startPet({ trusted, mainWindow, customPets: pets })
    handle(IPC.petsList, () => pets.all())
    handle(IPC.petsRemove, (_event, id) => {
      if (settings().petKind === `custom:${String(id)}`) updateSettings({ petKind: 'blob' })
      pets.remove(String(id))
    })
    handle(IPC.petsReveal, () => shell.openPath(pets.dir))
    // Create Pet: a session in the pets folder that draws it, on the kit that's there.
    handle(IPC.petsCreate, (_event, name, idea) => {
      if (typeof name !== 'string' || !name.trim()) throw new Error('Give your pet a name.')
      const about = typeof idea === 'string' ? idea.slice(0, 2000) : ''
      const id = pets.prepare(name, about)
      const s = settings()
      const sid = sessions.create({ cwd: pets.dir, model: s.model, mode: s.mode, effort: s.effort })
      library.apply({ type: 'renameSession', id: sid, title: `Create pet: ${name.trim().slice(0, 40)}` })
      sessions.send(sid, pets.prompt(id, name.trim(), about), [])
      if (mainWindow) reveal(mainWindow, sid)
      return sid
    })
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
