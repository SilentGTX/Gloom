import { describe, expect, it } from 'vitest'
import { applyStreamEvent, compareVersions, finishStreamBlock, mergeProvisional, modelLabel, type StreamState } from '../../src/shared/live'
import type { TranscriptEntry } from '../../src/shared/transcript'

const text = (key: string, t = 0): TranscriptEntry => ({ kind: 'text', key, time: t, text: key, messageId: null, model: null })

describe('the reply as it streams', () => {
  it('builds blocks from the Messages API’s events', () => {
    let s: StreamState | null = null
    s = applyStreamEvent(s, { type: 'message_start', message: { id: 'msg_1' } })
    s = applyStreamEvent(s, { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } })
    s = applyStreamEvent(s, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me ' } })
    s = applyStreamEvent(s, { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'see.' } })
    s = applyStreamEvent(s, { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } })
    s = applyStreamEvent(s, { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } })
    s = applyStreamEvent(s, { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', name: 'Bash' } })
    s = applyStreamEvent(s, { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"command":' } })
    expect(s).toEqual({
      messageId: 'msg_1',
      blocks: [
        { kind: 'thinking', text: 'Let me see.' },
        { kind: 'text', text: 'Hello' },
        { kind: 'tool', text: '{"command":', name: 'Bash' }
      ]
    })
    // Each finished block arrives as its own message, in order.
    s = finishStreamBlock(s, 'msg_1')
    expect(s?.blocks[0]).toBeNull()
    expect(finishStreamBlock(s, 'msg_other')).toBe(s)
    expect(applyStreamEvent(s, { type: 'message_stop' })).toBeNull()
  })

  it('ignores what it doesn’t know', () => {
    const s: StreamState = { messageId: 'm', blocks: [] }
    expect(applyStreamEvent(s, { type: 'ping' })).toBe(s)
    expect(applyStreamEvent(s, null)).toBe(s)
    expect(applyStreamEvent(null, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } })).toBeNull()
  })
})

describe('the stream meeting the file', () => {
  it('adds what the file doesn’t hold yet, after the last line it does', () => {
    const file = [text('a'), text('b')]
    const provisional = { entries: [text('b'), text('c'), text('d')], results: {} }
    expect(mergeProvisional(file, {}, provisional).entries.map((e) => e.key)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('drops a streamed line the file passed by', () => {
    // 'x' never reached the file, but later lines did: the file is the record.
    const file = [text('a'), text('c')]
    const provisional = { entries: [text('x'), text('c'), text('d')], results: {} }
    expect(mergeProvisional(file, {}, provisional).entries.map((e) => e.key)).toEqual(['a', 'c', 'd'])
  })

  it('lets the file’s results win', () => {
    const fromFile = { toolUseId: 't1', isError: false, parts: [], info: { filePath: 'file' }, time: 1 }
    const streamed = { ...fromFile, info: { filePath: 'stream' } }
    const merged = mergeProvisional([], { t1: fromFile }, { entries: [], results: { t1: streamed, t2: { ...streamed, toolUseId: 't2' } } })
    expect(merged.results.t1.info.filePath).toBe('file')
    expect(merged.results.t2.info.filePath).toBe('stream')
  })

  it('leaves the transcript alone when nothing streamed', () => {
    const file = [text('a')]
    expect(mergeProvisional(file, {}, undefined).entries).toBe(file)
  })
})

describe('names and versions', () => {
  it('names models the way the picker does', () => {
    expect(modelLabel(null, [])).toBe('Default')
    expect(modelLabel('claude-opus-5-5', [])).toBe('Opus 5.5')
    expect(modelLabel('claude-haiku-5-5-20261001', [])).toBe('Haiku 5.5')
    expect(modelLabel('sonnet', [{ value: 'sonnet', label: 'Sonnet 5.5', description: '', efforts: [] }])).toBe('Sonnet 5.5')
  })

  it('compares CLI versions', () => {
    expect(compareVersions('2.1.186', '2.1.314')).toBeLessThan(0)
    expect(compareVersions('2.1.314', '2.1.314')).toBe(0)
    expect(compareVersions('2.2.0', '2.1.314')).toBeGreaterThan(0)
  })
})
