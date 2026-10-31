// The diff pane's data: Claude's edits in the open session (composed from its
// transcript by the transcripts process) and what git sees in its working
// folder (main runs git). Each is read when the pane shows it, and again,
// quietly, as the session changes things; an answer for a session you've left
// is dropped.
import { create } from 'zustand'
import type { SessionDiff, TreeDiff } from '@shared/diff'
import type { DiffTab } from './ui'

export interface Loaded<T> {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** The session it's for. */
  id: string | null
  value: T | null
  error: string | null
}

interface DiffState {
  session: Loaded<SessionDiff>
  tree: Loaded<TreeDiff>
  /** Files folded away, by tab and path. */
  folded: ReadonlySet<string>
  /** Reads a tab for a session. `quiet` keeps what's shown until the answer comes. */
  load(tab: DiffTab, id: string, quiet?: boolean): void
  setFolded(keys: string[], folded: boolean): void
}

const idle = { status: 'idle' as const, id: null, value: null, error: null }
const generation: Record<DiffTab, number> = { session: 0, tree: 0 }

function failure(error: unknown): string {
  return String((error as Error)?.message ?? error).replace(/^.*?Error: /, '')
}

export const useDiff = create<DiffState>()((set, get) => ({
  session: idle,
  tree: idle,
  folded: new Set(),

  load: (tab, id, quiet = false) => {
    const api = window.gloom
    if (!api) return
    const gen = ++generation[tab]
    const current = get()[tab]
    const same = current.id === id
    // Another session's files fold afresh.
    if (!same && current.id) set({ folded: new Set([...get().folded].filter((k) => !k.startsWith(`${tab}:`))) })
    if (!(quiet && same && current.status === 'ready')) set({ [tab]: { status: 'loading', id, value: same ? current.value : null, error: null } } as Partial<DiffState>)
    const read: Promise<SessionDiff | TreeDiff> = tab === 'session' ? api.diff.session(id) : api.diff.tree(id)
    read.then(
      (value) => gen === generation[tab] && set({ [tab]: { status: 'ready', id, value, error: null } } as Partial<DiffState>),
      (error) => gen === generation[tab] && set({ [tab]: { status: 'error', id, value: null, error: failure(error) } } as Partial<DiffState>)
    )
  },

  setFolded: (keys, folded) => {
    const next = new Set(get().folded)
    for (const key of keys) {
      if (folded) next.add(key)
      else next.delete(key)
    }
    set({ folded: next })
  }
}))
