// The renderer's half of the command registry: handlers for the commands it
// owns, and the bridge that receives accelerators from the main process.
import { useEffect } from 'react'
import { COMMANDS, findCommand, type CommandId, type CommandSpec } from '@shared/commands'
import { useFind } from '../features/chat/find'
import { newFolder } from '../features/folders/FolderColumn'
import { resumeSession } from '../features/sessions/SessionMenu'
import { useLibrary } from '../stores/library'
import { useTranscript } from '../stores/transcript'
import { useUi } from '../stores/ui'

/** Runs once the folders have rendered, wherever they were. */
function afterFolders(viaKeyboard: boolean, then: () => void) {
  useUi.getState().showFolders(viaKeyboard)
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
  'folder.new': (k) => afterFolders(k, () => void newFolder(null)),
  'view.search': (k) =>
    afterFolders(k, () => {
      const field = document.querySelector<HTMLInputElement>('input[data-search]')
      field?.focus()
      field?.select()
    }),
  'view.toggleFolders': (k) => useUi.getState().toggleFolders(k),
  'view.toggleSessions': (k) => useUi.getState().toggleSessions(k),
  'view.textBigger': () => useUi.getState().stepText(1),
  'view.textSmaller': () => useUi.getState().stepText(-1),
  'view.textReset': () => useUi.getState().resetText(),
  'view.toggleGlass': () => useUi.getState().toggleGlass()
}

export function runCommand(id: CommandId, viaKeyboard = false): void {
  const spec = findCommand(id)
  if (!spec || spec.arrivesIn) return
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
      const spec = (COMMANDS as readonly CommandSpec[]).find((c) => c.accelerator && matches(c.accelerator, event))
      if (!spec) return
      event.preventDefault()
      runCommand(spec.id as CommandId, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function matches(accelerator: string, event: KeyboardEvent): boolean {
  const parts = accelerator.split('+')
  const key = parts.pop()!.toLowerCase()
  const want = new Set(parts.map((p) => (p === 'CmdOrCtrl' ? 'ctrl' : p.toLowerCase())))
  return (
    event.key.toLowerCase() === key &&
    event.ctrlKey === want.has('ctrl') &&
    event.altKey === want.has('alt') &&
    event.shiftKey === want.has('shift')
  )
}
