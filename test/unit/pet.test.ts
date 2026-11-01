import { describe, expect, it } from 'vitest'
import { isPetKind, PET_KINDS, type LiveSummary } from '@shared/live'
import type { TranscriptEntry } from '@shared/transcript'
import { othersLine, petCards, petDetail, petPick, petQueue, petState, plain } from '../../src/renderer/src/features/pet/mood'
import { petIdFor } from '../../src/main/pets'
import { nextFrame } from '../../src/renderer/src/features/pet/frames'

const summary = (state: LiveSummary['state'], extra: Partial<LiveSummary> = {}): LiveSummary =>
  ({ state, activity: null, cards: [], queued: [], error: null, lastActive: 0, context: null, ...extra }) as unknown as LiveSummary

const none = new Set<string>()

describe('petPick', () => {
  it('rests when no session is running', () => {
    expect(petPick({}, none)).toEqual({ mood: 'rest', id: null })
    expect(petPick({ a: summary('idle') }, none)).toEqual({ mood: 'rest', id: null })
  })

  it('works while a turn is starting or under way', () => {
    expect(petPick({ a: summary('starting') }, none)).toEqual({ mood: 'busy', id: 'a' })
    expect(petPick({ a: summary('working') }, none)).toEqual({ mood: 'busy', id: 'a' })
  })

  it('needs you when a session waits on a card, even beside busy ones, whichever comes first', () => {
    expect(petPick({ a: summary('working'), b: summary('waiting') }, none)).toEqual({ mood: 'needs', id: 'b' })
    expect(petPick({ b: summary('waiting'), a: summary('working') }, none)).toEqual({ mood: 'needs', id: 'b' })
  })

  it('is ready when a turn finished, unseen, and nothing runs; working wins over it', () => {
    expect(petPick({ a: summary('idle') }, new Set(['a']))).toEqual({ mood: 'ready', id: 'a' })
    expect(petPick({ a: summary('idle'), b: summary('working') }, new Set(['a']))).toEqual({ mood: 'busy', id: 'b' })
    expect(petPick({}, new Set(['gone'])).mood).toBe('rest')
  })
})

describe('petQueue', () => {
  it('orders by urgency, then by how long each has been that way', () => {
    const sessions = {
      ready1: summary('idle', { lastActive: 300 }),
      busyLate: summary('working', { turnStarted: 200, lastActive: 900 }),
      needsLate: summary('waiting', { lastActive: 500 }),
      ready0: summary('idle', { lastActive: 100 }),
      busyEarly: summary('working', { turnStarted: 50, lastActive: 950 }),
      needsEarly: summary('waiting', { lastActive: 400 }),
      quiet: summary('idle', { lastActive: 10 })
    }
    expect(petQueue(sessions, new Set(['ready0', 'ready1'])).map((q) => q.id)).toEqual(['needsEarly', 'needsLate', 'busyEarly', 'busyLate', 'ready0', 'ready1'])
  })

  it('picks the one waiting longest, whatever order Gloom lists them in', () => {
    expect(petPick({ late: summary('waiting', { lastActive: 20 }), early: summary('waiting', { lastActive: 10 }) }, none).id).toBe('early')
    expect(petPick({ early: summary('waiting', { lastActive: 10 }), late: summary('waiting', { lastActive: 20 }) }, none).id).toBe('early')
  })
})

describe('the cards and the others', () => {
  const look = { title: (id: string) => id, stream: () => null, entries: () => [] }
  const sessions = { r: summary('idle', { lastActive: 1 }), w: summary('working', { turnStarted: 5 }), n: summary('waiting', { lastActive: 9 }) }

  it('has a card for each session that wants you, most urgent first', () => {
    expect(petCards(sessions, new Set(['r']), look).map((c) => [c.mood, c.sessionId])).toEqual([['needs', 'n'], ['busy', 'w'], ['ready', 'r']])
  })

  it('counts the cards not on show by state, "more" for the shown card’s own', () => {
    const cards = petCards(sessions, new Set(['r']), look)
    expect(othersLine(cards, 0)).toBe('1 working · 1 ready')
    expect(othersLine(cards, 2)).toBe('1 waiting · 1 working')
    const two = petCards({ a: summary('waiting', { lastActive: 1 }), b: summary('waiting', { lastActive: 2 }) }, none, look)
    expect(othersLine(two, 0)).toBe('1 more waiting')
    expect(othersLine(cards.slice(0, 1), 0)).toBe('')
  })
})

