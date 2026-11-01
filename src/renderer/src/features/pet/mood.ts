// What the pet shows: the most urgent state across every session Gloom runs.
// Waiting for you outranks working, which outranks a turn that finished and
// hasn't been looked at yet. Nothing going on is a resting pet with no bubble.
import type { PetState } from '@shared/ipc'
import type { LiveSummary } from '@shared/live'

export type Mood = PetState['mood']
export type PetMood = PetState

const TEXT: Record<Exclude<Mood, 'rest'>, string> = {
  needs: 'Needs you',
  busy: 'Working…',
  ready: 'Ready for review'
}

export function petMood(sessions: Record<string, LiveSummary | undefined>, finished: ReadonlySet<string>): PetMood {
  let mood: Mood = 'rest'
  for (const [id, summary] of Object.entries(sessions)) {
    if (summary?.state === 'waiting') return { mood: 'needs', text: TEXT.needs }
    if (summary && (summary.state === 'starting' || summary.state === 'working')) mood = 'busy'
    else if (mood === 'rest' && finished.has(id)) mood = 'ready'
  }
  return { mood, text: mood === 'rest' ? '' : TEXT[mood] }
}
