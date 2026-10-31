// What part A of the Claude-app parity work adds that runs without a window:
// settings (and the move from the old single notifications switch), branch
// prefixes, notification levels, archiving inactive sessions, worktrees in a
// folder of your own, unread marks and a session's folders, search inside
// conversations, and export names.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { worktreeOf } from '../../src/shared/git'
import { applyOp, emptyLibrary, inactiveSessions, type SessionMeta } from '../../src/shared/library'
import { branchPrefixProblem, DEFAULT_SETTINGS, noticeLevel } from '../../src/shared/live'
import { cleanSettings } from '../../src/main/claude/settings'
import { lineText, searchFile, snippet } from '../../src/worker/search'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-10-31T12:00:00Z')

function meta(id: string, updated: number, extra: Partial<SessionMeta> = {}): SessionMeta {
  return { id, file: `C:\\p\\${id}.jsonl`, project: 'p', cwd: 'C:\\work', title: id, firstPrompt: null, lastPrompt: null, created: updated, updated, size: 1, entrypoint: 'cli', gitBranch: null, version: null, remote: false, ...extra }
}

describe('settings', () => {
  it('turns every kind of notification off when the old switch was off', () => {
    const s = cleanSettings({ notifications: false })
    expect([s.notifyPermission, s.notifyQuestion, s.notifyFinished]).toEqual(['off', 'off', 'off'])
  })

  it('keeps the new levels once they exist, whatever the old switch said', () => {
    const s = cleanSettings({ notifications: false, notifyPermission: 'badge', notifyQuestion: 'banner', notifyFinished: 'banner' })
    expect([s.notifyPermission, s.notifyQuestion, s.notifyFinished]).toEqual(['badge', 'banner', 'banner'])
  })

  it('drops what isn’t valid and keeps the rest', () => {
    const s = cleanSettings({ branchPrefix: 'main', archiveAfterDays: 9999, worktreeFolder: 'relative\\path', transcriptView: 'loud', outputStyle: '', notifyFinished: 'badge', keepAwake: false })
    expect(s.branchPrefix).toBe(DEFAULT_SETTINGS.branchPrefix)
    expect(s.archiveAfterDays).toBe(365)
    expect(s.worktreeFolder).toBeNull()
    expect(s.transcriptView).toBe('normal')
    expect(s.outputStyle).toBeNull()
    expect(s.notifyFinished).toBe('banner')
    expect(s.keepAwake).toBe(false)
  })

  it('takes a custom prefix, folder and output style', () => {
    const s = cleanSettings({ branchPrefix: 'ivan', worktreeFolder: 'D:\\worktrees', outputStyle: 'Explanatory', transcriptView: 'verbose' })
    expect([s.branchPrefix, s.worktreeFolder, s.outputStyle, s.transcriptView]).toEqual(['ivan', 'D:\\worktrees', 'Explanatory', 'verbose'])
  })
})

describe('branch prefixes', () => {
  it('takes what the Claude app takes', () => {
    for (const ok of ['claude', 'ivan', 'feat.x', 'a_b-c', '9lives']) expect(branchPrefixProblem(ok)).toBeNull()
  })

  it('refuses the rest, saying why', () => {
    expect(branchPrefixProblem('')).toMatch(/Type/)
    expect(branchPrefixProblem('-x')).toMatch(/Start/)
    expect(branchPrefixProblem('a b')).toMatch(/only/)
    expect(branchPrefixProblem('x'.repeat(41))).toMatch(/40/)
    expect(branchPrefixProblem('a..b')).toMatch(/Git/)
    for (const kept of ['main', 'master', 'staging', 'warm', 'prod-eu', 'release', 'release-1']) expect(branchPrefixProblem(kept)).toMatch(/kept/)
  })
})

describe('notification levels', () => {
  const s = { ...DEFAULT_SETTINGS, notifyPermission: 'badge' as const, notifyQuestion: 'off' as const, notifyFinished: 'banner' as const }
  it('picks the level by what happened', () => {
    expect(noticeLevel(s, 'waiting', { kind: 'permission' })).toBe('badge')
    expect(noticeLevel(s, 'waiting', { kind: 'plan' })).toBe('badge')
    expect(noticeLevel(s, 'waiting', { kind: 'question' })).toBe('off')
    expect(noticeLevel(s, 'finished')).toBe('banner')
    expect(noticeLevel(s, 'failed')).toBe('banner')
  })
})

