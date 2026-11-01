// How a tool call reads in the transcript: an icon and one line, "Edited
// foo.ts +12 −3" or "Ran npm test", and which details open under it. Tool
// names and inputs come from Claude Code; anything unknown still gets a line.
import {
  Activity,
  Bot,
  ClipboardList,
  FilePen,
  FilePlus2,
  FileText,
  Flag,
  FolderSearch,
  Globe,
  ListChecks,
  MessageCircleQuestion,
  NotebookPen,
  Paperclip,
  Plug,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  Bookmark,
  Shapes,
  SplitSquareHorizontal,
  SquareTerminal,
  type LucideIcon
} from 'lucide-react'
import type { MentionEntry, ToolEntry, ToolResult } from '@shared/transcript'

export type DetailsKind = 'shell' | 'diff' | 'output' | 'markdown' | 'todos' | 'questions' | 'generic'

export interface ToolView {
  icon: LucideIcon
  /** "Edited", "Ran", "Searched for". */
  verb: string
  /** What it acted on: a file, a command, a query. */
  target: string | null
  /** Paths and commands are set in the monospaced face. */
  mono: boolean
  added?: number
  removed?: number
  /** After the target, quieter: "12 files", "lines 40–80", the MCP server's name. */
  note?: string
  details: DetailsKind
}

export function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

function firstLine(text: string, max = 160): string {
  const line = text.trim().split('\n')[0] ?? ''
  return line.length > max ? `${line.slice(0, max)}…` : line
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname
    return firstLine(u.hostname.replace(/^www\./, '') + path, 80)
  } catch {
    return firstLine(url, 80)
  }
}

const count = (n: number | undefined, one: string, many = `${one}s`) => (n === undefined ? undefined : `${n.toLocaleString()} ${n === 1 ? one : many}`)

/** "javascript_tool" → "Javascript tool"; "Claude_Browser" → "Claude Browser". */
export function humanize(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : name
}

/** The input worth naming in a summary line: a URL, a path, a query, an action. */
function firstArg(input: Record<string, unknown>): string | null {
  for (const key of ['action', 'url', 'query', 'file_path', 'path', 'command', 'pattern', 'description', 'text', 'name']) {
    const v = input[key]
    if (typeof v === 'string' && v.trim()) return key === 'url' ? shortUrl(v) : firstLine(v, 100)
  }
  return null
}

/** A call still running says what it's doing, not what it did: "Writing hello.txt" while it waits. */
const UNDER_WAY: Record<string, string> = {
  Ran: 'Running',
  Read: 'Reading',
  Edited: 'Editing',
  Wrote: 'Writing',
  Created: 'Creating',
  'Searched for': 'Searching for',
  'Found files matching': 'Finding files matching',
  Listed: 'Listing',
  Fetched: 'Fetching',
  'Searched the web for': 'Searching the web for',
  'Updated the to-do list': 'Updating the to-do list',
  Asked: 'Asking',
  'Presented a plan': 'Presenting a plan',
  'Used the skill': 'Using the skill',
  'Loaded tools for': 'Loading tools for',
  Watched: 'Watching'
}

export function describeTool(call: ToolEntry, result: ToolResult | undefined, running = false): ToolView {
  const view = describeDone(call, result)
  return running && !result && UNDER_WAY[view.verb] ? { ...view, verb: UNDER_WAY[view.verb] } : view
}

