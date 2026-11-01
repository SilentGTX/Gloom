// What the pet shows: the most urgent state across every session Gloom runs.
// Waiting for you outranks working, which outranks a turn that finished and
// hasn't been looked at yet. Nothing going on is a resting pet with no bubble.
import type { LiveSummary } from '@shared/live'

export type Mood = 'rest' | 'busy' | 'needs' | 'ready'

export interface PetMood {
  mood: Mood
  /** What the bubble says; empty when the pet rests. */
  text: string
}

const TEXT: Record<Exclude<Mood, 'rest'>, string> = {
  needs: 'Needs you',
  busy: 'Working…',
  ready: 'Ready for review'
}

export function petMood(sessions: Record<string, LiveSummary | undefined>, finished: ReadonlySet<string>): PetMood {
  const list = Object.entries(sessions)
  let mood: Mood = 'rest'
  for (const [id, summary] of list) {
    if (summary?.state === 'waiting') return { mood: 'needs', text: TEXT.needs }
    if (summary && (summary.state === 'starting' || summary.state === 'working')) mood = 'busy'
    else if (mood === 'rest' && finished.has(id)) mood = 'ready'
  }
  return { mood, text: mood === 'rest' ? '' : TEXT[mood] }
}