describe('archiving inactive sessions', () => {
  const sessions = [
    meta('old', NOW - 10 * DAY),
    meta('recent', NOW - 1 * DAY),
    meta('pinned', NOW - 10 * DAY),
    meta('unread', NOW - 10 * DAY),
    meta('archived', NOW - 10 * DAY),
    meta('running', NOW - 10 * DAY),
    meta('stand-in', NOW - 10 * DAY, { file: '' })
  ]
  const entries = { pinned: { pinned: true }, unread: { unread: true }, archived: { archived: true } }

  it('archives only the old, idle, unmarked ones', () => {
    expect(inactiveSessions(sessions, entries, 7, NOW, (id) => id === 'running')).toEqual(['old'])
  })

  it('archives nothing when it’s off', () => {
    expect(inactiveSessions(sessions, entries, 0, NOW, () => false)).toEqual([])
  })
})

describe('worktrees in a folder of your own', () => {
  it('still knows the Claude app’s place', () => {
    expect(worktreeOf('D:\\JS\\Gloom\\.claude\\worktrees\\quiet-moon\\src', 'D:\\wt')).toEqual({ repo: 'D:\\JS\\Gloom', name: 'quiet-moon', path: 'D:\\JS\\Gloom\\.claude\\worktrees\\quiet-moon' })
  })

  it('knows <folder>/<repository>/<name>, in any case', () => {
    expect(worktreeOf('d:\\WT\\Gloom\\quiet-moon\\src\\x', 'D:\\wt\\')).toEqual({ repo: 'd:\\WT\\Gloom', name: 'quiet-moon', path: 'd:\\WT\\Gloom\\quiet-moon' })
  })

  it('isn’t fooled by a folder that only starts the same', () => {
    expect(worktreeOf('D:\\wtx\\Gloom\\quiet-moon', 'D:\\wt')).toBeNull()
    expect(worktreeOf('D:\\wt\\Gloom', 'D:\\wt')).toBeNull()
    expect(worktreeOf('D:\\wt\\Gloom\\quiet-moon', null)).toBeNull()
  })
})

describe('unread marks and folders', () => {
  const ctx = { sessions: new Map<string, SessionMeta>(), newId: () => 'f1', now: NOW }

  it('marks and reads, with Undo', () => {
    const marked = applyOp(emptyLibrary(), { type: 'setUnread', ids: ['a', 'b'], unread: true }, ctx)
    expect(marked.library.sessions.a?.unread).toBe(true)
    const read = applyOp(marked.library, { type: 'setUnread', ids: ['a'], unread: false }, ctx)
    expect(read.library.sessions.a?.unread).toBeUndefined()
    expect(read.undo).toEqual({ type: 'setUnread', ids: ['a'], unread: true })
  })

  it('keeps a session’s folders once each, and clears them', () => {
    const set = applyOp(emptyLibrary(), { type: 'setSessionFolders', id: 'a', folders: ['D:\\x', ' D:\\x ', 'D:\\y', ''] }, ctx)
    expect(set.library.sessions.a?.folders).toEqual(['D:\\x', 'D:\\y'])
    const cleared = applyOp(set.library, { type: 'setSessionFolders', id: 'a', folders: [] }, ctx)
    expect(cleared.library.sessions.a?.folders).toBeUndefined()
  })
})