function describeDone(call: ToolEntry, result: ToolResult | undefined): ToolView {
  const input = call.input
  const s = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
  const info = result?.info ?? {}
  const view = (icon: LucideIcon, verb: string, target: string | null, rest: Partial<ToolView> = {}): ToolView => ({
    icon,
    verb,
    target: target || null,
    mono: false,
    details: 'generic',
    ...rest
  })

  switch (call.name) {
    case 'Bash':
    case 'PowerShell':
      return view(Terminal, 'Ran', firstLine(s('command')), { mono: true, details: 'shell', note: info.background ? 'in the background' : undefined })
    case 'BashOutput':
    case 'TaskOutput':
      return view(Terminal, 'Read a background task’s output', null, { details: 'output' })
    case 'KillShell':
    case 'KillBash':
    case 'TaskStop':
      return view(Terminal, 'Stopped a background task', null, { details: 'output' })
    case 'Read': {
      const from = typeof input.offset === 'number' ? input.offset : null
      const limit = typeof input.limit === 'number' ? input.limit : null
      const note = from !== null && limit !== null ? `lines ${from}–${from + limit - 1}` : from !== null ? `from line ${from}` : undefined
      return view(FileText, 'Read', baseName(s('file_path')), { mono: true, note, details: 'output' })
    }
    case 'Edit':
    case 'MultiEdit':
      return view(FilePen, 'Edited', baseName(s('file_path')), { mono: true, added: info.added, removed: info.removed, details: 'diff' })
    case 'Write':
      return view(info.created ? FilePlus2 : FilePen, info.created ? 'Created' : 'Wrote', baseName(s('file_path')), {
        mono: true,
        added: info.added,
        removed: info.removed,
        details: 'diff'
      })
    case 'NotebookEdit':
      return view(NotebookPen, 'Edited', baseName(s('notebook_path')), { mono: true })
    case 'Grep':
      return view(Search, 'Searched for', s('pattern'), { mono: true, note: count(info.numFiles, 'file') ?? count(info.numLines, 'line'), details: 'output' })
    case 'Glob':
      return view(FolderSearch, 'Found files matching', s('pattern'), { mono: true, note: count(info.numFiles, 'file'), details: 'output' })
    case 'LS':
      return view(FolderSearch, 'Listed', baseName(s('path')), { mono: true, details: 'output' })
    case 'WebFetch':
      return view(Globe, 'Fetched', shortUrl(s('url')), { details: 'output' })
    case 'WebSearch':
      return view(Globe, 'Searched the web for', s('query'), { details: 'output' })
    case 'Agent':
    case 'Task':
      return view(Bot, s('subagent_type') ? `${humanize(s('subagent_type'))} agent:` : 'Agent:', s('description'), { details: 'markdown' })
    case 'TodoWrite':
      return view(ListChecks, 'Updated the to-do list', null, { details: 'todos' })
    case 'TaskCreate':
      return view(ListChecks, 'Added a task:', s('subject') || s('description'))
    case 'TaskUpdate':
      return view(ListChecks, 'Updated a task', null)
    case 'TaskList':
    case 'TaskGet':
      return view(ListChecks, 'Checked the tasks', null)
    case 'AskUserQuestion': {
      const questions = Array.isArray(input.questions) ? input.questions : []
      const first = questions[0] as { question?: unknown } | undefined
      return view(MessageCircleQuestion, 'Asked', typeof first?.question === 'string' ? firstLine(first.question) : null, { details: 'questions' })
    }
    case 'ExitPlanMode':
      return view(ClipboardList, 'Presented a plan', null, { details: 'markdown' })
    case 'EnterPlanMode':
      return view(ClipboardList, 'Started planning', null)
    case 'Skill':
      return view(Sparkles, 'Used the skill', s('skill') || s('command'), { mono: true })
    case 'SlashCommand':
      return view(Terminal, 'Ran', s('command'), { mono: true })
    case 'ToolSearch':
      return view(Wrench, 'Loaded tools for', s('query'), { details: 'output' })
    case 'Monitor':
      return view(Activity, 'Watched', s('description') || firstArg(input), { details: 'output' })
    case 'SendUserFile': {
      const files = Array.isArray(input.files) ? input.files.filter((f): f is string => typeof f === 'string') : []
      return view(Paperclip, files.length > 1 ? `Sent ${files.length} files:` : 'Sent', files[0] ? baseName(files[0]) : null, { mono: true })
    }
    case 'mcp__ccd_turn__update_plan':
    case 'mcp__gloom__update_plan':
      return view(ListChecks, 'Updated the plan', null)
    case 'mcp__ccd_turn__wrap_up':
    case 'mcp__gloom__wrap_up':
      return view(Flag, 'Wrapped up:', firstLine(s('recap'), 120), { details: 'generic' })
    case 'mcp__ccd_session__mark_chapter':
    case 'mcp__gloom__mark_chapter':
      return view(Bookmark, 'Marked a chapter:', s('title'))
    case 'mcp__gloom__show_widget':
    case 'mcp__visualize__show_widget':
      return view(Shapes, 'Showed', s('title'))
    case 'mcp__gloom__start_session':
    case 'mcp__ccd_session__start_session':
      return view(SplitSquareHorizontal, input.initiation === 'own_initiative' ? 'Proposed a session:' : input.initiation === 'offer' ? 'Offered a session:' : 'Started a session:', s('title'))
    case 'mcp__gloom__run_in_terminal':
    case 'mcp__terminal__run_in_terminal':
      return view(SquareTerminal, 'Ran in the terminal', firstLine(s('command')), { mono: true, details: 'output' })
    case 'mcp__gloom__read_terminal':
    case 'mcp__terminal__read_terminal':
      return view(SquareTerminal, 'Read the terminal', null, { details: 'output' })
  }
  if (call.name.startsWith('mcp__')) {
    const [, server = '', tool = call.name] = call.name.split('__')
    return view(Plug, humanize(tool), firstArg(input), { note: humanize(server) })
  }
  return view(Wrench, humanize(call.name), firstArg(input))
}

