// Against your own claude.exe, on Haiku: one short turn, then a resume in a new
// process. It spends a little of your plan's usage, so it only runs when asked:
//   GLOOM_REAL_CLI=1 npx vitest run test/unit/real-cli.test.ts
// The session it makes lives under ~/.claude/projects/*gloom-spike-real* (safe to delete).
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
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
        models: () => {}
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
})
