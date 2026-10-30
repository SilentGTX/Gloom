import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ImagePart, TextPart, TranscriptEntry } from '../../src/shared/transcript'
import { Follower, readBlob, readPage } from '../../src/worker/reader'
import { ChatBuilder, imageBlock, pngBase64 } from '../support/chat'

let projects: string
beforeEach(() => {
  projects = join(mkdtempSync(join(tmpdir(), 'gloom-reader-')), 'projects')
  mkdirSync(projects, { recursive: true })
})

const ID = 'cccccccc-0000-4000-8000-000000000001'
const chat = () => new ChatBuilder(ID, 'D:\\Work\\api')
const kinds = (entries: TranscriptEntry[]) => entries.map((e) => (e.kind === 'prompt' ? `prompt:${e.command ?? e.text}` : e.kind === 'text' ? `text:${e.text}` : e.kind === 'tool' ? `tool:${e.name}` : e.kind))

describe('the newest page', () => {
  it('shows the conversation oldest first, each tool call with its result', () => {
    const c = chat()
    c.prompt('Add rate limiting')
    c.respond().thinking('Where are the routes?', 1200).text('Looking at the routes.')
    c.tool({ name: 'Bash', input: { command: 'npm test' }, content: '3 passed', report: { stdout: '3 passed', stderr: '', interrupted: false } })
    c.respond().text('Done: tests pass.')
    c.stop().title('API rate limits')
    const { page } = readPage(c.write(projects), null)
    expect(kinds(page.entries)).toEqual(['prompt:Add rate limiting', 'thinking', 'text:Looking at the routes.', 'tool:Bash', 'text:Done: tests pass.'])
    const call = page.entries.find((e) => e.kind === 'tool')!
    expect(call.kind === 'tool' && page.results[call.id]).toMatchObject({ isError: false, parts: [{ type: 'text', text: '3 passed' }], info: { stdout: { text: '3 passed' } } })
    expect(page.older).toBeNull()
  })

  it('finds every parallel call’s result, though only the last hangs on the chain', () => {
    const c = chat()
    c.prompt('Read both files')
    c.respond().parallel([
      { name: 'Read', input: { file_path: 'a.ts' }, content: 'A' },
      { name: 'Read', input: { file_path: 'b.ts' }, content: 'B' },
      { name: 'Grep', input: { pattern: 'limit' }, content: 'C' }
    ])
    c.respond().text('Both read.')
    const { page } = readPage(c.write(projects), null)
    const calls = page.entries.filter((e) => e.kind === 'tool')
    expect(calls).toHaveLength(3)
    expect(calls.map((e) => e.kind === 'tool' && (page.results[e.id]?.parts[0] as TextPart).text)).toEqual(['A', 'B', 'C'])
  })

  it('leaves out a branch a rewind abandoned', () => {
    const c = chat()
    const first = c.prompt('Version one')
    c.respond().text('Answer one')
    const kept = c.parent!
    c.prompt('Abandoned question')
    c.respond().text('Abandoned answer')
    // Rewound to after the first answer, then asked again.
    c.rewindTo(kept).wait(60)
    c.prompt('Better question')
    c.respond().text('Better answer')
    const { page } = readPage(c.write(projects), null)
    expect(kinds(page.entries)).toEqual(['prompt:Version one', 'text:Answer one', 'prompt:Better question', 'text:Better answer'])
    expect(first).toBeTruthy()
  })

  it('hides what the model gets but you never typed, and notes entry types it doesn’t know', () => {
    const c = chat()
    c.meta({ type: 'file-history-snapshot', messageId: 'm', snapshot: {} })
    c.prompt('Hi')
    c.attachment({ type: 'total_tokens_reminder', used: 1 })
    c.respond().thinking('', 900).text('Hello')
    c.meta({ type: 'brand-new-thing', sessionId: ID })
    c.stop()
    const read = readPage(c.write(projects), null)
    expect(kinds(read.page.entries)).toEqual(['prompt:Hi', 'thinking', 'text:Hello'])
    expect(read.unknown).toEqual(['brand-new-thing'])
  })

  it('shows commands, their output, interruptions, task reports and retried API errors as what they are', () => {
    const c = chat()
    c.command('model', 'sonnet', 'Set model to sonnet')
    c.prompt('Go')
    c.respond().text('Working')
    c.interrupted()
    c.apiError(529, 1, 10).apiError(529, 2, 10)
    c.taskNotification('Background command "Render" completed (exit code 0)')
    const { page } = readPage(c.write(projects), null)
    expect(page.entries.map((e) => e.kind)).toEqual(['prompt', 'output', 'prompt', 'text', 'notice', 'notice', 'notice', 'notice'])
    expect(page.entries[0]).toMatchObject({ kind: 'prompt', command: '/model sonnet' })
    expect(page.entries[1]).toMatchObject({ kind: 'output', stdout: 'Set model to sonnet' })
    expect(page.entries[4]).toMatchObject({ kind: 'notice', icon: 'interrupt', text: 'Interrupted' })
    expect(page.entries[5]).toMatchObject({ kind: 'notice', icon: 'error', text: 'The request failed (529) · retry 1 of 10' })
    expect(page.entries[7]).toMatchObject({ kind: 'notice', icon: 'task', text: 'Background command "Render" completed (exit code 0)' })
  })
})

