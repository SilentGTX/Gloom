// Against your own claude.exe, on Haiku: one short turn, then a resume in a new
// process. It spends a little of your plan's usage, so it only runs when asked:
//   GLOOM_REAL_CLI=1 npx vitest run test/unit/real-cli.test.ts
// The session it makes lives under ~/.claude/projects/*gloom-spike-real* (safe to delete).
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LiveSummary } from '../../src/shared/live'
import type { TranscriptEntry } from '../../src/shared/transcript'
import { Runner } from '../../src/main/claude/runner'

describe.skipIf(!process.env.GLOOM_REAL_CLI)('against your real claude.exe (spends a little usage)', () => {
  it('runs a turn, writes the transcript under the same UUIDs, and resumes in a new process', async () => {
    delete process.env.GLOOM_CLAUDE_EXE
    const cwd = mkdtempSync(join(tmpdir(), 'gloom-spike-real-'))
    const id = randomUUID()
    const summaries: LiveSummary[] = []
    const entries: TranscriptEntry[] = []
    let closed = 0
    const waiters: { pred(s: LiveSummary): boolean; resolve(s: LiveSummary): void }[] = []
    const runner = new Runner(
      { id, cwd, model: 'haiku', mode: 'default', effort: null, resume: false },
      {
        summary: (s) => {
          summaries.push(s)
          for (const w of [...waiters]) if (w.pred(s)) waiters.splice(waiters.indexOf(w), 1) && w.resolve(s)
        },
        entries: (e) => entries.push(...e),
        stream: () => {},
        closed: () => closed++,
        settled: () => {},
        attention: () => {},
        rateLimit: () => {},
        models: () => {},
        account: () => {}
      },
      () => true
    )
    const until = (pred: (s: LiveSummary) => boolean) => new Promise<LiveSummary>((resolve) => waiters.push({ pred, resolve }))
    const texts = () => entries.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text.trim())

    runner.send('Reply with exactly: pong', [])
    const done = await until((s) => s.state === 'idle')
    expect(done.error).toBeNull()
    expect(done.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(texts().join(' ')).toMatch(/pong/i)

    // The CLI writes the transcript too, a little behind the stream, under the same UUIDs:
    // the prompt Gloom sent, and the reply's lines.
    const file = join(homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`)
    const read = () => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { uuid?: string }) : [])
    const keys = entries.filter((e) => e.kind === 'prompt' || e.kind === 'text').map((e) => e.key.split('#')[0])
    const started = Date.now()
    let lines = read()
    while (!keys.every((k) => lines.some((l) => l.uuid === k)) && Date.now() - started < 15_000) {
      await new Promise((r) => setTimeout(r, 100))
      lines = read()
    }
    console.log(`transcript caught up ${Date.now() - started} ms after the turn ended`)
    for (const k of keys) expect(lines.some((l) => l.uuid === k)).toBe(true)

    // The context meter has numbers once a turn has ended.
    await new Promise((r) => setTimeout(r, 1500))
    expect(summaries.at(-1)?.context?.max).toBeGreaterThan(0)

    // Closed (as idle sessions are), it resumes on the next message, remembering.
    runner.close()
    await new Promise<void>((resolve) => {
      const check = () => (closed ? resolve() : setTimeout(check, 50))
      check()
    })
    runner.send('What exact word did I ask you to reply with? Answer with just that word.', [])
    await until((s) => s.state === 'idle')
    expect(texts().at(-1)).toMatch(/pong/i)
    runner.close({ sync: true })
  }, 180_000)

  it('rewinds code from checkpoints (in its process, or one started for it) and carries on from before a message', async () => {
    delete process.env.GLOOM_CLAUDE_EXE
    const cwd = mkdtempSync(join(tmpdir(), 'gloom-spike-real-'))
    const target = join(cwd, 'a.txt')
    writeFileSync(target, 'original\n')
    const id = randomUUID()
    const entries: TranscriptEntry[] = []
    let last: LiveSummary | null = null
    let closed = 0
    const waiters: { pred(s: LiveSummary): boolean; resolve(s: LiveSummary): void }[] = []
    const runner = new Runner(
      { id, cwd, model: 'haiku', mode: 'acceptEdits', effort: null, resume: false },
      {
        summary: (s) => {
          last = s
          for (const w of [...waiters]) if (w.pred(s)) waiters.splice(waiters.indexOf(w), 1) && w.resolve(s)
        },
        entries: (e, _r, reset) => (reset ? entries.splice(0, entries.length, ...e) : entries.push(...e)),
        stream: () => {},
        closed: () => closed++,
        settled: () => {},
        attention: () => {},
        rateLimit: () => {},
        models: () => {},
        account: () => {}
      },
      () => false
    )
    const until = (pred: (s: LiveSummary) => boolean) => new Promise<LiveSummary>((resolve) => waiters.push({ pred, resolve }))
    const turn = async (text: string) => {
      runner.send(text, [])
      const done = await until((s) => s.state === 'idle')
      expect(done.error).toBeNull()
    }
    const prompts: string[] = []
    const sentPrompt = () => entries.filter((e) => e.kind === 'prompt').map((e) => e.key)

    await turn('Use the Write tool to replace the entire contents of a.txt with the single line: changed once')
    prompts.push(...sentPrompt())
    await turn('Use the Edit tool to append a second line to a.txt: changed twice')
    const [u1, u2] = [prompts[0], sentPrompt().find((k) => k !== prompts[0])!]
    expect(readFileSync(target, 'utf8')).toContain('changed twice')

    // From the running process: a preview, then the rewind itself.
    const dry = await runner.rewindCode(u2, true)
    expect(dry.can).toBe(true)
    expect(dry.files.some((f) => f.toLowerCase().endsWith('a.txt'))).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain('changed twice')
    expect((await runner.rewindCode(u2, false)).can).toBe(true)
    expect(readFileSync(target, 'utf8').trim()).toBe('changed once')

    // With the session's process closed: one started just for the rewind.
    runner.close()
    await new Promise<void>((resolve) => {
      const check = () => (closed ? resolve() : setTimeout(check, 50))
      check()
    })
    expect((await runner.rewindCode(u1, false)).can).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('original\n')

    // The conversation: back to before the second message, as an edit does, and on from there.
    const file = join(homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`)
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { uuid?: string; parentUuid?: string | null })
    const at = lines.find((l) => l.uuid === u2)?.parentUuid
    expect(at).toBeTruthy()
    runner.rewindConversation(at!, u2)
    expect(last!.rewoundTo).toBe(u2)
    await turn('List every message I have sent you in this conversation so far, quoted, one per line. Nothing else.')
    const reply = entries.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text).join('\n')
    expect(reply).toMatch(/changed once/)
    expect(reply).not.toMatch(/changed twice/)
    runner.close({ sync: true })
  }, 240_000)
})
