import { describe, expect, it } from 'vitest'
import { isPetKind, PET_KINDS, type LiveSummary } from '@shared/live'
import type { TranscriptEntry } from '@shared/transcript'
import { petDetail, petPick, petState, plain } from '../../src/renderer/src/features/pet/mood'
import { petIdFor } from '../../src/main/pets'

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