// ─── A run of tool calls as one line ─────────────────────────────────────────

/** Verbs whose past isn't "-ed", as command descriptions start ("Find the…" → "Found the…"). */
const IRREGULAR: Record<string, string> = {
  bind: 'bound', bring: 'brought', build: 'built', buy: 'bought', catch: 'caught', choose: 'chose', cut: 'cut', dig: 'dug', do: 'did', draw: 'drew',
  feed: 'fed', find: 'found', forget: 'forgot', freeze: 'froze', get: 'got', give: 'gave', go: 'went', grow: 'grew', hang: 'hung', hide: 'hid',
  hit: 'hit', hold: 'held', keep: 'kept', know: 'knew', lead: 'led', leave: 'left', let: 'let', light: 'lit', make: 'made', mean: 'meant',
  meet: 'met', overwrite: 'overwrote', put: 'put', quit: 'quit', read: 'read', rebuild: 'rebuilt', reread: 'reread', rerun: 'reran', reset: 'reset', rewrite: 'rewrote',
  run: 'ran', say: 'said', see: 'saw', seek: 'sought', send: 'sent', set: 'set', shut: 'shut', sleep: 'slept', split: 'split', spin: 'spun',
  strike: 'struck', sweep: 'swept', take: 'took', teach: 'taught', tell: 'told', think: 'thought', throw: 'threw', undo: 'undid', unset: 'unset', upset: 'upset',
  wake: 'woke', wind: 'wound', write: 'wrote'
}

/** Verbs that double their last letter: "stop" → "stopped". */
const DOUBLES = new Set(['admit', 'chop', 'commit', 'drop', 'grep', 'log', 'map', 'pin', 'plan', 'prefer', 'refer', 'scan', 'ship', 'skip', 'step', 'stop', 'strip', 'submit', 'swap', 'tag', 'trim', 'unpin', 'unwrap', 'unzip', 'wrap', 'zip'])

