import { describe, expect, it } from 'vitest'
import { isPetKind, PET_KINDS, type LiveSummary } from '@shared/live'
import { petMood } from '../../src/renderer/src/features/pet/mood'

const summary = (state: LiveSummary['state']): LiveSummary => ({ state, activity: null, cards: [], queued: 0, error: null, lastActive: 0, context: null }) as unknown as LiveSummary

const none = new Set<string>()

describe('petMood', () => {
  it('rests with no bubble when no session is running', () => {
    expect(petMood({}, none)).toEqual({ mood: 'rest', text: '' })
    expect(petMood({ a: summary('idle') }, none)).toEqual({ mood: 'rest', text: '' })
  })

  it('works while a turn is starting or under way', () => {
    expect(petMood({ a: summary('starting') }, none)).toEqual({ mood: 'busy', text: 'Working…' })
    expect(petMood({ a: summary('working') }, none)).toEqual({ mood: 'busy', text: 'Working…' })
  })

  it('says it needs you when a session is waiting on a card, even beside busy ones', () => {
    expect(petMood({ a: summary('working'), b: summary('waiting') }, none)).toEqual({ mood: 'needs', text: 'Needs you' })
    expect(petMood({ b: summary('waiting'), a: summary('working') }, none).mood).toBe('needs')
  })

  it('is ready for review when a turn finished and nothing is running', () => {
    expect(petMood({ a: summary('idle') }, new Set(['a']))).toEqual({ mood: 'ready', text: 'Ready for review' })
  })

  it('keeps working over ready while another session still runs', () => {
    expect(petMood({ a: summary('idle'), b: summary('working') }, new Set(['a'])).mood).toBe('busy')
  })

  it('ignores a finished id whose session is gone from the list', () => {
    expect(petMood({}, new Set(['gone'])).mood).toBe('rest')
  })
})

describe('pet kinds', () => {
  it('accepts the built-in pets and nothing else', () => {
    for (const kind of PET_KINDS) expect(isPetKind(kind)).toBe(true)
    expect(isPetKind('dragon')).toBe(false)
    expect(isPetKind(undefined)).toBe(false)
  })
})
