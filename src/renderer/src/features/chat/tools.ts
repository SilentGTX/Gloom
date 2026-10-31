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
      return view(ListChecks, 'Updated the plan', null)
    case 'mcp__ccd_turn__wrap_up':
      return view(Flag, 'Wrapped up:', firstLine(s('recap'), 120), { details: 'generic' })
  }
  if (call.name.startsWith('mcp__')) {
    const [, server = '', tool = call.name] = call.name.split('__')
    return view(Plug, humanize(tool), firstArg(input), { note: humanize(server) })
  }
  return view(Wrench, humanize(call.name), firstArg(input))
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