/** Regular verbs a command's description starts with. Anything else is left as written: "Git status" doesn't become "Git statused". */
const REGULAR = new Set([
  'add', 'append', 'apply', 'archive', 'back', 'benchmark', 'bump', 'capture', 'change', 'check', 'clean', 'clear', 'clone', 'close', 'compare', 'compile', 'configure', 'confirm',
  'convert', 'copy', 'count', 'create', 'debug', 'delete', 'deploy', 'diff', 'disable', 'download', 'dump', 'edit', 'enable', 'end', 'export', 'extract', 'fetch', 'fix',
  'format', 'generate', 'import', 'initialize', 'insert', 'inspect', 'install', 'kill', 'launch', 'link', 'lint', 'list', 'load', 'look', 'measure', 'merge', 'monitor',
  'mount', 'move', 'open', 'package', 'parse', 'patch', 'poll', 'print', 'probe', 'profile', 'prune', 'publish', 'pull', 'push', 'query', 'rebase', 'record', 'register',
  'release', 'reload', 'remove', 'rename', 'render', 'repair', 'replace', 'restart', 'restore', 'retry', 'revert', 'sample', 'save', 'search', 'show', 'sign', 'sort',
  'stage', 'start', 'stash', 'switch', 'test', 'toggle', 'touch', 'trace', 'try', 'uninstall', 'unlink', 'unpack', 'update', 'upload', 'use', 'verify', 'view', 'wait',
  'watch'
])

/** A verb's past: "check" → "checked", "copy" → "copied", "run" → "ran"; null when it isn't a verb we know. */
function pastOf(verb: string): string | null {
  const v = verb.toLowerCase()
  if (IRREGULAR[v]) return IRREGULAR[v]
  if (DOUBLES.has(v)) return `${v}${v.at(-1)}ed`
  if (!REGULAR.has(v)) return null
  if (v.endsWith('e')) return `${v}d`
  if (/[^aeiou]y$/.test(v)) return `${v.slice(0, -1)}ied`
  return `${v}ed`
}

/**
 * A command's description as something done, the way the Claude app sums up
 * a lone command: "Run the unit suites" → "Ran the unit suites". A
 * description that doesn't start with a verb we know stays as written.
 */
export function pastTense(description: string): string {
  const text = firstLine(description, 120)
  const m = /^([A-Za-z]+)(\b.*)$/s.exec(text)
  if (!m) return text
  const past = pastOf(m[1])
  if (!past) return text
  return (m[1][0] === m[1][0].toUpperCase() ? past[0].toUpperCase() + past.slice(1) : past) + m[2]
}

type Kind = 'command' | 'search' | 'read' | 'edit' | 'create' | 'fetch' | 'web' | 'skill' | 'tool'

/** What a call counts as in a run's line; null for calls that stand alone (an agent, a question, a plan). */
export function toolKind(call: ToolEntry, result: ToolResult | undefined): Kind | null {
  switch (call.name) {
    case 'Bash':
    case 'PowerShell':
    case 'SlashCommand':
    case 'BashOutput':
    case 'TaskOutput':
    case 'KillShell':
    case 'KillBash':
    case 'TaskStop':
    case 'Monitor':
    case 'mcp__gloom__run_in_terminal':
    case 'mcp__terminal__run_in_terminal':
    case 'mcp__gloom__read_terminal':
    case 'mcp__terminal__read_terminal':
      return 'command'
    case 'Grep':
    case 'Glob':
    case 'LS':
      return 'search'
    case 'Read':
      return 'read'
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'edit'
    case 'Write':
      return result?.info.created ? 'create' : 'edit'
    case 'WebFetch':
      return 'fetch'
    case 'WebSearch':
      return 'web'
    case 'Skill':
      return 'skill'
    case 'Agent':
    case 'Task':
    case 'TodoWrite':
    case 'AskUserQuestion':
    case 'ExitPlanMode':
    case 'EnterPlanMode':
      return null
  }
  return 'tool'
}

