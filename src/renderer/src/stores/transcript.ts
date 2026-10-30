// The open session's transcript: its newest page, older pages as you scroll up,
// and what Claude Code appends while you watch. Pages come from the transcripts
// process, which reads the file; the window only ever holds what it shows.
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Cursor, ToolResult, TranscriptEntry, TranscriptPage, TranscriptUpdate } from '@shared/transcript'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface TranscriptState {
  id: string | null
  /** False while the session has no transcript file yet (a new one): nothing to read, nothing to follow. */
  readable: boolean
  status: Status
  error: string | null
  entries: TranscriptEntry[]
  results: Record<string, ToolResult>
  /** Where the next older page starts; null at the start or at a compaction. */
  older: Cursor | null
  loadingOlder: boolean
  /** Compactions whose earlier conversation was asked for, by entry key. */
  earlier: Record<string, 'loading' | 'shown' | 'missing'>
  /** Rows you opened: tool details, thinking, summaries. */
  expanded: ReadonlySet<string>
  /** Counts up when the rows are replaced wholesale, so the list starts afresh at the bottom. */
  epoch: number
  /** Shows a session's transcript (null shows none). A session without a file yet opens empty, and reads once it has one. */
  open(id: string | null, readable?: boolean): void
  loadOlder(): void
  /** Reads the conversation before a compaction. */
  showEarlier(compactKey: string): void
  setExpanded(key: string, open: boolean): void
}

/** Responses for a session you've since left are dropped. */
let generation = 0

const dedupe = (entries: TranscriptEntry[]) => {
  const seen = new Set<string>()
  return entries.filter((e) => !seen.has(e.key) && !!seen.add(e.key))
}

function failure(error: unknown): string {
  // "Error invoking remote method 'transcript:read': Error: <reason>"
  return String((error as Error)?.message ?? error).replace(/^.*?Error: /, '')
}

export const useTranscript = create<TranscriptState>()((set, get) => {
  const read = (cursor: Cursor | null, follow: boolean): Promise<TranscriptPage> => {
    const { id } = get()
    const api = window.gloom
    if (!api || !id) return Promise.reject(new Error('No transcript is open.'))
    return api.readTranscript({ id, cursor, follow })
  }

  return {
    id: null,
    readable: true,
    status: 'idle',
    error: null,
    entries: [],
    results: {},
    older: null,
    loadingOlder: false,
    earlier: {},
    expanded: new Set(),
    epoch: 0,

    open: (id, readable = true) => {
      const s = get()
      if (id === s.id && (readable === s.readable || !readable)) return
      const gen = ++generation
      // The file just appeared under a session you're watching: read it in place, keeping what's open.
      const same = id === s.id
      set({
        id,
        readable,
        status: !id ? 'idle' : readable ? (same ? s.status : 'loading') : 'ready',
        error: null,
        ...(same ? {} : { entries: [], results: {}, older: null, loadingOlder: false, earlier: {}, expanded: new Set<string>(), epoch: s.epoch + 1 })
      })
      if (!id || !readable) {
        void window.gloom?.unfollowTranscript()
        return
      }
      read(null, true).then(
        (page) => gen === generation && set({ status: 'ready', entries: page.entries, results: page.results, older: page.older }),
        (error) => gen === generation && set({ status: 'error', error: failure(error) })
      )
    },

    loadOlder: () => {
      const { older, loadingOlder, status } = get()
      if (!older || loadingOlder || status !== 'ready') return
      const gen = generation
      set({ loadingOlder: true })
      read(older, false).then(
        (page) => {
          if (gen !== generation) return
          const s = get()
          set({ entries: dedupe([...page.entries, ...s.entries]), results: { ...page.results, ...s.results }, older: page.older, loadingOlder: false })
        },
        () => gen === generation && set({ loadingOlder: false, older: null })
      )
    },

    showEarlier: (compactKey) => {
      const s = get()
      const at = s.entries.findIndex((e) => e.key === compactKey)
      const compact = s.entries[at]
      if (compact?.kind !== 'compact' || !compact.earlier || s.earlier[compactKey]) return
      const gen = generation
      set({ earlier: { ...s.earlier, [compactKey]: 'loading' } })
      read(compact.earlier, false).then(
        (page) => {
          if (gen !== generation) return
          const now = get()
          if (!page.entries.length) {
            set({ earlier: { ...now.earlier, [compactKey]: 'missing' } })
            return
          }
          // The compaction heads what's loaded, so the earlier conversation goes above it.
          const i = now.entries.findIndex((e) => e.key === compactKey)
          set({
            entries: dedupe([...now.entries.slice(0, i), ...page.entries, ...now.entries.slice(i)]),
            results: { ...page.results, ...now.results },
            older: page.older,
            earlier: { ...now.earlier, [compactKey]: 'shown' }
          })
        },
        () => gen === generation && set({ earlier: { ...get().earlier, [compactKey]: 'missing' } })
      )
    },

    setExpanded: (key, open) => {
      const expanded = get().expanded
      if (expanded.has(key) === open) return
      const next = new Set(expanded)
      if (open) next.add(key)
      else next.delete(key)
      set({ expanded: next })
    }
  }
})

/** Applies what the transcripts process reports about the open transcript. */
function applyUpdate(update: TranscriptUpdate): void {
  const s = useTranscript.getState()
  if (s.status !== 'ready') return
  if (update.type === 'gone') {
    useTranscript.setState({ status: 'error', error: 'Its transcript file is gone.' })
    return
  }
  if (update.type === 'append') {
    useTranscript.setState({ entries: update.entries.length ? dedupe([...s.entries, ...update.entries]) : s.entries, results: { ...s.results, ...update.results } })
    return
  }
  // The newest page, read again: keep what's loaded above where it starts.
  const { page } = update
  const start = page.entries.length ? s.entries.findIndex((e) => e.key === page.entries[0].key) : -1
  useTranscript.setState(
    start >= 0
      ? { entries: [...s.entries.slice(0, start), ...page.entries], results: { ...s.results, ...page.results } }
      : { entries: page.entries, results: page.results, older: page.older, earlier: {}, epoch: s.epoch + 1 }
  )
}

/** Follows the open transcript's changes. */
export function useTranscriptBridge(): void {
  useEffect(() => {
    const api = window.gloom
    if (!api) return
    return api.onTranscript(({ id, update }) => {
      if (id === useTranscript.getState().id) applyUpdate(update)
    })
  }, [])
}
