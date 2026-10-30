// Every command and shortcut in one registry. Main builds the (hidden) application
// menu from it so accelerators work; the renderer's menu button lists the same
// entries; the command palette will read it later.

export type CommandGroup = 'file' | 'edit' | 'view' | 'help' | 'developer'

export interface CommandSpec {
  id: string
  label: string
  group: CommandGroup
  /** Listed in a submenu of its group, under this name. */
  submenu?: string
  /** Electron accelerator syntax. */
  accelerator?: string
  /** Who carries it out: main itself, or the renderer over IPC. */
  runs: 'main' | 'renderer'
  /** Listed but disabled until the phase that builds it. */
  arrivesIn?: string
}

export const COMMANDS = [
  { id: 'session.new', label: 'New Session', group: 'file', accelerator: 'CmdOrCtrl+N', runs: 'renderer', arrivesIn: 'Phase 4' },
  { id: 'folder.new', label: 'New Folder', group: 'file', accelerator: 'CmdOrCtrl+Shift+N', runs: 'renderer' },
  // Opens the open session in a terminal window, until Gloom can send messages itself.
  { id: 'session.resume', label: 'Resume in Terminal', group: 'file', runs: 'renderer' },
  // The open session's details: where and when it ran, and its ID (the chat toolbar's ⓘ).
  { id: 'session.info', label: 'Session Info', group: 'file', accelerator: 'CmdOrCtrl+I', runs: 'renderer' },
  { id: 'app.settings', label: 'Settings…', group: 'file', accelerator: 'CmdOrCtrl+,', runs: 'renderer', arrivesIn: 'Phase 4' },
  { id: 'app.quit', label: 'Quit Gloom', group: 'file', accelerator: 'CmdOrCtrl+Q', runs: 'main' },
  // Undoes typing in a field, otherwise the last change to your folders and sessions.
  { id: 'edit.undo', label: 'Undo', group: 'edit', accelerator: 'CmdOrCtrl+Z', runs: 'renderer' },
  // Finds in the open chat's transcript; Search Sessions looks through every session.
  { id: 'edit.find', label: 'Find…', group: 'edit', accelerator: 'CmdOrCtrl+F', runs: 'renderer' },
  { id: 'edit.findNext', label: 'Find Next', group: 'edit', accelerator: 'F3', runs: 'renderer' },
  { id: 'edit.findPrevious', label: 'Find Previous', group: 'edit', accelerator: 'Shift+F3', runs: 'renderer' },
  { id: 'view.search', label: 'Search Sessions', group: 'view', accelerator: 'CmdOrCtrl+Shift+F', runs: 'renderer' },
  { id: 'view.toggleSidebar', label: 'Show or Hide Sidebar', group: 'view', accelerator: 'CmdOrCtrl+B', runs: 'renderer' },
  // How the sessions inside each folder are ordered (pinned ones always lead).
  { id: 'view.sortActivity', label: 'Last Activity', group: 'view', submenu: 'Sort Sessions By', runs: 'renderer' },
  { id: 'view.sortName', label: 'Name', group: 'view', submenu: 'Sort Sessions By', runs: 'renderer' },
  { id: 'view.sortCreated', label: 'Date Created', group: 'view', submenu: 'Sort Sessions By', runs: 'renderer' },
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
  { id: 'dev.devTools', label: 'Developer Tools', group: 'developer', accelerator: 'CmdOrCtrl+Shift+I', runs: 'main' },
  { id: 'dev.previewUpdateWindow', label: 'Preview Update Window', group: 'developer', runs: 'main' }
] as const satisfies readonly CommandSpec[]

export type CommandId = (typeof COMMANDS)[number]['id']

export const GROUP_LABELS: Record<CommandGroup, string> = {
  file: 'File',
  edit: 'Edit',
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

/**
 * A menu's entries in order: commands, and submenus gathered where their first
 * command stands.
 */
export type MenuEntry<T extends CommandSpec = CommandSpec> = { kind: 'command'; command: T } | { kind: 'submenu'; label: string; commands: T[] }

export function menuEntries<T extends CommandSpec>(commands: readonly T[]): MenuEntry<T>[] {
  const entries: MenuEntry<T>[] = []
  for (const command of commands) {
    if (!command.submenu) {
      entries.push({ kind: 'command', command })
      continue
    }
    const open = entries.find((e): e is Extract<MenuEntry<T>, { kind: 'submenu' }> => e.kind === 'submenu' && e.label === command.submenu)
    if (open) open.commands.push(command)
    else entries.push({ kind: 'submenu', label: command.submenu, commands: [command] })
  }
  return entries
}