describe('search inside conversations', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gloom-search-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const line = (o: unknown) => JSON.stringify(o) + '\n'

  it('reads what a line says: text, tool input and output, not images or keys', () => {
    expect(lineText({ type: 'user', message: { content: 'Fix the "parser"' } })).toBe('Fix the "parser"')
    expect(lineText({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }, { type: 'tool_use', input: { command: 'npm test', n: 3 } }] } })).toBe('Done\nnpm test')
    expect(lineText({ type: 'user', message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'ok' }, { type: 'image', source: { data: 'QUJD' } }] }] } })).toBe('ok')
    expect(lineText({ type: 'summary', summary: 'x' })).toBe('')
    expect(lineText({ type: 'user', isSidechain: true, message: { content: 'x' } })).toBe('')
  })

  it('cuts a snippet around the words, on one line', () => {
    const text = `${'a '.repeat(60)}the needle here\nand more ${'b '.repeat(80)}`
    const cut = snippet(text, 'needle')!
    expect(cut).toMatch(/^….*needle here and more.*…$/)
    expect(cut).not.toContain('\n')
  })

  it('finds words in a message, case and escapes aside, and only there', () => {
    const file = join(dir, 'a.jsonl')
    writeFileSync(
      file,
      line({ type: 'user', message: { content: [{ type: 'image', source: { data: 'needleNEEDLE' } }] } }) +
        line({ type: 'custom-title', title: 'needle' }) +
        line({ type: 'assistant', message: { content: [{ type: 'text', text: 'It said "Hello\nWorld" to the Needle.' }] } })
    )
    expect(searchFile(file, 'needle')).toContain('Needle')
    expect(searchFile(file, '"hello')).toContain('Hello')
    expect(searchFile(file, 'nothing here')).toBeNull()
  })

  it('reads across chunks and long lines', () => {
    const file = join(dir, 'b.jsonl')
    const big = line({ type: 'user', message: { content: [{ type: 'image', source: { data: 'x'.repeat(3 << 20) } }] } })
    writeFileSync(file, big + line({ type: 'assistant', message: { content: 'the far end' } }))
    expect(searchFile(file, 'far end')).toBe('the far end')
  })
})

describe('export names', () => {
  it('makes a title safe for a file name', async () => {
    const { exportName } = await import('../../src/main/export')
    expect(exportName('Fix: the <parser> / again?', new Date('2026-10-31T10:00:00Z'))).toBe('Fix the parser again 2026-10-31.zip')
    expect(exportName('...', new Date('2026-10-31T10:00:00Z'))).toBe('Session 2026-10-31.zip')
  })
})

describe('the task list, the next-step box and chapters (part B)', async () => {
  const { applyPlan, planOf, planAnswer, wrapUpOf, chapterOf, widgetOf } = await import('../../src/shared/plan')

  it('replaces the list, advances it, and marks steps out of order', () => {
    let steps = applyPlan([], { items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }, { content: 'C', status: 'pending' }] })
    expect(planAnswer(steps, true)).toBe('Plan shown (3 steps).')
    steps = applyPlan(steps, { advance: true })
    expect(steps.map((s) => s.status)).toEqual(['completed', 'in_progress', 'pending'])
    expect(planAnswer(steps, false)).toBe('Plan updated: step 2 of 3 is in progress.')
    steps = applyPlan(steps, { done: [2, 3] })
    expect(planAnswer(steps, false)).toBe('Plan updated: every step is done.')
    steps = applyPlan(steps, { start: 1 })
    expect(steps[0].status).toBe('in_progress')
  })

  it('reads the list from Gloom’s calls and the Claude app’s alike, ignoring the rest', () => {
    const steps = planOf([
      { name: 'mcp__ccd_turn__update_plan', input: { items: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] } },
      { name: 'Read', input: { items: [] } },
      { name: 'mcp__gloom__update_plan', input: { advance: true } }
    ])
    expect(steps).toEqual([
      { content: 'A', status: 'completed' },
      { content: 'B', status: 'in_progress' }
    ])
  })

  it('keeps a box’s buttons only with its question, two at most', () => {
    expect(wrapUpOf({ recap: 'Done.', actions: [{ label: 'X' }] })).toEqual({ recap: 'Done.', ask: null, actions: [], blocked: false })
    expect(wrapUpOf({ recap: 'Done.', ask: 'Ship?', actions: [{ label: 'Ship' }, { label: 'Wait' }, { label: 'Three' }] })?.actions).toEqual([{ label: 'Ship' }, { label: 'Wait' }])
    expect(wrapUpOf({ ask: 'no recap' })).toBeNull()
  })

  it('reads chapters and widgets', () => {
    expect(chapterOf({ title: ' Fix ', summary: '' })).toEqual({ title: 'Fix', summary: null })
    expect(widgetOf({ title: 'chart', widget_code: '<svg viewBox="0 0 1 1"></svg>' })?.svg).toBe(true)
    expect(widgetOf({ title: 'x', widget_code: '<div>hi</div>' })?.svg).toBe(false)
    expect(widgetOf({ title: 'x' })).toBeNull()
  })
})

