import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanPrompt, collectSessions, indexAll, indexAppended, indexFile, isTranscript, listTranscripts, toMeta } from '../../src/worker/indexer'
import { appendEntries, writeTranscript } from '../support/transcripts'

let projects: string

beforeEach(() => {
  projects = join(mkdtempSync(join(tmpdir(), 'gloom-index-')), 'projects')
  mkdirSync(projects, { recursive: true })
})

const session = { id: '11111111-aaaa-4bbb-8ccc-000000000001', cwd: 'D:\\JS\\Gloom', prompt: 'Build the folder tree' }

describe('listing transcripts', () => {
  it('finds sessions and skips subagent transcripts', () => {
    const file = writeTranscript(projects, session)
    writeFileSync(join(projects, 'D--JS-Gloom', 'agent-a1b2c3.jsonl'), '{}\n')
    mkdirSync(join(projects, 'D--JS-Gloom', session.id, 'subagents'), { recursive: true })
    writeFileSync(join(projects, 'D--JS-Gloom', session.id, 'subagents', 'agent-x.jsonl'), '{}\n')
    writeFileSync(join(projects, 'D--JS-Gloom', 'notes.md'), '# not a transcript\n')
    expect(listTranscripts(projects)).toEqual([file])
    expect(isTranscript(file, projects)).toBe(true)
    expect(isTranscript(join(projects, 'D--JS-Gloom', 'agent-a1b2c3.jsonl'), projects)).toBe(false)
    expect(isTranscript(join(projects, 'D--JS-Gloom', session.id, 'subagents', 'agent-x.jsonl'), projects)).toBe(false)
  })

  it('is empty when Claude Code has no projects folder yet', () => {
    expect(listTranscripts(join(projects, 'missing'))).toEqual([])
  })
})

describe('reading a transcript', () => {
  it('takes the start from the head and the title, last prompt and folder from the tail', () => {
    const file = writeTranscript(projects, { ...session, title: 'Folder tree', created: '2026-10-01T10:00:00.000Z', updated: '2026-10-02T09:30:00.000Z' })
    const meta = toMeta(file, indexFile(file))!
    expect(meta).toMatchObject({
      id: session.id,
      project: 'D--JS-Gloom',
      cwd: 'D:\\JS\\Gloom',
      title: 'Folder tree',
      firstPrompt: 'Build the folder tree',
      lastPrompt: 'Build the folder tree',
      created: Date.parse('2026-10-01T10:00:00.000Z'),
      updated: Date.parse('2026-10-02T09:30:00.000Z'),
      entrypoint: 'cli',
      remote: false
    })
  })

  it("prefers the Claude app's title to the CLI's", () => {
    const file = writeTranscript(projects, { ...session, title: 'CLI title', customTitle: 'My name for it' })
    expect(toMeta(file, indexFile(file))!.title).toBe('My name for it')
  })

  it('finds a title near the end of a big transcript without reading it all', () => {
    // 600 KB of tool output between the prompt and the end: past the first tail chunk.
    const file = writeTranscript(projects, { ...session, title: 'Near the end', padKb: 600 })
    const meta = toMeta(file, indexFile(file))!
    expect(meta.title).toBe('Near the end')
    expect(meta.firstPrompt).toBe('Build the folder tree')
  })

  it('reads further back when the last lines are one huge entry', () => {
    const file = writeTranscript(projects, { ...session, title: 'Before the image' })
    // A 700 KB image result written after the title, as a screenshot would be.
    appendEntries(file, [{ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'i'.repeat(700_000) }] }, timestamp: '2026-10-03T00:00:00.000Z' }])
    const meta = toMeta(file, indexFile(file))!
    expect(meta.title).toBe('Before the image')
    expect(meta.updated).toBe(Date.parse('2026-10-03T00:00:00.000Z'))
  })

  it('falls back to the first prompt when there is no title', () => {
    const file = writeTranscript(projects, session)
    const meta = toMeta(file, indexFile(file))!
    expect(meta.title).toBeNull()
    expect(meta.firstPrompt).toBe('Build the folder tree')
  })

  it('ignores a last line that is still being written', () => {
    const file = writeTranscript(projects, { ...session, title: 'Done' })
    appendFileSync(file, '{"type":"custom-title","customTitle":"Half writ')
    const index = indexFile(file)
    expect(toMeta(file, index)!.title).toBe('Done')
    // Once the line is finished, an append picks it up.
    appendFileSync(file, 'ten"}\n')
    expect(toMeta(file, indexAppended(file, index))!.title).toBe('Half written')
  })

  it('marks copies of sessions that ran on another machine', () => {
    const file = writeTranscript(projects, { ...session, cwd: '/Users/budinoff/home-lab' }, 'ssh-05a46255-e892-4411-9283-be8eacaacc25')
    expect(toMeta(file, indexFile(file))!.remote).toBe(true)
  })

  it('is not a session until it has a prompt', () => {
    const dir = join(projects, 'D--JS-Gloom')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'empty-session.jsonl')
    writeFileSync(file, '{"type":"file-history-snapshot","messageId":"m","snapshot":{}}\n')
    expect(toMeta(file, indexFile(file))).toBeNull()
  })

  it('reads the real spike transcripts', () => {
    const fixtures = join(__dirname, '..', 'fixtures', 'transcripts')
    for (const name of readdirSync(fixtures)) {
      const meta = toMeta(join(fixtures, name), indexFile(join(fixtures, name)))
      expect(meta, name).not.toBeNull()
      expect(meta!.title ?? meta!.firstPrompt, name).toBeTruthy()
      expect(meta!.entrypoint, name).toBe('sdk-ts')
    }
  })
})