const PHRASE: Record<Kind, { one: string; many: (n: number) => string; named?: string }> = {
  command: { one: 'ran a command', many: (n) => `ran ${n} commands` },
  search: { one: 'searched code', many: () => 'searched code' },
  read: { one: 'read a file', many: (n) => `read ${n} files`, named: 'read' },
  edit: { one: 'edited a file', many: (n) => `edited ${n} files`, named: 'edited' },
  create: { one: 'created a file', many: (n) => `created ${n} files`, named: 'created' },
  fetch: { one: 'fetched a page', many: (n) => `fetched ${n} pages` },
  web: { one: 'searched the web', many: () => 'searched the web' },
  skill: { one: 'used a skill', many: (n) => `used ${n} skills` },
  tool: { one: 'used a tool', many: (n) => `used ${n} tools` }
}

export interface GroupView {
  /** "Ran 2 commands, searched code, read 2 files, edited a file". */
  text: string
  added: number
  removed: number
  failed: number
  running: boolean
}

/**
 * A run of tool calls as one line, as the Claude app sums them up: each kind
 * once, in the order it first came, counted ("read 2 files"; files by path,
 * so five edits to one file are "edited a file"). The first kind names its
 * file when there's only one: "Created main.js, ran a command".
 */
export function describeGroup(calls: readonly { call: ToolEntry; result: ToolResult | undefined; running: boolean }[]): GroupView {
  const order: Kind[] = []
  const counts = new Map<Kind, { calls: number; files: Set<string> }>()
  let added = 0
  let removed = 0
  let failed = 0
  for (const { call, result } of calls) {
    const kind = toolKind(call, result) ?? 'tool'
    let entry = counts.get(kind)
    if (!entry) {
      entry = { calls: 0, files: new Set() }
      counts.set(kind, entry)
      order.push(kind)
    }
    entry.calls++
    const path = typeof call.input.file_path === 'string' ? call.input.file_path : typeof call.input.notebook_path === 'string' ? call.input.notebook_path : null
    if (path) entry.files.add(path.replace(/\\/g, '/').toLowerCase())
    added += result?.info.added ?? 0
    removed += result?.info.removed ?? 0
    if (result?.isError) failed++
  }
  const phrases = order.map((kind, i) => {
    const { calls: n, files } = counts.get(kind)!
    const phrase = PHRASE[kind]
    const many = files.size || n
    if (i === 0 && phrase.named && files.size === 1) {
      const first = calls.find((c) => (toolKind(c.call, c.result) ?? 'tool') === kind)!.call
      const path = (first.input.file_path ?? first.input.notebook_path) as string
      return `${phrase.named} ${baseName(path)}`
    }
    return many === 1 ? phrase.one : phrase.many(many)
  })
  const text = phrases.join(', ')
  return { text: text[0].toUpperCase() + text.slice(1), added, removed, failed, running: calls.some((c) => c.running && !c.result) }
}

/**
 * A file or folder you mentioned, in Claude Code's words under your message:
 * "Read notes/a.txt · 2 lines" ("lines 3–4" for part of one), "Listed docs/".
 */
export function describeMention(mention: MentionEntry): { icon: LucideIcon; verb: string; note?: string } {
  if (mention.folder) return { icon: FolderSearch, verb: 'Listed' }
  const { lines, from, total } = mention
  const part = lines !== undefined && from !== undefined && (from > 1 || (total !== undefined && lines < total))
  return { icon: FileText, verb: 'Read', note: part ? `lines ${from}–${from + lines - 1}` : count(lines, 'line') }
}

/** A model ID as people say it: "claude-opus-5-5" → "Opus 5.5", "claude-haiku-4-5-20251001" → "Haiku 4.5". */
export function modelName(id: string | null): string | null {
  if (!id) return null
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id)
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
  const old = /^claude-(\d+)(?:-(\d))?-([a-z]+)/.exec(id)
  if (old) return `${old[3][0].toUpperCase()}${old[3].slice(1)} ${old[1]}${old[2] ? `.${old[2]}` : ''}`
  return id
}
