// What the pet shows: the most urgent session Gloom runs, and what's going on in
// it, as Codex's pet card does: its title, and a line of what Claude is saying or
// doing, what it needs from you, or how it ended. Waiting for you outranks
// working, which outranks a turn that finished and hasn't been looked at yet.
// Nothing going on is a resting pet.
import type { PetState } from '@shared/ipc'
import type { LiveSummary, StreamState } from '@shared/live'
import type { TranscriptEntry } from '@shared/transcript'

export type Mood = PetState['mood']

/** The most urgent session: one waiting on you, else one working, else one finished you haven't looked at. */
export function petPick(sessions: Record<string, LiveSummary | undefined>, finished: ReadonlySet<string>): { mood: Mood; id: string | null } {
  let busy: string | null = null
  let ready: string | null = null
  for (const [id, summary] of Object.entries(sessions)) {
    if (summary?.state === 'waiting') return { mood: 'needs', id }
    if (summary && (summary.state === 'starting' || summary.state === 'working')) busy ??= id
    else if (finished.has(id)) ready ??= id
  }
  if (busy) return { mood: 'busy', id: busy }
  if (ready) return { mood: 'ready', id: ready }
  return { mood: 'rest', id: null }
}

/** Markdown and line breaks off, cut to a line or two. */
export function plain(text: string, max = 160): string {
  const flat = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

const ACTIVITY: Record<string, string> = {
  thinking: 'Thinking…',
  writing: 'Writing…',
  tool: 'Working…',
  compacting: 'Compacting the conversation…',
  requesting: 'Working…'
}

/** The card's line for a session in this mood. */
export function petDetail(mood: Mood, summary: LiveSummary | undefined, stream: StreamState | null | undefined, entries: readonly TranscriptEntry[] | undefined): string {
  if (mood === 'needs') {
    const card = summary?.cards[0]
    if (card?.kind === 'permission') return card.title ? plain(card.title) : `Wants to use ${card.displayName ?? card.toolName}`
    if (card?.kind === 'plan') return 'Has a plan for you to review'
    if (card?.kind === 'question') return 'Has a question for you'
    if (card?.kind === 'offer') return 'Wants to start a session of its own'
    return 'Needs you to continue'
  }
  if (mood === 'busy') {
    // What it's writing right now: the end of the reply as it streams.
    const blocks = (stream?.blocks ?? []).filter((b) => b !== null)
    const last = blocks[blocks.length - 1]
    if (last?.kind === 'text' && last.text.trim()) {
      const lines = last.text.trim().split('\n').filter((l) => l.trim())
      return plain(lines[lines.length - 1] ?? last.text, 140)
    }
    if (last?.kind === 'tool' && last.name) return `Using ${last.name}`
    return ACTIVITY[summary?.activity ?? 'requesting'] ?? 'Working…'
  }
  if (mood === 'ready') {
    // How it ended: the start of its last reply.
    for (let i = (entries?.length ?? 0) - 1; i >= 0; i--) {
      const entry = entries![i]
      if (entry.kind === 'text' && entry.text.trim()) return plain(entry.text)
    }
    return summary?.error ? 'Stopped with an error' : 'Claude finished'
  }
  return ''
}

/** What the pet shows, put together from the sessions. */
export function petState(
  sessions: Record<string, LiveSummary | undefined>,
  finished: ReadonlySet<string>,
  look: { title(id: string): string; stream(id: string): StreamState | null | undefined; entries(id: string): readonly TranscriptEntry[] | undefined }
): PetState {
  const { mood, id } = petPick(sessions, finished)
  if (!id) return { mood, title: '', detail: '', sessionId: null }
  return { mood, title: look.title(id), detail: petDetail(mood, sessions[id], look.stream(id), look.entries(id)), sessionId: id }
}

/** At rest, the card says hello: one of these, a different one each time it shows. */
export const HELLOS = [
  'Ready when you are.',
  'What are we building today?',
  'I’ll keep an eye on your sessions.',
  'Fresh context, fresh coffee.',
  'Ask me anything. Well, ask Claude.',
  'All quiet. Suspiciously quiet.',
  'I tidied the terminal. Kidding.',
  'Drag me anywhere you like.',
  'Click me to hide Gloom, again to bring it back.',
  'Right-click me for pet settings.'
]
