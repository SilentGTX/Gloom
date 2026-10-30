import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findCommand, type CommandId } from '@shared/commands'
import { IPC, type AppInfo } from '@shared/ipc'
import { installApplicationMenu, runCommand } from './commands'
import { runPtySmoke } from './smoke'
import { installPending, launch, updateWindow } from './update-window'
import { onUpdateState, startBackgroundChecks, updateState } from './updater'
import { createMainWindow, rendererUrl, windowState } from './window'

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
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    const win = mainWindow ?? updateWindow()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  /** IPC from anything but our own page's main frame is ignored. */
  const trusted = (event: IpcMainInvokeEvent) =>
    event.senderFrame !== null && event.senderFrame === event.sender.mainFrame && event.senderFrame.url.startsWith(rendererUrl())

  void app.whenReady().then(() => {
    app.setAppUserModelId('com.silentgtx.gloom')
    installApplicationMenu()

    ipcMain.handle(IPC.windowState, (event) => {
      if (!trusted(event)) throw new Error('untrusted sender')
      const win = BrowserWindow.fromWebContents(event.sender)
      return win ? windowState(win) : null
    })
    ipcMain.handle(IPC.appInfo, (event): AppInfo => {
      if (!trusted(event)) throw new Error('untrusted sender')
      return { version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node }
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
    onUpdateState((state) => mainWindow?.webContents.send(IPC.updateStateChanged, state))

    // The update window checks for an update first, then hands over to the main window.
    void launch({
      open: (show) => {
        const created = createMainWindow({ show })
        mainWindow = created.win
        created.win.on('closed', () => {
          if (mainWindow === created.win) mainWindow = null
        })
        return created
      },
      current: () => mainWindow
    })
    startBackgroundChecks()
  })

  app.on('window-all-closed', () => app.quit())
}
