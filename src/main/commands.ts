// Builds the application menu from the shared command registry. With a hidden
// title bar Windows never shows this menu; it exists so the accelerators fire.
// The renderer's menu button lists the same commands.
import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from 'electron'
import { COMMANDS, GROUP_LABELS, type CommandGroup, type CommandId, type CommandSpec } from '@shared/commands'
import { IPC, type CommandDispatch } from '@shared/ipc'
import { runPtySmoke } from './smoke'
import { checkNow, preview } from './update-window'

type MainHandler = (win: BrowserWindow | null) => void | Promise<void>

const mainHandlers: Partial<Record<CommandId, MainHandler>> = {
  'app.quit': () => app.quit(),
  'view.fullScreen': (win) => win?.setFullScreen(!win.isFullScreen()),
  'dev.reload': (win) => win?.webContents.reload(),
  'dev.devTools': (win) => win?.webContents.toggleDevTools(),
  'dev.previewUpdateWindow': () => preview(),
  'help.checkUpdates': (win) => checkNow(win),
  'help.about': async (win) => {
    const detail = [`Version ${app.getVersion()}`, `Electron ${process.versions.electron}`, `Chromium ${process.versions.chrome}`, `Node ${process.versions.node}`].join('\n')
    const options = { type: 'none' as const, title: 'About Gloom', message: 'Gloom', detail, buttons: ['OK'] }
    if (win) await dialog.showMessageBox(win, options)
    else await dialog.showMessageBox(options)
  },
  'help.smokeTest': async (win) => {
    const result = await runPtySmoke()
    const options = {
      type: result.ok ? ('info' as const) : ('error' as const),
      title: 'Packaging smoke test',
      message: result.ok ? 'node-pty started PowerShell.' : 'node-pty could not start PowerShell.',
      detail: [result.output || '(no output)', result.error, `${result.ms} ms`].filter(Boolean).join('\n\n'),
      buttons: ['OK']
    }
    if (win) await dialog.showMessageBox(win, options)
    else await dialog.showMessageBox(options)
  }
}

/** Runs a command wherever it lives. */
export function runCommand(id: CommandId, win: BrowserWindow | null, viaKeyboard: boolean): void {
  const spec = (COMMANDS as readonly CommandSpec[]).find((c) => c.id === id)
  if (!spec || spec.arrivesIn) return
  if (spec.runs === 'main') {
    void mainHandlers[id]?.(win)
    return
  }
  const dispatch: CommandDispatch = { id, viaKeyboard }
  win?.webContents.send(IPC.dispatchCommand, dispatch)
}

export function installApplicationMenu(): void {
  const groups = new Map<CommandGroup, MenuItemConstructorOptions[]>()
  for (const spec of COMMANDS as readonly CommandSpec[]) {
    const items = groups.get(spec.group) ?? []
    items.push({
      label: spec.label,
      accelerator: spec.accelerator,
      enabled: !spec.arrivesIn,
      click: (_item, window, event) =>
        runCommand(spec.id as CommandId, (window as BrowserWindow | undefined) ?? BrowserWindow.getFocusedWindow(), event.triggeredByAccelerator ?? false)
    })
    groups.set(spec.group, items)
  }
  // Edit roles keep the standard text shortcuts wired to the focused field; Undo is
  // the registry's own, so it can undo library changes when no field has focus.
  // Finding comes after them, as in every Edit menu.
  const edit = groups.get('edit')
  if (edit) {
    const [undo, ...find] = edit
    const roles: MenuItemConstructorOptions[] = [{ role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    groups.set('edit', [undo, ...roles, { type: 'separator' }, ...find])
  }
  const template: MenuItemConstructorOptions[] = [...groups].map(([group, submenu]) => ({ label: GROUP_LABELS[group], submenu }))
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
