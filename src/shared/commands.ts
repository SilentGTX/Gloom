// Every command and shortcut in one registry. Main builds the (hidden) application
// menu from it so accelerators work; the renderer's menu button lists the same
// entries; the command palette will read it later.

export type CommandGroup = 'file' | 'view' | 'help' | 'developer'

export interface CommandSpec {
  id: string
  label: string
  group: CommandGroup
  /** Electron accelerator syntax. */
  accelerator?: string
  /** Who carries it out: main itself, or the renderer over IPC. */
  runs: 'main' | 'renderer'
  /** Listed but disabled until the phase that builds it. */
  arrivesIn?: string
}

export const COMMANDS = [
  { id: 'session.new', label: 'New Session', group: 'file', accelerator: 'CmdOrCtrl+N', runs: 'renderer', arrivesIn: 'Phase 4' },
  { id: 'folder.new', label: 'New Folder', group: 'file', accelerator: 'CmdOrCtrl+Shift+N', runs: 'renderer', arrivesIn: 'Phase 2' },
  { id: 'app.settings', label: 'Settings…', group: 'file', accelerator: 'CmdOrCtrl+,', runs: 'renderer', arrivesIn: 'Phase 4' },
  { id: 'app.quit', label: 'Quit Gloom', group: 'file', accelerator: 'CmdOrCtrl+Q', runs: 'main' },
  { id: 'view.toggleFolders', label: 'Show or Hide Folders', group: 'view', accelerator: 'CmdOrCtrl+B', runs: 'renderer' },
  // Not Ctrl+Alt: that is AltGr on many keyboard layouts.
  { id: 'view.toggleSessions', label: 'Show or Hide Session List', group: 'view', accelerator: 'CmdOrCtrl+Shift+B', runs: 'renderer' },
  { id: 'view.toggleDiff', label: 'Diff Pane', group: 'view', accelerator: 'CmdOrCtrl+Shift+D', runs: 'renderer', arrivesIn: 'Phase 5' },
  { id: 'view.toggleTerminal', label: 'Terminal', group: 'view', accelerator: 'CmdOrCtrl+`', runs: 'renderer', arrivesIn: 'Phase 5' },
  { id: 'view.textBigger', label: 'Bigger Text', group: 'view', accelerator: 'CmdOrCtrl+=', runs: 'renderer' },
  { id: 'view.textSmaller', label: 'Smaller Text', group: 'view', accelerator: 'CmdOrCtrl+-', runs: 'renderer' },
  { id: 'view.textReset', label: 'Default Text Size', group: 'view', accelerator: 'CmdOrCtrl+0', runs: 'renderer' },
  { id: 'view.toggleGlass', label: 'Always Show Glass', group: 'view', runs: 'renderer' },
  { id: 'view.fullScreen', label: 'Full Screen', group: 'view', accelerator: 'F11', runs: 'main' },
  { id: 'help.checkUpdates', label: 'Check for Updates…', group: 'help', runs: 'main' },
  { id: 'help.smokeTest', label: 'Run Packaging Smoke Test', group: 'help', runs: 'main' },
  { id: 'help.about', label: 'About Gloom', group: 'help', runs: 'main' },
  { id: 'dev.reload', label: 'Reload', group: 'developer', accelerator: 'CmdOrCtrl+R', runs: 'main' },
  { id: 'dev.devTools', label: 'Developer Tools', group: 'developer', accelerator: 'CmdOrCtrl+Shift+I', runs: 'main' }
] as const satisfies readonly CommandSpec[]

export type CommandId = (typeof COMMANDS)[number]['id']

export const GROUP_LABELS: Record<CommandGroup, string> = {
  file: 'File',
  view: 'View',
  help: 'Help',
  developer: 'Developer'
}

export function findCommand(id: string): CommandSpec | undefined {
  return (COMMANDS as readonly CommandSpec[]).find((c) => c.id === id)
}

/** "CmdOrCtrl+Shift+N" → "Ctrl+Shift+N", as Windows shows shortcuts. */
export function formatAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((part) => (part === 'CmdOrCtrl' || part === 'CommandOrControl' ? 'Ctrl' : part))
    .join('+')
}
