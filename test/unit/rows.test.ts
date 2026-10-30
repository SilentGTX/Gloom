import { describe, expect, it } from 'vitest'
import type { ToolResult, TranscriptEntry } from '../../src/shared/transcript'
import { findMatches } from '../../src/renderer/src/features/chat/find'
import { buildRows, countMatches, stripMarkdown } from '../../src/renderer/src/features/chat/rows'
import { describeTool, modelName } from '../../src/renderer/src/features/chat/tools'

const T0 = Date.parse('2026-10-30T09:00:00Z')
const at = (s: number) => T0 + s * 1000

const prompt = (key: string, s: number, text = key): TranscriptEntry => ({ kind: 'prompt', key, time: at(s), text, images: [] })
const text = (key: string, s: number, body = key): TranscriptEntry => ({ kind: 'text', key, time: at(s), text: body, messageId: 'm', model: 'claude-opus-5-5' })
const tool = (key: string, s: number, id = key): TranscriptEntry => ({ kind: 'tool', key, time: at(s), id, name: 'Bash', input: { command: 'npm test' }, messageId: 'm', model: 'claude-opus-5-5' })
const result = (id: string, out: string): ToolResult => ({ toolUseId: id, isError: false, parts: [{ type: 'text', text: out }], info: {}, time: 0 })

describe('rows', () => {
  it('times each finished turn under its reply, with the model that gave it', () => {
    const rows = buildRows([prompt('p1', 0), text('a1', 5), tool('t1', 20), text('a2', 133), prompt('p2', 200), text('a3', 210)], {})
    expect(rows.map((r) => r.kind)).toEqual(['time', 'prompt', 'text', 'tool', 'text', 'turn', 'prompt', 'text', 'turn'])
    const turn = rows[5]
    expect(turn.kind === 'turn' && turn).toMatchObject({ ms: 133_000, model: 'claude-opus-5-5' })
  })

  it('leaves a session that’s still running without a time, its unanswered calls spinning', () => {
    const rows = buildRows([prompt('p1', 0), tool('t1', 3), tool('t2', 4)], { t1: result('t1', 'ok') }, { live: true })
    expect(rows.some((r) => r.kind === 'turn')).toBe(false)
    expect(rows.filter((r) => r.kind === 'tool').map((r) => r.kind === 'tool' && r.running)).toEqual([false, true])
  })

  it('drops thinking it can’t show, folds repeated API errors, and puts the summary with its compaction', () => {
    const rows = buildRows(
      [
        { kind: 'compact', key: 'c', time: at(0), trigger: 'auto', preTokens: 1000, earlier: null },
        { kind: 'summary', key: 's', time: at(1), text: 'We did things.' },
        prompt('p', 2),
        { kind: 'thinking', key: 'th', time: at(3), text: '', ms: 800, messageId: 'm', model: null },
        { kind: 'notice', key: 'e1', time: at(4), tone: 'warning', icon: 'error', text: 'The request failed (529) · retry 1 of 10' },
        { kind: 'notice', key: 'e2', time: at(5), tone: 'warning', icon: 'error', text: 'The request failed (529) · retry 2 of 10' },
        text('a', 6)
      ],
      {}
    )
    expect(rows.map((r) => r.kind)).toEqual(['time', 'compact', 'prompt', 'notice', 'text', 'turn'])
    expect(rows[1].kind === 'compact' && rows[1].summary?.text).toBe('We did things.')
    expect(rows[3].kind === 'notice' && rows[3].repeats).toBe(2)
  })

  it('shows the time again after a long pause', () => {
    const rows = buildRows([prompt('p1', 0), text('a1', 5), prompt('p2', 3 * 3600), text('a2', 3 * 3600 + 5)], {})
    expect(rows.filter((r) => r.kind === 'time')).toHaveLength(2)
  })
})

describe('find', () => {
  it('counts what a row shows before what it hides, so folded details open to show theirs', () => {
    const rows = buildRows([prompt('p', 0, 'run the tests'), tool('t', 1), text('a', 2, 'The **tests** pass.')], { t: result('t', 'tests: 3 passed') })
    const matches = findMatches(rows, 'TESTS')
    expect(matches.map((m) => [rows[m.rowIndex].kind, m.hidden])).toEqual([
      ['prompt', false],
      ['tool', true],
      ['text', false]
    ])
  })

  it('matches what markdown shows, not its syntax', () => {
    expect(stripMarkdown('See **the** [docs](https://x.dev) and `code`')).toBe('See the docs and code')
    expect(countMatches(stripMarkdown('**bold**text'), 'boldtext')).toBe(1)
  })
})

describe('tool lines', () => {
  it('says what a call did, with its diff stats', () => {
    const edit: TranscriptEntry = { kind: 'tool', key: 'e', time: 0, id: 'e', name: 'Edit', input: { file_path: 'D:\\JS\\Gloom\\src\\foo.ts' }, messageId: null, model: null }
    const view = describeTool(edit as never, { toolUseId: 'e', isError: false, parts: [], info: { added: 12, removed: 3 }, time: 0 })
    expect(view).toMatchObject({ verb: 'Edited', target: 'foo.ts', added: 12, removed: 3, mono: true })
    const mcp = describeTool({ ...edit, name: 'mcp__Claude_Browser__navigate', input: { url: 'https://www.example.com/docs' } } as never, undefined)
    expect(mcp).toMatchObject({ verb: 'Navigate', target: 'example.com/docs', note: 'Claude Browser' })
  })

  it('names models as people say them', () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelName('claude-fable-5')).toBe('Fable 5')
    expect(modelName(null)).toBeNull()
  })
})