describe('older pages', () => {
  it('splits a long session at the start of turns, and pages back to its beginning', () => {
    const c = chat()
    for (let i = 0; i < 60; i++) {
      c.wait(30).prompt(`Question ${i}`)
      c.respond().text(`Answer ${i}`)
      c.tool({ name: 'Bash', input: { command: `echo ${i}` }, content: `${i}` })
      c.respond().text(`Done ${i}`)
    }
    const file = c.write(projects)
    let read = readPage(file, null).page
    const pages = [read]
    while (read.older) {
      read = readPage(file, read.older).page
      pages.push(read)
    }
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages) expect(p.entries[0].kind).toBe('prompt')
    const prompts = pages.reverse().flatMap((p) => p.entries.filter((e) => e.kind === 'prompt').map((e) => (e.kind === 'prompt' ? e.text : '')))
    expect(prompts).toEqual(Array.from({ length: 60 }, (_, i) => `Question ${i}`))
  })

  it('stops at a compaction, and Show Earlier reads the conversation before it', () => {
    const c = chat()
    c.prompt('Before the compaction')
    c.respond().text('Early answer')
    c.compact('We added rate limiting.')
    c.prompt('After it')
    c.respond().text('Late answer')
    const file = c.write(projects)
    const { page } = readPage(file, null)
    expect(kinds(page.entries)).toEqual(['compact', 'summary', 'prompt:After it', 'text:Late answer'])
    expect(page.older).toBeNull()
    const compact = page.entries[0]
    expect(compact).toMatchObject({ kind: 'compact', trigger: 'auto', preTokens: 180_000 })
    const earlier = compact.kind === 'compact' ? compact.earlier : null
    expect(earlier).not.toBeNull()
    expect(kinds(readPage(file, earlier).page.entries)).toEqual(['prompt:Before the compaction', 'text:Early answer'])
  })

  it('comes back empty when the conversation before a compaction isn’t in the file', () => {
    const c = chat()
    c.parent = 'not-in-this-file'
    c.compact('Carried over from a fork.')
    c.prompt('Continue')
    const file = c.write(projects)
    const compact = readPage(file, null).page.entries[0]
    expect(compact.kind === 'compact' && compact.earlier).toBeTruthy()
    expect(readPage(file, compact.kind === 'compact' ? compact.earlier : null).page.entries).toEqual([])
  })
})