describe('side sessions and the terminal (part B)', async () => {
  const { handleFor } = await import('../../src/main/claude/side-sessions')
  const { screenText } = await import('../../src/main/pty/terminals')

  it('names a side session by its title, uniquely, in 24 characters', () => {
    expect(handleFor('Build Gloom’s command palette!', () => false)).toBe('build-gloom-s-command-pa')
    const taken = new Set(['fix-it'])
    expect(handleFor('Fix it', (n) => taken.has(n))).toBe('fix-it-2')
    expect(handleFor('???', () => false)).toBe('session')
  })

  it('reads a terminal’s screen as text', () => {
    const out = '\u001b[32mPS C:\work>\u001b[0m npm run dev\r\n\u001b]0;title\u0007Starting\rReady on 5173\r\n\r\n'
    expect(screenText(out, 10)).toBe('PS C:\work> npm run dev\nReady on 5173')
    expect(screenText('a\nb\nc\n', 2)).toBe('b\nc')
  })
})

describe('pull requests, routines, SSH and the cloud (part D)', async () => {
  const { checkState, monitorNews, parsePr } = await import('../../src/main/git/pr')
  const { describeSchedule, dueRoutines, nextCron, parseCron } = await import('../../src/shared/routines')
  const { forwardedEnv, projectFolder, remoteCommand, shellWord, connectionFolder } = await import('../../src/shared/ssh')
  const { cloudUrl } = await import('../../src/main/cloud')

  const pr = (extra: Record<string, unknown> = {}) =>
    parsePr({
      number: 7,
      url: 'https://github.com/o/r/pull/7',
      title: 'Health page',
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'claude/quiet-moon',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: '',
      statusCheckRollup: [
        { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci/1' },
        { context: 'lint', state: 'PENDING' }
      ],
      autoMergeRequest: null,
      comments: [],
      reviews: [],
      updatedAt: '2026-10-31T10:00:00Z',
      ...extra
    })!

  it('reads gh’s answer: checks in both shapes, review, auto-merge', () => {
    const p = pr()
    expect(p.checks).toEqual([
      { name: 'test', state: 'passed', url: 'https://ci/1' },
      { name: 'lint', state: 'pending', url: null }
    ])
    expect(p.review).toBeNull()
    expect(p.autoMerge).toBe(false)
    expect(checkState({ conclusion: 'TIMED_OUT' })).toBe('failed')
    expect(parsePr({})).toBeNull()
  })

  it('tells Auto-fix only what’s new: failed checks, a conflict, new comments', () => {
    const before = pr()
    const failing = pr({ statusCheckRollup: [{ name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci/2' }], mergeable: 'CONFLICTING', comments: [{}, {}] })
    const news = monitorNews(before, failing)!
    expect(news).toMatch(/^<ci-monitor-event>/)
    expect(news).toContain('Checks failed: test (https://ci/2)')
    expect(news).toContain('conflicts with main')
    expect(news).toContain('2 new review comments')
    expect(monitorNews(failing, failing)).toBeNull()
    expect(monitorNews(before, pr({ state: 'MERGED' }))).toBeNull()
  })

  it('parses cron and finds the next run, in local time', () => {
    expect(parseCron('0 9 * * 1-5')).not.toBeNull()
    expect(parseCron('61 * * * *')).toBeNull()
    expect(parseCron('* * *')).toBeNull()
    const friday = new Date(2026, 9, 30, 10, 0).getTime() // a Friday, 10:00
    expect(new Date(nextCron('0 9 * * 1-5', friday)!).toString()).toBe(new Date(2026, 10, 2, 9, 0).toString()) // Monday 9:00
    expect(nextCron('*/15 * * * *', friday)! - friday).toBe(15 * 60_000)
  })

  it('runs a routine due now once, a missed one at launch, and a one-off once', () => {
    const now = new Date(2026, 9, 31, 12, 0).getTime()
    const base = { prompt: 'p', cwd: 'C:\w', model: null, mode: 'default', enabled: true, lastSession: null, at: null }
    const routines = [
      { ...base, id: 'missed', name: 'm', cron: '0 9 * * *', lastRun: new Date(2026, 9, 30, 9, 0).getTime(), created: 0 },
      { ...base, id: 'later', name: 'l', cron: '0 18 * * *', lastRun: new Date(2026, 9, 31, 11, 0).getTime(), created: 0 },
      { ...base, id: 'once', name: 'o', cron: null, at: now - 1000, lastRun: null, created: 0 },
      { ...base, id: 'off', name: 'x', cron: '* * * * *', lastRun: null, created: 0, enabled: false }
    ]
    expect(dueRoutines(routines, now).map((r) => r.id)).toEqual(['missed', 'once'])
    expect(describeSchedule({ cron: '0 9 * * 1-5', at: null })).toMatch(/^Weekdays at 9:00/)
    expect(describeSchedule({ cron: null, at: null })).toBe('When you start it')
  })

  it('quotes the remote command for a POSIX shell, and names folders as Claude Code does', () => {
    expect(shellWord('plain-word_1.2')).toBe('plain-word_1.2')
    expect(shellWord("it's")).toBe("'it'\\''s'")
    expect(remoteCommand('~/my app', 'claude', ['--print', '{"a":1}'], { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' })).toBe(`cd ~/'my app' && exec env CLAUDE_CODE_ENTRYPOINT=sdk-ts claude --print '{"a":1}'`)
    expect(projectFolder('/Users/ivan/my-app')).toBe('-Users-ivan-my-app')
    expect(forwardedEnv({ PATH: 'x', CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CLAUDE_AGENT_SDK_VERSION: '1' })).toEqual({ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CLAUDE_AGENT_SDK_VERSION: '1' })
    expect(connectionFolder('mac mini')).toBe('ssh-mac-mini')
  })

  it('finds the cloud session’s link in what claude --cloud printed', () => {
    expect(cloudUrl('Started a cloud session: https://claude.ai/code/session_01ABC?x=1 \n')).toBe('https://claude.ai/code/session_01ABC?x=1')
    expect(cloudUrl('nothing')).toBeNull()
  })
})

describe('the Browser pane and dev servers (part C)', async () => {
  const { addressToUrl } = await import('../../src/main/browser')
  const { readLaunch } = await import('../../src/main/preview')

  it('turns what you type in the address field into a page', () => {
    expect(addressToUrl('localhost:5173')).toBe('http://localhost:5173')
    expect(addressToUrl('127.0.0.1:3000/api')).toBe('http://127.0.0.1:3000/api')
    expect(addressToUrl('example.com/docs')).toBe('https://example.com/docs')
    expect(addressToUrl('https://x.test')).toBe('https://x.test')
    expect(addressToUrl('how to center a div')).toBe('https://duckduckgo.com/?q=how%20to%20center%20a%20div')
    expect(addressToUrl('')).toBe('about:blank')
  })

  it('reads .claude/launch.json as the Claude app does, skipping what isn’t a configuration', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'gloom-launch-'))
    mkdirSync(join(cwd, '.claude'))
    writeFileSync(
      join(cwd, '.claude', 'launch.json'),
      JSON.stringify({ version: '0.0.1', configurations: [{ name: 'dev', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 5173 }, { name: 'docs', url: 'http://localhost:4000' }, { runtimeExecutable: 'x' }, { name: 'bad port', runtimeExecutable: 'npm', port: 99999 }] })
    )
    const { configs, problem } = readLaunch(cwd)
    expect(problem).toBeNull()
    expect(configs.map((c) => [c.name, c.port, c.url])).toEqual([
      ['dev', 5173, null],
      ['docs', null, 'http://localhost:4000'],
      ['bad port', null, null]
    ])
    writeFileSync(join(cwd, '.claude', 'launch.json'), '{ not json')
    expect(readLaunch(cwd).problem).toMatch(/couldn’t be read/)
    rmSync(cwd, { recursive: true, force: true })
  })
})
