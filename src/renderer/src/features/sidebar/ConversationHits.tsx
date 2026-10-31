// Search inside conversations, under the sidebar's title matches: the sessions
// whose messages or tool output say what you typed, with the words in their
// context, as the Claude app's full-text search finds them. The transcripts
// process scans them (newest first) after a pause in your typing.
import { Fragment, useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { displayTitle } from '@shared/library'
import type { TranscriptSearch } from '@shared/ipc'
import { cn } from '../../lib/cn'
import { useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'
import { useConcept } from '../concept/parts'
import { SectionHeading } from './rows'

/** How long typing pauses before the transcripts are searched. */
const PAUSE_MS = 350

/** The search's state: what it found for which words, and whether it's still looking. */
export function useConversationSearch(query: string, includeArchived: boolean): { hits: TranscriptSearch['hits']; searching: boolean; done: string } {
  const [state, setState] = useState<{ hits: TranscriptSearch['hits']; searching: boolean; done: string }>({ hits: [], searching: false, done: '' })
  useEffect(() => {
    const words = query.trim()
    if (words.length < 2) {
      setState({ hits: [], searching: false, done: '' })
      return
    }
    let alive = true
    setState((s) => ({ ...s, searching: true }))
    const timer = setTimeout(() => {
      void window.gloom
        ?.searchTranscripts(words, includeArchived)
        .then((result) => alive && result.done && setState({ hits: result.hits, searching: false, done: words }))
        .catch(() => alive && setState({ hits: [], searching: false, done: words }))
    }, PAUSE_MS)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [query, includeArchived])
  return state
}

/** The snippet with the words you typed marked, wherever they fall. */
function Marked({ text, words }: { text: string; words: string }) {
  const lower = text.toLowerCase()
  const needle = words.toLowerCase()
  const parts: { text: string; hit: boolean }[] = []
  for (let from = 0; from < text.length; ) {
    const at = needle ? lower.indexOf(needle, from) : -1
    if (at < 0) {
      parts.push({ text: text.slice(from), hit: false })
      break
    }
    if (at > from) parts.push({ text: text.slice(from, at), hit: false })
    parts.push({ text: text.slice(at, at + needle.length), hit: true })
    from = at + needle.length
  }
  return (
    <>
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-[var(--accent-fill)] px-px text-inherit">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        )
      )}
    </>
  )
}

/**
 * "In Conversations": the sessions whose transcripts say what you searched for
 * and whose titles didn't already match (those are just above). A click opens
 * one; Find (Ctrl+F) then finds the words in it.
 */
export function ConversationHits({ query, shown, search }: { query: string; shown: ReadonlySet<string>; search: ReturnType<typeof useConversationSearch> }) {
  const concept = useConcept()
  const sessions = useLibrary((s) => s.sessions)
  const entries = useLibrary((s) => s.library.sessions)
  const selection = useUi((s) => s.selection)
  const { hits, searching, done } = search
  const fresh = hits.filter((h) => !shown.has(h.id) && sessions[h.id])
  if (query.trim().length < 2) return null
  if (!fresh.length && !searching) return null
  return (
    <div className="flex flex-col">
      <SectionHeading count={searching ? undefined : fresh.length}>
        <span className="flex items-center gap-1.5">
          In Conversations
          {searching && <LoaderCircle size={11} strokeWidth={2} aria-label="Searching the conversations" className="animate-spin motion-reduce:animate-none" />}
        </span>
      </SectionHeading>
      <ul aria-label="Found in conversations" className="flex flex-col">
        {fresh.map((hit) => {
          const meta = sessions[hit.id]
          const selected = selection.length === 1 && selection[0] === hit.id
          return (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => useUi.getState().select([hit.id])}
                aria-current={selected || undefined}
                className={cn(
                  'session-row no-drag my-px flex w-full flex-col items-stretch rounded-[var(--radius-row)] px-2.5 py-[5px] text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]',
                  selected ? 'is-selected' : 'hover:bg-fill active:bg-fill-pressed'
                )}
              >
                <span className={cn('row-label truncate leading-snug', concept ? 'text-[0.8125rem]' : 'text-[0.875rem] font-semibold')}>{displayTitle(meta, entries[hit.id])}</span>
                <span className="row-secondary line-clamp-2 text-[0.75rem] leading-snug">
                  <Marked text={hit.snippet} words={done} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