describe('what a page leaves in the file', () => {
  it('reads an image as a data URL only when asked', () => {
    const c = chat()
    const png = pngBase64(4, 3, () => [91, 91, 214])
    c.prompt([imageBlock(png), { type: 'text', text: 'What is this?' }])
    c.respond().tool({ name: 'mcp__Claude_Browser__computer', input: { action: 'screenshot' }, content: [imageBlock(png)] })
    const file = c.write(projects)
    const { page } = readPage(file, null)
    const prompt = page.entries[0]
    expect(prompt).toMatchObject({ kind: 'prompt', text: 'What is this?' })
    const image = prompt.kind === 'prompt' ? prompt.images[0] : undefined
    expect(JSON.stringify(page)).not.toContain(png)
    expect(readBlob(file, image!.ref)).toBe(`data:image/png;base64,${png}`)
    const call = page.entries.find((e) => e.kind === 'tool')!
    const shot = call.kind === 'tool' ? (page.results[call.id].parts[0] as ImagePart) : undefined
    expect(readBlob(file, shot!.ref)).toBe(`data:image/png;base64,${png}`)
  })

  it('cuts long output short and reads the whole of it on request', () => {
    const c = chat()
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n')
    c.prompt('Show me the log')
    c.respond().tool({ name: 'Bash', input: { command: 'cat log' }, content: long, report: { stdout: long, stderr: '' } })
    const file = c.write(projects)
    const { page } = readPage(file, null)
    const call = page.entries.find((e) => e.kind === 'tool')!
    const part = (call.kind === 'tool' ? page.results[call.id].parts[0] : undefined) as TextPart
    expect(part.text.split('\n')).toHaveLength(120)
    expect(readBlob(file, part.more!)).toBe(long)
  })

  it('refuses references outside the file', () => {
    const c = chat()
    c.prompt('Hi')
    const file = c.write(projects)
    expect(() => readBlob(file, '999999:10:message')).toThrow()
    expect(() => readBlob(file, '../etc')).toThrow()
  })
})

describe('following a transcript as it grows', () => {
  it('sends what continues the chain, and results that arrive on side branches', () => {
    const c = chat()
    c.prompt('Start')
    c.respond().text('Thinking about it')
    const file = c.write(projects)
    const follower = new Follower(file, readPage(file, null))
    expect(follower.update()).toBeNull()

    const before = c.lines.length
    c.respond().parallel([
      { name: 'Read', input: { file_path: 'a.ts' }, content: 'A' },
      { name: 'Read', input: { file_path: 'b.ts' }, content: 'B' }
    ])
    appendFileSync(file, c.lines.slice(before).map((l) => JSON.stringify(l)).join('\n') + '\n')
    const update = follower.update()
    expect(update?.type).toBe('append')
    if (update?.type !== 'append') return
    expect(kinds(update.entries)).toEqual(['tool:Read', 'tool:Read'])
    expect(Object.keys(update.results)).toHaveLength(2)
  })

  it('reads the newest page again after a rewind, a rewrite or with the file gone', () => {
    const c = chat()
    const first = c.prompt('One')
    c.respond().text('Answer one')
    c.prompt('Two')
    c.respond().text('Answer two')
    const file = c.write(projects)
    const follower = new Follower(file, readPage(file, null))

    const before = c.lines.length
    c.rewindTo(first).wait(30)
    c.respond().text('Answer one, again')
    appendFileSync(file, c.lines.slice(before).map((l) => JSON.stringify(l)).join('\n') + '\n')
    const update = follower.update()
    expect(update?.type).toBe('reload')
    if (update?.type === 'reload') expect(kinds(update.page.entries)).toEqual(['prompt:One', 'text:Answer one, again'])

    writeFileSync(file, c.lines.slice(0, 2).map((l) => JSON.stringify(l)).join('\n') + '\n')
    expect(follower.update()?.type).toBe('reload')
    rmSync(file)
    expect(follower.update()).toEqual({ type: 'gone' })
  })
})
