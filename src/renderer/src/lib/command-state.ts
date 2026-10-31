// What each command says and whether it can run right now, for the menu button
// and the command palette alike. Toggles say what they will do ("Hide
// Sidebar"), Undo says what it undoes ("Undo Archive"), and commands that need
// an open session, a transcript, a turn under way or a worktree wait for one.
import type { CommandSpec } from '@shared/commands'
import { useWorktrees } from '../features/chat/Worktree'
import { computeLayout } from '../features/shell/layout'
import { useLibrary } from '../stores/library'
import { isBusy, useLive } from '../stores/live'
import { useTranscript } from '../stores/transcript'
import { useUi, type DiffTab, type SortOrder } from '../stores/ui'

/** Commands that act on the open session's transcript. */
const NEEDS_TRANSCRIPT = new Set<string>(['session.resume', 'edit.find', 'edit.findNext', 'edit.findPrevious'])
/** The Sort Sessions By choices, by command. */
export const SORTS: Record<string, SortOrder> = { 'view.sortActivity': 'activity', 'view.sortName': 'name', 'view.sortCreated': 'created' }
/** The Show in Diff choices, by command. */
export const DIFF_TABS: Record<string, DiffTab> = { 'view.diffSession': 'session', 'view.diffTree': 'tree' }

export interface CommandState {
  label: string
  disabled: boolean
  /** What it turns on, or the choice it makes, is in effect now (a checkmark in menus). */
  checked: boolean
}

export function useCommandState(): (command: CommandSpec) => CommandState {
  const ui = useUi()
  const lastUndo = useLibrary((s) => s.undoStack.at(-1))
  const worktree = useWorktrees((s) => (ui.selection.length === 1 ? !!s.info[ui.selection[0]] : false))
  const reading = useTranscript((s) => s.status === 'ready')
  const working = useLive((s) => ui.selection.length === 1 && isBusy(s.sessions[ui.selection[0]]))
  const sidebarShown = computeLayout(window.innerWidth, ui).sidebarInline || ui.sheet

  const labelOf = (c: CommandSpec) => {
    if (c.id === 'edit.undo') return lastUndo ? `Undo ${lastUndo.label}` : 'Undo'
    if (c.id === 'view.toggleSidebar') return sidebarShown ? 'Hide Sidebar' : 'Show Sidebar'
    if (c.id === 'view.toggleDiff') return ui.diffOpen ? 'Hide Diff' : 'Show Diff'
    if (c.id === 'view.toggleTerminal') return ui.terminalOpen ? 'Hide Terminal' : 'Show Terminal'
    return c.label
  }
  return (c) => ({
    label: labelOf(c),
    disabled:
      !!c.arrivesIn ||
      (c.id === 'edit.undo' && !lastUndo) ||
      (NEEDS_TRANSCRIPT.has(c.id) && !reading) ||
      ((c.id === 'session.info' || c.id === 'terminal.new') && ui.selection.length !== 1) ||
      (c.id === 'session.stop' && !working) ||
      (c.id === 'view.refreshDiff' && !ui.diffOpen) ||
      (c.id === 'session.merge' && !worktree),
    checked: c.id === 'view.toggleGlass' ? ui.glassAlways : c.id in SORTS ? SORTS[c.id] === ui.sort : c.id in DIFF_TABS ? DIFF_TABS[c.id] === ui.diffTab : false
  })
}
