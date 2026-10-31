// The renderer's half of the command registry: handlers for the commands it
// owns, and the bridge that receives accelerators from the main process.
import { useEffect } from 'react'
import { COMMANDS, findCommand, matchesAccelerator, type CommandId, type CommandSpec } from '@shared/commands'
import { useFind } from '../features/chat/find'
import { useWorktrees } from '../features/chat/Worktree'
import { newFolder } from '../features/folders/folders'
import { resumeSession } from '../features/sessions/SessionMenu'
import { screenHasFocus } from '../features/terminal/registry'
import { useDiff } from '../stores/diff'
import { useLibrary } from '../stores/library'
import { isBusy, useLive } from '../stores/live'
import { closePalette, togglePalette } from '../stores/palette'
import { newTerminal, wantFocus } from '../stores/terminals'
import { useTranscript } from '../stores/transcript'
import { useUi } from '../stores/ui'
import { focusPane } from './panes'
import { notify } from './toast'

/** Runs once the sidebar has rendered, wherever it was. */
function inSidebar(viaKeyboard: boolean, then: () => void) {
  useUi.getState().showSidebar(viaKeyboard)
  requestAnimationFrame(() => requestAnimationFrame(then))
}

const handlers: Partial<Record<CommandId, (viaKeyboard: boolean) => void>> = {
  'edit.undo': () => {
    const field = document.activeElement as HTMLElement | null
    if (field && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA' || field.isContentEditable)) document.execCommand('undo')
    else void useLibrary.getState().undo()
  },
  'edit.find': (k) => {
    if (useTranscript.getState().status === 'ready') useFind.getState().show(k)
  },
  // With Find closed, F3 opens it on the last search, as on the Mac.
  'edit.findNext': (k) => (useFind.getState().open ? useFind.getState().step(1) : handlers['edit.find']?.(k)),
  'edit.findPrevious': (k) => (useFind.getState().open ? useFind.getState().step(-1) : handlers['edit.find']?.(k)),
  'session.resume': () => {
    const id = useTranscript.getState().id
    if (id) void resumeSession(id)
  },
  'session.info': () => {
    const ui = useUi.getState()
    if (ui.selection.length === 1) ui.setInfo(!ui.info)
  },
  'session.new': () => useLive.getState().openNewSession(),
  'session.stop': () => {
    const { selection } = useUi.getState()
    if (selection.length === 1 && isBusy(useLive.getState().sessions[selection[0]])) void useLive.getState().stop(selection[0])
  },
  'app.settings': () => useLive.getState().setSettingsOpen(true),
  'folder.new': (k) => inSidebar(k, () => void newFolder(null)),
  'view.palette': (k) => togglePalette(k),
  'view.search': (k) =>
    inSidebar(k, () => {
      const field = document.querySelector<HTMLInputElement>('input[data-search]')
      field?.focus()
      field?.select()
    }),
  'view.nextPane': () => focusPane(1),
  'view.previousPane': () => focusPane(-1),
  'view.toggleSidebar': (k) => useUi.getState().toggleSidebar(k),
  'view.toggleDiff': (k) => useUi.getState().toggleDiff(k),
  'view.diffSession': (k) => {
    useUi.getState().setDiffTab('session')
    useUi.getState().toggleDiff(k, true)
  },
  'view.diffTree': (k) => {
    useUi.getState().setDiffTab('tree')
    useUi.getState().toggleDiff(k, true)
  },
  'view.refreshDiff': () => {
    const { diffOpen, diffTab, selection } = useUi.getState()
    if (diffOpen && selection.length === 1) useDiff.getState().load(diffTab, selection[0], true)
  },
  'view.toggleTerminal': (k) => {
    const ui = useUi.getState()
    // Hidden while you were typing in it, the composer has you back; shown, the shell takes the keyboard.
    if (!ui.terminalOpen) wantFocus()
    else if (screenHasFocus()) document.querySelector<HTMLTextAreaElement>('textarea[data-composer]')?.focus()
    ui.toggleTerminal(k)
  },
  'session.merge': () => {
    const { selection } = useUi.getState()
    const id = selection.length === 1 ? selection[0] : null
    if (id && useWorktrees.getState().info[id]) useWorktrees.setState({ merging: { id, result: null, working: false } })
    else notify('This session doesn’t work in a worktree.')
  },
  'terminal.new': (k) => {
    const { selection } = useUi.getState()
    const session = selection.length === 1 ? useLibrary.getState().sessions[selection[0]] : undefined
    void newTerminal(session?.id ?? null, session?.cwd ?? null, k)
  },
  'view.sortActivity': () => useUi.getState().setSort('activity'),
  'view.sortName': () => useUi.getState().setSort('name'),
  'view.sortCreated': () => useUi.getState().setSort('created'),
  'view.textBigger': () => useUi.getState().stepText(1),
  'view.textSmaller': () => useUi.getState().stepText(-1),
  'view.textReset': () => useUi.getState().resetText(),
  'view.toggleGlass': () => useUi.getState().toggleGlass()
}

/** Commands that leave the command palette up: they work on its field, or only change the text size. */
const KEEPS_PALETTE = new Set<CommandId>(['view.palette', 'edit.undo', 'view.textBigger', 'view.textSmaller', 'view.textReset'])

export function runCommand(id: CommandId, viaKeyboard = false): void {
  const spec = findCommand(id)
  if (!spec || spec.arrivesIn) return
  // The palette makes way for any other command (its shortcut, say), so that command can take the keyboard.
  if (!KEEPS_PALETTE.has(id)) closePalette(viaKeyboard)
  if (spec.runs === 'renderer') handlers[id]?.(viaKeyboard)
  else void window.gloom?.runCommand(id)
}

/** Receives the commands main dispatches (accelerators fire in main's hidden menu). */
export function useCommandBridge(): void {
  useEffect(() => {
    const api = window.gloom
    if (api) return api.onCommand(({ id, viaKeyboard }) => runCommand(id, viaKeyboard))
    // A plain browser has no menu, so match the accelerators here instead.
    const onKey = (event: KeyboardEvent) => {
      const spec = (COMMANDS as readonly CommandSpec[]).find((c) => c.accelerator && matchesAccelerator(c.accelerator, event))
      if (!spec) return
      event.preventDefault()
      runCommand(spec.id as CommandId, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
