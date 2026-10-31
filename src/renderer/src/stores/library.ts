// The library as the window sees it: a mirror of main's, kept current by its
// broadcasts. Changes go to main as operations; main applies, saves and sends
// the result back. What you change can be undone (Ctrl+Z, or a toast's Undo).
import { useEffect } from 'react'
import { toast } from 'sonner'
import { create } from 'zustand'
import type { ApplyResult } from '@shared/ipc'
import { emptyLibrary, type LibraryData, type LibraryOp, type SessionMeta } from '@shared/library'
import { notify } from '../lib/toast'
import { useUi } from './ui'

/** A change you can take back, named for the Edit menu ("Undo Archive"): a library operation, or another step (a rewind). */
export interface UndoEntry {
  id: string
  label: string
  op?: LibraryOp
  run?: () => void | Promise<void>
}

/** What each undoable change is called. Opening a folder and filing rules aren't undone. */
function undoLabel(op: LibraryOp): string | null {
  switch (op.type) {
    case 'createFolder':
      return 'New Folder'
    case 'renameFolder':
    case 'renameSession':
      return 'Rename'
    case 'moveFolder':
    case 'moveSessions':
      return 'Move'
    case 'deleteFolder':
      return 'Delete Folder'
    case 'setPinned':
      return op.pinned ? 'Pin' : 'Unpin'
    case 'setArchived':
      return op.archived ? 'Archive' : 'Unarchive'
    default:
      return null
  }
}

const UNDO_DEPTH = 50
let undoCount = 0

interface LibraryState {
  rev: number
  library: LibraryData
  sessions: Record<string, SessionMeta>
  /** False until the first index is done, so empty states don't flash at launch. */
  indexed: boolean
  undoStack: UndoEntry[]
  /** Sends an operation to main and remembers how to undo it. Failures show as a toast and resolve to null. */
  apply(op: LibraryOp, options?: { record?: boolean }): Promise<(ApplyResult & { entry?: UndoEntry }) | null>
  /** Takes back the last change, or the one a toast offers. */
  undo(id?: string): Promise<void>
  /** Something outside the library that Edit › Undo can take back too. */
  pushUndo(label: string, run: () => void | Promise<void>): UndoEntry
}

export const useLibrary = create<LibraryState>()((set, get) => ({
  rev: 0,
  library: emptyLibrary(),
  sessions: {},
  indexed: false,
  undoStack: [],
  apply: async (op, { record = true } = {}) => {
    const api = window.gloom
    if (!api) return null
    try {
      const result = await api.applyLibrary(op)
      if (result.rev > get().rev) set({ rev: result.rev, library: result.library })
      const label = record && result.undo ? undoLabel(op) : null
      if (!label || !result.undo) return result
      const entry: UndoEntry = { id: `undo-${++undoCount}`, label, op: result.undo }
      set({ undoStack: [...get().undoStack, entry].slice(-UNDO_DEPTH) })
      return { ...result, entry }
    } catch (error) {
      // "Error invoking remote method 'library:apply': Error: <reason>"
      notify(String((error as Error).message ?? error).replace(/^.*?Error: /, ''))
      return null
    }
  },
  undo: async (id) => {
    const stack = get().undoStack
    const entry = id ? stack.find((e) => e.id === id) : stack.at(-1)
    if (!entry) return
    set({ undoStack: stack.filter((e) => e !== entry) })
    toast.dismiss(entry.id)
    if (entry.run) await entry.run()
    else if (entry.op) await get().apply(entry.op, { record: false })
  },
  pushUndo: (label, run) => {
    const entry: UndoEntry = { id: `undo-${++undoCount}`, label, run }
    set({ undoStack: [...get().undoStack, entry].slice(-UNDO_DEPTH) })
    return entry
  }
}))

/** Applies an operation and offers its Undo in a toast too, for changes that take something out of view. */
export async function applyWithUndo(op: LibraryOp, message: string): Promise<void> {
  const result = await useLibrary.getState().apply(op)
  const entry = result?.entry
  if (entry) notify(message, { id: entry.id, action: { label: 'Undo', onClick: () => void useLibrary.getState().undo(entry.id) } })
}

/** Loads the library and follows main's updates. */
export function useLibraryBridge(): void {
  useEffect(() => {
    const api = window.gloom
    if (!api) return
    let alive = true
    const offLibrary = api.onLibrary(({ rev, library }) => {
      if (rev > useLibrary.getState().rev) useLibrary.setState({ rev, library })
    })
    const offSessions = api.onSessions(({ upsert, remove, indexed }) => {
      const sessions = { ...useLibrary.getState().sessions }
      for (const s of upsert) sessions[s.id] = s
      for (const id of remove) delete sessions[id]
      useLibrary.setState({ sessions, indexed })
    })
    void api.getLibrary().then((snap) => {
      if (!alive) return
      const state = useLibrary.getState()
      useLibrary.setState({
        ...(snap.rev > state.rev ? { rev: snap.rev, library: snap.library } : {}),
        sessions: Object.fromEntries(snap.sessions.map((s) => [s.id, s])),
        indexed: snap.indexed || state.indexed
      })
    })
    return () => {
      alive = false
      offLibrary()
      offSessions()
    }
  }, [])
}

/** The session the chat shows: the one selected, when only one is. */
export function useOpenSession(): SessionMeta | undefined {
  const selection = useUi((s) => s.selection)
  return useLibrary((s) => (selection.length === 1 ? s.sessions[selection[0]] : undefined))
}
