// What the pet shows: the most urgent session Gloom runs, and what's going on in
// it, as Codex's pet card does: its title, and a line of what Claude is saying or
// doing, what it needs from you, or how it ended. Waiting for you outranks
// working, which outranks a turn that finished and hasn't been looked at yet.
// Nothing going on is a resting pet.
import type { PetState } from '@shared/ipc'
import type { LiveSummary, StreamState } from '@shared/live'
import type { TranscriptEntry } from '@shared/transcript'

export type Mood = PetState['mood']

/** How urgent each state is: waiting on you, then working, then finished and not yet looked at. */
const RANK: Record<Exclude<Mood, 'rest'>, number> = { needs: 0, busy: 1, ready: 2 }

/**
 * Every session that wants your attention, most urgent first: waiting on you, then
 * working, then finished and not yet looked at. Within each, the one that's been
 * that way longest comes first: waiting longest, working longest (its turn started
 * first), finished longest ago.
 */
export function petQueue(sessions: Record<string, LiveSummary | undefined>, finished: ReadonlySet<string>): { mood: Exclude<Mood, 'rest'>; id: string; since: number }[] {
  const queue: { mood: Exclude<Mood, 'rest'>; id: string; since: number }[] = []
  for (const [id, summary] of Object.entries(sessions)) {
    if (!summary) continue
    if (summary.state === 'waiting') queue.push({ mood: 'needs', id, since: summary.lastActive })
    else if (summary.state === 'starting' || summary.state === 'working') queue.push({ mood: 'busy', id, since: summary.turnStarted ?? summary.lastActive })
    else if (finished.has(id)) queue.push({ mood: 'ready', id, since: summary.lastActive })
  }
  return queue.sort((a, b) => RANK[a.mood] - RANK[b.mood] || a.since - b.since || a.id.localeCompare(b.id))
}

/** The most urgent session (petQueue's first), or rest. */
export function petPick(sessions: Record<string, LiveSummary | undefined>, finished: ReadonlySet<string>): { mood: Mood; id: string | null } {
  const first = petQueue(sessions, finished)[0]
  return first ? { mood: first.mood, id: first.id } : { mood: 'rest', id: null }
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

/** The most cards the pet keeps: you can cycle through these. */
export const PET_CARDS = 8

/** What the pet shows, put together from the sessions: a card for each that wants your attention, most urgent first. Empty at rest. */
export function petCards(
  sessions: Record<string, LiveSummary | undefined>,
  finished: ReadonlySet<string>,
  look: { title(id: string): string; stream(id: string): StreamState | null | undefined; entries(id: string): readonly TranscriptEntry[] | undefined }
): PetState[] {
  return petQueue(sessions, finished)
    .slice(0, PET_CARDS)
    .map(({ mood, id }) => ({ mood, title: look.title(id), detail: petDetail(mood, sessions[id], look.stream(id), look.entries(id)), sessionId: id }))
}

/** The most urgent card alone, or rest. */
export function petState(sessions: Record<string, LiveSummary | undefined>, finished: ReadonlySet<string>, look: Parameters<typeof petCards>[2]): PetState {
  return petCards(sessions, finished, look)[0] ?? { mood: 'rest', title: '', detail: '', sessionId: null }
}

const OTHERS: [Exclude<Mood, 'rest'>, string][] = [
  ['needs', 'waiting'],
  ['busy', 'working'],
  ['ready', 'ready']
]

/** The other cards, counted by state ("1 more waiting · 2 working · 1 ready"); empty when there are none. */
export function othersLine(cards: readonly PetState[], shown: number): string {
  const others = cards.filter((_, i) => i !== shown)
  const showing = cards[shown]?.mood
  return OTHERS.map(([mood, word]) => {
    const n = others.filter((c) => c.mood === mood).length
    return n ? `${n} ${mood === showing ? 'more ' : ''}${word}` : ''
  })
    .filter(Boolean)
    .join(' · ')
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