describe('keeping up', () => {
  it('reads only what was appended', () => {
    const file = writeTranscript(projects, { ...session, title: 'First title' })
    const before = indexFile(file)
    appendEntries(file, [
      { type: 'user', message: { role: 'user', content: 'Now the session list' }, timestamp: '2026-10-05T12:00:00.000Z', cwd: 'D:\\JS\\Gloom\\app' },
      { type: 'ai-title', aiTitle: 'Second title', sessionId: session.id },
      { type: 'last-prompt', lastPrompt: 'Now the session list', sessionId: session.id }
    ])
    const after = indexAppended(file, before)
    expect(after.end).toBeGreaterThan(before.end)
    expect(toMeta(file, after)).toMatchObject({
      title: 'Second title',
      lastPrompt: 'Now the session list',
      firstPrompt: 'Build the folder tree',
      cwd: 'D:\\JS\\Gloom\\app',
      updated: Date.parse('2026-10-05T12:00:00.000Z')
    })
  })

  it('reads a rewritten (shorter) file afresh', () => {
    const file = writeTranscript(projects, { ...session, title: 'Long one', padKb: 20 })
    const before = indexFile(file)
    writeTranscript(projects, { ...session, title: 'Short one' })
    expect(toMeta(file, indexAppended(file, before))!.title).toBe('Short one')
  })

  it('reuses cached entries whose size and modified time match', () => {
    const a = writeTranscript(projects, session)
    writeTranscript(projects, { ...session, id: '11111111-aaaa-4bbb-8ccc-000000000002', cwd: 'D:\\JS\\Other' })
    const cold = indexAll(projects, {})
    expect(cold.stats).toMatchObject({ files: 2, read: 2 })
    const warm = indexAll(projects, cold.files)
    expect(warm.stats).toMatchObject({ files: 2, read: 0 })
    // Touching one file is a miss for that file only.
    appendEntries(a, [{ type: 'last-prompt', lastPrompt: 'Again', sessionId: session.id }])
    const future = new Date(Date.now() + 5000)
    utimesSync(a, future, future)
    const third = indexAll(projects, warm.files)
    expect(third.stats.read).toBe(1)
    expect(collectSessions(third.files).get(session.id)!.lastPrompt).toBe('Again')
  })

  it('keeps the newer file when two folders hold the same session', () => {
    writeTranscript(projects, { ...session, title: 'Old copy', updated: '2026-10-01T00:00:00.000Z' }, 'D--JS-Old')
    writeTranscript(projects, { ...session, title: 'New copy', updated: '2026-10-09T00:00:00.000Z' }, 'D--JS-New')
    const sessions = collectSessions(indexAll(projects, {}).files)
    expect(sessions.size).toBe(1)
    expect(sessions.get(session.id)!.title).toBe('New copy')
  })
})

describe('prompts as the list shows them', () => {
  it('folds pasted blocks and keeps one line', () => {
    expect(cleanPrompt('review this\n<pasted_content id="7f86">\nlots\nof\ntext\n</pasted_content>\nplease')).toBe('review this [Pasted text] please')
  })

  it('names slash commands', () => {
    expect(cleanPrompt('<command-name>/compact</command-name>\n<command-message>compact</command-message>\n<command-args>keep the plan</command-args>')).toBe(
      '/compact keep the plan'
    )
  })

  it("leaves out a command's output", () => {
    expect(cleanPrompt('<local-command-stdout>Compacted</local-command-stdout>')).toBeNull()
  })
})
