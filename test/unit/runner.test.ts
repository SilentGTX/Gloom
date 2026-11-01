// The session runner against the fake claude: the real Agent SDK, driven by
// streams the Phase 0 spike recorded, so every turn plays the same and costs nothing.
import { mkdtempSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { LiveSummary, PromptCard, StreamState } from '../../src/shared/live'
import type { ToolResult, TranscriptEntry } from '../../src/shared/transcript'
import { describeUpdate, Runner } from '../../src/main/claude/runner'
import { mergeProvisional } from '../../src/shared/live'
import { lineEntries } from '../../src/shared/transcript'

const fake = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')

beforeAll(() => {
  process.env.GLOOM_CLAUDE_EXE = fake
  process.env.FAKE_CLAUDE_SPEED = '0'
})

/** A runner on a recorded stream, and everything it reported. */
function run(fixture: string, { resume = false } = {}) {
  process.env.FAKE_CLAUDE_FIXTURE = fixture
  const summaries: LiveSummary[] = []
  const entries: TranscriptEntry[] = []
  const results: Record<string, ToolResult> = {}
  const streams: (StreamState | null)[] = []
  const attention: string[] = []
  const waiters: { pred: (s: LiveSummary) => boolean; resolve(s: LiveSummary): void }[] = []
  const runner = new Runner(
    { id: randomUUID(), cwd: mkdtempSync(join(tmpdir(), 'gloom-runner-')), model: null, mode: 'default', effort: null, resume },
    {
      summary: (s) => {
        summaries.push(s)
        for (const w of [...waiters]) if (w.pred(s)) waiters.splice(waiters.indexOf(w), 1) && w.resolve(s)
      },
      entries: (e, r) => {
        entries.push(...e)
        Object.assign(results, r)
      },
      stream: (s) => streams.push(s),
      closed: () => {},
      settled: () => {},
      attention: (kind) => attention.push(kind),
      rateLimit: () => {},
      models: () => {},
      account: () => {}
    },
    () => false
  )
  /** Resolves with the first summary from now on that matches. */
  const until = (pred: (s: LiveSummary) => boolean, ms = 15_000) =>
    new Promise<LiveSummary>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out; last state ${summaries.at(-1)?.state}`)), ms)
      waiters.push({ pred, resolve: (s) => (clearTimeout(timer), resolve(s)) })
    })
  const card = async <K extends PromptCard['kind']>(kind: K) => {
    const s = await until((s) => s.state === 'waiting' && s.cards.some((c) => c.kind === kind))
    return s.cards.find((c) => c.kind === kind) as Extract<PromptCard, { kind: K }>
  }
  const texts = () => entries.filter((e) => e.kind === 'text').map((e) => (e as { text: string }).text.trim())
  return { runner, summaries, entries, results, streams, attention, until, card, texts }
}

let current: Runner | null = null
afterEach(() => {
  current?.close({ sync: true })
  current = null
})

describe('the session runner', () => {
  it('runs two turns in one process, showing each line as it arrives', async () => {
    const t = run('two-turns')
    current = t.runner
    t.runner.send("Remember the word 'kiwi'. Reply with just: OK", [])
    expect(t.summaries.at(-1)?.state).toBe('starting')
    await t.until((s) => s.state === 'idle')
    expect(t.texts()).toEqual(['OK'])
    expect(t.entries.find((e) => e.kind === 'prompt')).toMatchObject({ text: "Remember the word 'kiwi'. Reply with just: OK" })
    expect(t.attention).toEqual(['finished'])

    t.runner.send('What word did I ask you to remember?', [])
    await t.until((s) => s.state === 'idle')
    expect(t.texts()).toEqual(['OK', 'kiwi'])
    // Replayed at full speed the deltas land inside one throttle window; the stream is cleared when the turn ends.
    expect(t.streams.at(-1)).toBeNull()
  })

  it('queues a message sent while Claude works and sends it when the turn ends', async () => {
    const t = run('two-turns')
    current = t.runner
    t.runner.send("Remember the word 'kiwi'. Reply with just: OK", [])
    t.runner.send('What word did I ask you to remember?', [])
    expect(t.summaries.at(-1)?.queued.map((q) => q.text)).toEqual(['What word did I ask you to remember?'])
    // The first turn ends and the queued message goes at once: Claude keeps working.
    await t.until((s) => s.state === 'working' && s.queued.length === 0)
    await t.until((s) => s.state === 'idle')
    expect(t.texts()).toEqual(['OK', 'kiwi'])
    expect(t.entries.filter((e) => e.kind === 'prompt')).toHaveLength(2)
  })

  it('sends a message mid-turn straight to Claude Code, which folds it into the turn', async () => {
    const t = run('steer-next')
    current = t.runner
    t.runner.send('Run these Bash commands one at a time…', [])
    await t.until((s) => s.activity === 'tool')
    t.runner.send('Change of plan: run no more commands and reply exactly: steered', [])
    // With Claude Code already: no waiting for the turn's end.
    expect(t.summaries.at(-1)?.queued).toEqual([expect.objectContaining({ text: 'Change of plan: run no more commands and reply exactly: steered', sent: true })])
    await t.until((s) => s.state === 'idle')
    expect(t.summaries.at(-1)?.queued).toEqual([])
    const prompts = t.entries.filter((e) => e.kind === 'prompt')
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toMatchObject({ queued: true, text: 'Change of plan: run no more commands and reply exactly: steered' })
    expect(t.entries.filter((e) => e.kind === 'tool')).toHaveLength(1)
    expect(t.texts().at(-1)).toBe('steered')
    // One turn, so one "finished".
    expect(t.attention).toEqual(['finished'])
  })

  it('keeps working when a message sent mid-turn runs as the next turn', async () => {
    const t = run('queue-cli2.1.314')
    current = t.runner
    t.runner.send('Count from 1 to 120, one number per line. No other text.', [])
    await t.until((s) => s.state === 'working' && s.activity !== 'requesting')
    t.runner.send('Reply with exactly: queued message seen', [])
    expect(t.summaries.at(-1)?.queued.map((q) => q.sent)).toEqual([true])
    await t.until((s) => s.state === 'idle')
    // Between the two turns it never went idle: only the last turn called for you.
    expect(t.attention).toEqual(['finished'])
    const prompts = t.entries.filter((e) => e.kind === 'prompt')
    expect(prompts.map((p) => (p as { text: string }).text)).toEqual(['Count from 1 to 120, one number per line. No other text.', 'Reply with exactly: queued message seen'])
    expect(t.texts().at(-1)).toBe('queued message seen')
  })

  it('stops a turn and hands back what was queued', async () => {
    const t = run('interrupt')
    current = t.runner
    t.runner.send('Count from 1 to 400, one number per line. No other text.', [])
    await t.until((s) => s.state === 'working' && s.activity === 'thinking')
    t.runner.send('Queued, then taken back', [])
    const taken = t.runner.interrupt()
    expect(taken.map((q) => q.text)).toEqual(['Queued, then taken back'])
    await t.until((s) => s.state === 'idle')
    // Stopping isn't an error, and nothing calls for your attention.
    expect(t.summaries.at(-1)?.error).toBeNull()
    expect(t.attention).toEqual([])
    expect(t.entries.some((e) => e.kind === 'notice' && e.icon === 'interrupt')).toBe(true)

    t.runner.send('Reply with exactly: still here', [])
    await t.until((s) => s.state === 'idle')
    expect(t.texts().at(-1)).toBe('still here')
  })

  it('retries a rewind Claude Code refused (a message folded into that turn), once and without the check', async () => {
    const t = run('rewind-refused', { resume: true })
    current = t.runner
    // Each launch replays the recording's next process: the refusal, then the turn.
    process.env.FAKE_CLAUDE_SPAWN_COUNTER = join(mkdtempSync(join(tmpdir(), 'gloom-spawns-')), 'n')
    try {
      t.runner.rewindConversation('21f7ef60-894a-4fce-b97c-69c8517aafa0', '6bf11dff-fdf6-43a3-8686-f233a7138fd1')
      t.runner.send('What number did I ask you to remember?', [])
      await t.until((s) => s.state === 'idle' && t.texts().length > 0, 20_000)
      // Carried on from the rewound point, the reply came, and no error was left behind.
      expect(t.texts().at(-1)).toMatch(/4127/)
      expect(t.summaries.at(-1)?.error).toBeNull()
      // The refused try is cleared from what the window shows: your message shows once.
      expect(t.runner.provisional().entries.filter((e) => e.kind === 'prompt')).toHaveLength(1)
    } finally {
      delete process.env.FAKE_CLAUDE_SPAWN_COUNTER
    }
  })

  it('says an error once: the CLI’s own row, no banner repeating it', async () => {
    const t = run('thrash')
    current = t.runner
    t.runner.send('Reply with exactly the word: pong', [])
    await t.until((s) => s.state === 'idle')
    expect(t.entries.filter((e) => e.kind === 'notice' && e.tone === 'error')).toHaveLength(1)
    expect(t.summaries.at(-1)?.error).toBeNull()
    expect(t.attention).toEqual(['failed'])
  })

  it('keeps the banner for an expired login: it carries the Log In button', async () => {
    const t = run('auth-expired')
    current = t.runner
    t.runner.send('Reply with exactly the word: pong', [])
    await t.until((s) => s.state === 'idle')
    expect(t.summaries.at(-1)?.error?.kind).toBe('login')
  })

  it('asks before tools run, and goes on with your answer', async () => {
    const t = run('permission')
    current = t.runner
    t.runner.send('Make hello.txt, then a folder, then delete hello.txt', [])
    const first = await t.card('permission')
    expect(first.toolName).toBe('Write')
    expect(t.attention).toEqual(['waiting'])
    t.runner.answer({ kind: 'permission', requestId: first.requestId, decision: 'once' })
    await t.until((s) => s.state === 'working' && s.cards.length === 0)
    const second = await t.card('permission')
    expect(second.requestId).not.toBe(first.requestId)
    // "Always Allow" says what it allows and where it's kept.
    for (const a of second.always) expect(a.detail).toBeTruthy()
    t.runner.answer({ kind: 'permission', requestId: second.requestId, decision: 'once' })
    await t.until((s) => s.state === 'idle')
    expect(t.results[Object.keys(t.results)[0]]).toBeTruthy()
  })

  it('shows a plan, keeps planning with your note, then approves it into a mode', async () => {
    const t = run('plan')
    current = t.runner
    t.runner.send('Plan how to create notes.txt', [])
    const plan = await t.card('plan')
    expect(plan.plan).toMatch(/notes\.txt/)
    t.runner.answer({ kind: 'plan', requestId: plan.requestId, approve: false, note: 'It also needs a second line: there' })
    await t.until((s) => s.cards.length === 0)
    const again = await t.card('plan')
    t.runner.answer({ kind: 'plan', requestId: again.requestId, approve: true, mode: 'acceptEdits' })
    const after = await t.until((s) => s.cards.length === 0)
    expect(after.mode).toBe('acceptEdits')
    await t.until((s) => s.state === 'idle')
  })

  it('asks Claude’s question with its options', async () => {
    const t = run('question')
    current = t.runner
    t.runner.send('Ask me which fruit I prefer', [])
    const q = await t.card('question')
    expect(q.questions[0]).toMatchObject({ question: 'Which fruit do you prefer?', header: 'Fruit' })
    expect(q.questions[0].options.map((o) => o.label)).toEqual(['Apple', 'Banana'])
    t.runner.answer({ kind: 'question', requestId: q.requestId, answers: { 'Which fruit do you prefer?': 'Banana' } })
    await t.until((s) => s.state === 'idle')
    expect(t.texts().at(-1)).toBe('Banana.')
  })
})

describe('Always Allow, in words', () => {
  it('names the rule and where it’s saved', () => {
    expect(describeUpdate({ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' })).toEqual({
      label: 'Always Allow Bash npm test…',
      detail: 'Saved for you in this project, in .claude/settings.local.json'
    })
    expect(describeUpdate({ type: 'setMode', mode: 'acceptEdits', destination: 'session' }).label).toBe('Allow All Edits')
    expect(describeUpdate({ type: 'addDirectories', directories: ['C:\\work\\api'], destination: 'session' }).label).toBe('Allow Access to api')
  })
})

describe('a message folded into a turn', () => {
  it('shows once: the transcript’s line takes over from Gloom’s copy of it', () => {
    const sent = randomUUID()
    const line = (uuid: string) => ({
      type: 'attachment',
      uuid,
      timestamp: '2026-11-01T12:03:51.718Z',
      attachment: { type: 'queued_command', prompt: 'Change of plan', source_uuid: sent, commandMode: 'prompt' }
    })
    const mine = lineEntries(line(sent), { offset: 0, length: 0 }).entries
    // Claude Code writes it under a uuid of its own, naming yours as source_uuid (CLI 2.1.316).
    const file = lineEntries(line(randomUUID()), { offset: 10, length: 100 }).entries
    expect(file[0]).toMatchObject({ kind: 'prompt', key: sent, queued: true })
    expect(mergeProvisional(file, {}, { entries: mine, results: {} }).entries).toHaveLength(1)
  })
})