describe('petDetail', () => {
  it('says what a working session is writing, the tool it uses, or what it is doing', () => {
    const stream = { messageId: 'm', blocks: [{ kind: 'text' as const, text: 'First line.\n\nNow **checking** the `build`.' }] }
    expect(petDetail('busy', summary('working'), stream, [])).toBe('Now checking the build.')
    expect(petDetail('busy', summary('working'), { messageId: 'm', blocks: [{ kind: 'tool', text: '', name: 'Bash' }] }, [])).toBe('Using Bash')
    expect(petDetail('busy', summary('working', { activity: 'thinking' }), null, [])).toBe('Thinking…')
  })

  it('says what a waiting session needs, in the CLI’s own words when it has them', () => {
    const card = { kind: 'permission', requestId: 'r', toolName: 'Bash', input: {}, title: 'Claude wants to run npm test', description: null, displayName: null, blockedPath: null }
    expect(petDetail('needs', summary('waiting', { cards: [card] as never }), null, [])).toBe('Claude wants to run npm test')
    expect(petDetail('needs', summary('waiting', { cards: [{ ...card, title: null }] as never }), null, [])).toBe('Wants to use Bash')
    expect(petDetail('needs', summary('waiting', { cards: [{ kind: 'plan', requestId: 'r' }] as never }), null, [])).toBe('Has a plan for you to review')
  })

  it('gives the start of the last reply when a session is done', () => {
    const entries = [
      { kind: 'text', key: '1', time: '', text: 'Earlier.', messageId: null, model: null },
      { kind: 'tool', key: '2', time: '', id: 't', name: 'Bash', input: {}, messageId: null, model: null },
      { kind: 'text', key: '3', time: '', text: '## Done\nThe build passes.', messageId: null, model: null }
    ] as unknown as TranscriptEntry[]
    expect(petDetail('ready', summary('idle'), null, entries)).toBe('Done The build passes.')
    expect(petDetail('ready', summary('idle'), null, [])).toBe('Claude finished')
  })

  it('puts the session’s title with it', () => {
    const state = petState({ a: summary('working', { activity: 'writing' }) }, none, { title: () => 'Fix the pet', stream: () => null, entries: () => [] })
    expect(state).toEqual({ mood: 'busy', title: 'Fix the pet', detail: 'Writing…', sessionId: 'a' })
  })
})

describe('plain', () => {
  it('drops markdown and cuts long text', () => {
    expect(plain('See [the docs](https://x) and ```js\ncode\n``` - done')).toBe('See the docs and - done')
    expect(plain('x'.repeat(200), 20)).toHaveLength(20)
  })
})

describe('pet kinds', () => {
  it('accepts the built-in pets and the ones you create, nothing else', () => {
    for (const kind of PET_KINDS) expect(isPetKind(kind)).toBe(true)
    expect(isPetKind('custom:patch')).toBe(true)
    expect(isPetKind('custom:../etc')).toBe(false)
    expect(isPetKind('custom:')).toBe(false)
    expect(isPetKind('dragon')).toBe(false)
  })

  it('gives a new pet a folder name of its own', () => {
    expect(petIdFor('Patch the Fox!', () => false)).toBe('patch-the-fox')
    expect(petIdFor('Patch', (id) => id === 'patch')).toBe('patch-2')
    expect(petIdFor('✨', () => false)).toBe('pet')
  })
})

describe('nextFrame', () => {
  it('loops every frame by default', () => {
    expect([0, 1, 2, 3].map((at) => nextFrame(at, 4))).toEqual([1, 2, 3, 0])
  })

  it('plays an intro once, then loops from loopFrom', () => {
    // 8 frames: 0-3 bring the laptop out, 4-7 type.
    const seen: number[] = []
    let at = 0
    for (let i = 0; i < 14; i++) {
      seen.push(at)
      at = nextFrame(at, 8, 4)
    }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 4, 5, 6, 7, 4, 5])
  })

  it('ignores a loopFrom outside the loop', () => {
    expect(nextFrame(3, 4, 9)).toBe(0)
    expect(nextFrame(3, 4, 0)).toBe(0)
  })
})
