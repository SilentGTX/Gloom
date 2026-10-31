// What each command says and whether it can run right now, for the menu button
// and the command palette alike. Toggles say what they will do ("Hide
// Sidebar"), Undo says what it undoes ("Undo Archive"), and commands that need
// an open session, a transcript, a turn under way or a worktree wait for one.
import type { CommandSpec } from '@shared/commands'
import type { TranscriptView } from '@shared/live'
import { useFinished } from '../features/concept/finished'
import { useTranscriptView } from '../features/sessions/actions'
import { useWorktrees } from '../features/chat/Worktree'
import { computeLayout, inspectorFits } from '../features/shell/layout'
import { useLibrary } from '../stores/library'
import { isBusy, useLive } from '../stores/live'
import { useTranscript } from '../stores/transcript'
import { useUi, type Design, type DiffTab, type SortOrder } from '../stores/ui'

/** Commands that act on the open session's transcript. */
const NEEDS_TRANSCRIPT = new Set<string>(['session.resume', 'edit.find', 'edit.findNext', 'edit.findPrevious'])
/** The Sort Sessions By choices, by command. */
export const SORTS: Record<string, SortOrder> = { 'view.sortActivity': 'activity', 'view.sortName': 'name', 'view.sortCreated': 'created' }
/** The Show in Diff choices, by command. */
export const DIFF_TABS: Record<string, DiffTab> = { 'view.diffSession': 'session', 'view.diffTree': 'tree' }
/** The Design choices, by command. */
export const DESIGNS: Record<string, Design> = { 'view.designConcept': 'concept', 'view.designClassic': 'classic' }
/** The Transcript View choices, by command. */
export const VIEWS: Record<string, TranscriptView> = { 'view.transcriptNormal': 'normal', 'view.transcriptThinking': 'thinking', 'view.transcriptVerbose': 'verbose' }
/** Commands that act on the one session the chat shows. */
const NEEDS_SESSION = new Set<string>(['session.addFolder', 'session.export', ...Object.keys(VIEWS)])

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
  const one = ui.selection.length === 1 ? ui.selection[0] : null
  const fast = useLive((s) => (one ? s.sessions[one]?.fast === true : false))
  // Fast mode waits for a session whose model offers it (or one already running fast, to turn it off).
  const fastCan = useLive((s) => {
    const live = one ? s.sessions[one] : undefined
    const model = live?.activeModel ?? live?.model ?? s.settings.model
    return !!live && (live.fast === true || s.models.some((m) => m.fast && (m.value === model || m.value === live.model)))
  })
  const unread = useLibrary((s) => ui.selection.length > 0 && ui.selection.every((id) => s.library.sessions[id]?.unread))
  const marked = useFinished((s) => ui.selection.some((id) => s.ids.has(id))) || unread
  const view = useTranscriptView(one)
  const sidebarShown = computeLayout(window.innerWidth, ui).sidebarInline || ui.sheet

  // The concept turns the panes into views of the chat, and the session's info into the inspector.
  const concept = ui.design === 'concept'
  const inspectorShown = inspectorFits(window.innerWidth, ui) ? ui.inspectorOpen : ui.inspectorSheet
  const labelOf = (c: CommandSpec) => {
    if (c.id === 'edit.undo') return lastUndo ? `Undo ${lastUndo.label}` : 'Undo'
    if (c.id === 'view.toggleSidebar') return sidebarShown ? 'Hide Sidebar' : 'Show Sidebar'
    if (c.id === 'view.toggleDiff') return concept ? (ui.view === 'changes' ? 'Hide Changes' : 'Show Changes') : ui.diffOpen ? 'Hide Diff' : 'Show Diff'
    if (c.id === 'view.toggleTerminal') return (concept ? ui.view === 'terminal' : ui.terminalOpen) ? 'Hide Terminal' : 'Show Terminal'
    if (c.id === 'session.info' && concept) return inspectorShown ? 'Hide Inspector' : 'Show Inspector'
    if (c.id === 'session.markUnread') return unread ? 'Mark as Read' : 'Mark as Unread'
    return c.label
  }
  return (c) => ({
    label: labelOf(c),
    disabled:
      !!c.arrivesIn ||
      (c.id === 'edit.undo' && !lastUndo) ||
      (NEEDS_TRANSCRIPT.has(c.id) && !reading) ||
      (c.id === 'session.info' && !concept && ui.selection.length !== 1) ||
      (c.id === 'terminal.new' && ui.selection.length !== 1) ||
      (c.id === 'session.stop' && !working) ||
      (c.id === 'view.refreshDiff' && !(concept ? ui.view === 'changes' || inspectorShown : ui.diffOpen)) ||
      (c.id === 'session.merge' && !worktree) ||
      (NEEDS_SESSION.has(c.id) && !one) ||
      (c.id === 'session.fast' && !fastCan) ||
      ((c.id === 'session.markUnread' || c.id === 'session.markCompleted') && !ui.selection.length) ||
      (c.id === 'session.markCompleted' && !marked),
    checked:
      c.id === 'view.toggleGlass'
        ? ui.glassAlways
        : c.id in SORTS
          ? SORTS[c.id] === ui.sort
          : c.id in DIFF_TABS
            ? DIFF_TABS[c.id] === ui.diffTab
            : c.id in DESIGNS
              ? DESIGNS[c.id] === ui.design
              : c.id in VIEWS
                ? VIEWS[c.id] === view
                : c.id === 'session.fast'
                  ? fast
                  : false
  })
}
