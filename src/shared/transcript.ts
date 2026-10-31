// A session's transcript as the chat shows it. Claude Code writes one JSON line
// per event; each line becomes zero or more entries here: your prompts, each
// block of Claude's reply, and the few system events worth showing. Tool results
// are kept apart, by the ID of the call they answer, because parallel calls hang
// their results off side branches of the conversation. Images and long text stay
// in the file: entries carry a BlobRef, read when an image scrolls into view or
// a long output is opened.

/** Where something left in the file lives: `<line offset>:<line length>:<path into the line>`. */
export type BlobRef = string

export interface TextPart {
  type: 'text'
  text: string
  /** The whole text, when `text` was cut short. */
  more?: BlobRef
}

export interface ImagePart {
  type: 'image'
  /** The image block; reading it gives a data URL. */
  ref: BlobRef
  mediaType: string
}

export type Part = TextPart | ImagePart

/** Where an older page starts: the line to read back from, and the entry to look for. */
export interface Cursor {
  offset: number
  want: string
}

interface Base {
  /** Unique in the transcript: the line's uuid, with the block's index after the first. */
  key: string
  /** Milliseconds since the epoch. */
  time: number
}

/** Something you sent: typed, a slash command, or queued while Claude worked. */
export interface PromptEntry extends Base {
  kind: 'prompt'
  text: string
  more?: BlobRef
  images: ImagePart[]
  /** A slash command as typed: "/model sonnet". */
  command?: string
  /** Sent while Claude was working; it joined the turn in progress. */
  queued?: boolean
}

/** One block of Claude's reply. A reply arrives as one line per block. */
export interface TextEntry extends Base {
  kind: 'text'
  text: string
  more?: BlobRef
  /** The API message it belongs to: blocks with the same ID are one response. */
  messageId: string | null
  model: string | null
}

export interface ThinkingEntry extends Base {
  kind: 'thinking'
  /** Empty when the model's thinking isn't shown (only its length is known). */
  text: string
  more?: BlobRef
  ms: number | null
  messageId: string | null
  model: string | null
}

export interface ToolEntry extends Base {
  kind: 'tool'
  /** Its result, in the transcript's results, has this ID. */
  id: string
  name: string
  /** Long strings are cut; `cut` says where each whole one lives, by dotted path. */
  input: Record<string, unknown>
  cut?: Record<string, BlobRef>
  messageId: string | null
  model: string | null
}

export type NoticeIcon = 'interrupt' | 'error' | 'switch' | 'info' | 'task' | 'message' | 'hook'

/** Something that happened, shown small and centred: an interruption, an API error, a model switch. */
export interface NoticeEntry extends Base {
  kind: 'notice'
  tone: 'info' | 'warning' | 'error'
  icon: NoticeIcon
  text: string
  /** More to read, behind a disclosure. */
  detail?: string
}

/** A slash command's output, or a shell command you ran with `!`. */
export interface OutputEntry extends Base {
  kind: 'output'
  /** The `!` command you ran; absent for a slash command's output. */
  input?: string
  stdout: string
  stderr: string
}

/** The conversation was compacted: what came before is behind Show Earlier. */
export interface CompactEntry extends Base {
  kind: 'compact'
  trigger: string | null
  /** How full the context was when it compacted. */
  preTokens: number | null
  /** Where the conversation before it ends, if this file holds it. */
  earlier: Cursor | null
}

/** The summary Claude carried on from after a compaction. */
export interface SummaryEntry extends Base {
  kind: 'summary'
  text: string
  more?: BlobRef
}

/** A file or folder you mentioned with `@`, which Claude Code read into your message. */
export interface MentionEntry extends Base {
  kind: 'mention'
  folder: boolean
  /** As Claude Code shows it (from the working folder, when it's inside it), with forward slashes. */
  path: string
  /** Where it is. */
  full: string
  /** A file's lines that went in: how many, from which, out of how many. */
  lines?: number
  from?: number
  total?: number
  /** What went in: the file's text, or the folder's listing; empty for anything else (an image). */
  content: TextPart
}

export type TranscriptEntry = PromptEntry | TextEntry | ThinkingEntry | ToolEntry | NoticeEntry | OutputEntry | CompactEntry | SummaryEntry | MentionEntry

export interface Hunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  /** Each prefixed with ' ', '+' or '-', as in a unified diff. */
  lines: string[]
}

/** What a tool reported about its run, beyond the text the model saw. */
export interface ResultInfo {
  filePath?: string
  /** A Write that made a new file. */
  created?: boolean
  added?: number
  removed?: number
  hunks?: Hunk[]
  /** The whole diff, when `hunks` was cut short. */
  hunksMore?: BlobRef
  /** A new file's content (Write). */
  content?: TextPart
  stdout?: TextPart
  stderr?: TextPart
  interrupted?: boolean
  /** A command left running in the background. */
  background?: boolean
  numFiles?: number
  numLines?: number
  startLine?: number
  totalLines?: number
  url?: string
  code?: number
  status?: string
  durationMs?: number
  toolCount?: number
  /** AskUserQuestion: question → the answer given. */
  answers?: Record<string, string>
  todos?: { content: string; status: string }[]
}

export interface ToolResult {
  toolUseId: string
  isError: boolean
  /** What the tool returned, as the model saw it. */
  parts: Part[]
  info: ResultInfo
  time: number
}

/** A page of the transcript, oldest first. */
export interface TranscriptPage {
  entries: TranscriptEntry[]
  results: Record<string, ToolResult>
  /** Where the next older page starts; null at the session's start or at a compaction. */
  older: Cursor | null
}

/** What changed in a transcript you're looking at, as Claude Code writes it. */
export type TranscriptUpdate =
  | { type: 'append'; entries: TranscriptEntry[]; results: Record<string, ToolResult> }
  /** The conversation branched (a rewind) or the file was rewritten: the newest page, read again. */
  | { type: 'reload'; page: TranscriptPage }
  | { type: 'gone' }

// ─── Reading a line ──────────────────────────────────────────────────────────

/** Where a line sits in its file, so the parts left out can be read later. */
export interface LineAt {
  offset: number
  length: number
}

type Raw = Record<string, unknown>
type Path = (string | number)[]

/** Text in a page is cut here; the rest is read when asked for. */
export const LIMITS = {
  text: 24_000,
  result: 6_000,
  resultLines: 120,
  input: 2_000,
  summary: 1_500,
  hunkLines: 400
}

const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export function makeRef(at: LineAt, path: Path): BlobRef {
  return `${at.offset}:${at.length}:${path.join('/')}`
}

export function parseRef(ref: unknown): { offset: number; length: number; path: Path } | null {
  if (typeof ref !== 'string') return null
  const m = /^(\d{1,15}):(\d{1,10}):([\w/.-]*)$/.exec(ref)
  if (!m) return null
  const path = m[3] ? m[3].split('/').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : []
  return { offset: Number(m[1]), length: Number(m[2]), path }
}

const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function time(v: unknown): number {
  const t = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(t) ? t : 0
}

/** Cuts text to `limit` characters (and `lines` lines), keeping where the whole lives. */
export function cutText(text: string, limit: number, at: LineAt, path: Path, lines = Infinity): TextPart {
  let end = Math.min(text.length, limit)
  if (lines < Infinity) {
    let nl = -1
    for (let n = 0; n < lines; n++) {
      nl = text.indexOf('\n', nl + 1)
      if (nl === -1 || nl >= end) break
      if (n === lines - 1) end = nl
    }
  }
  return end < text.length ? { type: 'text', text: text.slice(0, end), more: makeRef(at, path) } : { type: 'text', text }
}

/** An image block's part, when it holds a picture we can show. */
function imagePart(block: unknown, at: LineAt, path: Path): ImagePart | null {
  if (!isObj(block) || block.type !== 'image' || !isObj(block.source)) return null
  const mediaType = str(block.source.media_type)
  if (block.source.type !== 'base64' || !mediaType || !MEDIA_TYPES.has(mediaType)) return null
  return { type: 'image', ref: makeRef(at, path), mediaType }
}

/** The value a BlobRef points to, from its line: an image becomes a data URL, a diff stays a list. */
export function resolveRef(line: Raw, path: Path): unknown {
  let v: unknown = line
  for (const p of path) {
    if (Array.isArray(v) && typeof p === 'number') v = v[p]
    else if (isObj(v) && typeof p === 'string') v = v[p]
    else return undefined
  }
  if (isObj(v) && v.type === 'image' && isObj(v.source)) {
    const mediaType = str(v.source.media_type)
    const data = str(v.source.data)
    if (!mediaType || !MEDIA_TYPES.has(mediaType) || !data || !/^[A-Za-z0-9+/=\s]*$/.test(data.slice(0, 256))) return undefined
    return `data:${mediaType};base64,${data}`
  }
  return v
}

// ─── What you sent ───────────────────────────────────────────────────────────

const REMINDER = /<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g
const tagged = (text: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)(</${tag}>|$)`).exec(text)
  return m ? m[1] : null
}
/** Tags whose whole message is the harness talking, not you. */
const EVENT = /^\s*<([a-z][\w-]*)(\s[^>]*)?>[\s\S]*<\/\1>\s*$/

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is { type: 'text'; text: string } => isObj(b) && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

/** A user line that isn't a tool result: a prompt, a command, its output, a notification. */
function userEntries(e: Raw, key: string, t: number, at: LineAt, content: unknown, contentPath: Path, queued: boolean): TranscriptEntry[] {
  const raw = textOf(content)
  const text = raw.replace(REMINDER, '').trim()
  const images: ImagePart[] = []
  if (Array.isArray(content)) content.forEach((b, i) => {
    const img = imagePart(b, at, [...contentPath, i])
    if (img) images.push(img)
  })

  if (/^\[Request interrupted by user/.test(text)) {
    return [{ kind: 'notice', key, time: t, tone: 'info', icon: 'interrupt', text: /for tool use/.test(text) ? 'Interrupted while using a tool' : 'Interrupted' }]
  }
  const task = tagged(text, 'task-notification')
  if (task !== null) {
    const summary = tagged(task, 'summary')?.trim()
    const status = tagged(task, 'status')?.trim()
    return [
      {
        kind: 'notice',
        key,
        time: t,
        tone: status === 'failed' || status === 'killed' ? 'warning' : 'info',
        icon: 'task',
        text: summary || (status ? `Background task ${status}` : 'Background task update')
      }
    ]
  }
  const command = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(text)
  if (command) {
    const args = tagged(text, 'command-args')?.trim()
    const name = command[1].startsWith('/') ? command[1] : `/${command[1]}`
    return [{ kind: 'prompt', key, time: t, text: '', images: [], command: args ? `${name} ${args}` : name }]
  }
  const stdout = tagged(text, 'local-command-stdout')
  const stderr = tagged(text, 'local-command-stderr')
  if (stdout !== null || stderr !== null) return [{ kind: 'output', key, time: t, stdout: (stdout ?? '').trim(), stderr: (stderr ?? '').trim() }]
  const bashIn = tagged(text, 'bash-input')
  if (bashIn !== null) return [{ kind: 'output', key, time: t, input: bashIn.trim(), stdout: '', stderr: '' }]
  const bashOut = tagged(text, 'bash-stdout')
  const bashErr = tagged(text, 'bash-stderr')
  if (bashOut !== null || bashErr !== null) return [{ kind: 'output', key, time: t, stdout: (bashOut ?? '').trimEnd(), stderr: (bashErr ?? '').trimEnd() }]

  const origin = isObj(e.origin) ? e.origin : null
  if (origin?.kind === 'peer') {
    const name = str(origin.name) ?? 'another session'
    const body = str(origin.body) ?? text
    return [{ kind: 'notice', key, time: t, tone: 'info', icon: 'message', text: `Message from ${name}`, detail: body.slice(0, LIMITS.summary * 4) }]
  }
  const event = EVENT.exec(text)
  if (event && !text.includes('<pasted_content') && images.length === 0) {
    // The harness speaking (a side session's report, say): kept, but quiet.
    const name = event[1].replace(/[-_]/g, ' ')
    return [{ kind: 'notice', key, time: t, tone: 'info', icon: 'info', text: name[0].toUpperCase() + name.slice(1), detail: text.replace(/<\/?[a-z][\w-]*(\s[^>]*)?>/g, '').trim().slice(0, LIMITS.summary * 4) }]
  }
  if (!text && images.length === 0) return []
  const part = text.length > LIMITS.text ? cutText(text, LIMITS.text, at, contentPath) : null
  return [{ kind: 'prompt', key, time: t, text: part ? part.text : text, ...(part?.more ? { more: part.more } : {}), images, ...(queued ? { queued: true } : {}) }]
}

/**
 * A file or folder `@` put in your message. Claude Code reads it as the
 * message arrives and keeps what it read on an attachment line of its own,
 * just after yours (observed with CLI 2.1.186 and 2.1.314; PLAN.md › 10).
 */
function mentionEntry(a: Raw, key: string, t: number, at: LineAt): MentionEntry | null {
  const folder = a.type === 'directory'
  const full = str(folder ? a.path : a.filename)
  if (!full) return null
  const path = (str(a.displayPath) || full).replace(/\\/g, '/')
  if (folder) {
    const listing = str(a.content) ?? ''
    return { kind: 'mention', key, time: t, folder, path, full, content: cutText(listing, LIMITS.result, at, ['attachment', 'content'], LIMITS.resultLines) }
  }
  const file = isObj(a.content) && isObj(a.content.file) ? a.content.file : null
  const text = str(file?.content) ?? ''
  return {
    kind: 'mention',
    key,
    time: t,
    folder,
    path,
    full,
    lines: num(file?.numLines),
    from: num(file?.startLine),
    total: num(file?.totalLines),
    content: cutText(text, LIMITS.result, at, ['attachment', 'content', 'file', 'content'], LIMITS.resultLines)
  }
}

// ─── Tool results ────────────────────────────────────────────────────────────

function resultParts(content: unknown, at: LineAt, path: Path): Part[] {
  if (typeof content === 'string') return content ? [cutText(content, LIMITS.result, at, path, LIMITS.resultLines)] : []
  if (!Array.isArray(content)) return []
  const parts: Part[] = []
  const tools: string[] = []
  content.forEach((b, i) => {
    if (!isObj(b)) return
    if (b.type === 'text' && typeof b.text === 'string') parts.push(cutText(b.text, LIMITS.result, at, [...path, i, 'text'], LIMITS.resultLines))
    else if (b.type === 'image') {
      const img = imagePart(b, at, [...path, i])
      if (img) parts.push(img)
    } else if (b.type === 'tool_reference' && typeof b.tool_name === 'string') tools.push(b.tool_name)
  })
  if (tools.length) parts.push({ type: 'text', text: tools.join('\n') })
  return parts
}

/** A tool's structuredPatch as hunks; anything malformed drops out. */
export function hunksOf(patch: unknown): Hunk[] {
  if (!Array.isArray(patch)) return []
  return patch.filter(isObj).map((h) => ({
    oldStart: num(h.oldStart) ?? 0,
    oldLines: num(h.oldLines) ?? 0,
    newStart: num(h.newStart) ?? 0,
    newLines: num(h.newLines) ?? 0,
    lines: Array.isArray(h.lines) ? h.lines.filter((l): l is string => typeof l === 'string') : []
  }))
}

/** What a tool's own report (toolUseResult) adds: the file, the diff, the exit state. */
function resultInfo(r: unknown, at: LineAt): ResultInfo {
  if (!isObj(r)) return {}
  const info: ResultInfo = {}
  const file = isObj(r.file) ? r.file : null
  const filePath = str(r.filePath) ?? (file ? str(file.filePath) : null)
  if (filePath) info.filePath = filePath
  if (Array.isArray(r.structuredPatch)) {
    const hunks = hunksOf(r.structuredPatch)
    let added = 0
    let removed = 0
    for (const h of hunks) for (const l of h.lines) {
      if (l.startsWith('+')) added++
      else if (l.startsWith('-')) removed++
    }
    info.added = added
    info.removed = removed
    // Keep whole hunks up to the budget; the rest is read on demand.
    let budget = LIMITS.hunkLines
    const kept: Hunk[] = []
    for (const h of hunks) {
      if (budget <= 0) break
      kept.push(h.lines.length > budget ? { ...h, lines: h.lines.slice(0, budget) } : h)
      budget -= h.lines.length
    }
    info.hunks = kept
    if (budget < 0 || kept.length < hunks.length) info.hunksMore = makeRef(at, ['toolUseResult', 'structuredPatch'])
  }
  if (r.type === 'create' && typeof r.content === 'string') {
    info.created = true
    info.content = cutText(r.content, LIMITS.result, at, ['toolUseResult', 'content'], LIMITS.resultLines)
    if (!info.added) info.added = r.content ? r.content.split('\n').length - (r.content.endsWith('\n') ? 1 : 0) : 0
  }
  if (typeof r.stdout === 'string' && r.stdout) info.stdout = cutText(r.stdout, LIMITS.result, at, ['toolUseResult', 'stdout'], LIMITS.resultLines)
  if (typeof r.stderr === 'string' && r.stderr) info.stderr = cutText(r.stderr, LIMITS.result, at, ['toolUseResult', 'stderr'], LIMITS.resultLines)
  if (r.interrupted === true) info.interrupted = true
  if (typeof r.backgroundTaskId === 'string') info.background = true
  const numFiles = num(r.numFiles)
  if (numFiles !== undefined) info.numFiles = numFiles
  const numLines = num(r.numLines) ?? (file ? num(file.numLines) : undefined)
  if (numLines !== undefined) info.numLines = numLines
  const startLine = file ? num(file.startLine) : undefined
  if (startLine !== undefined) info.startLine = startLine
  const totalLines = num(r.totalLines) ?? (file ? num(file.totalLines) : undefined)
  if (totalLines !== undefined) info.totalLines = totalLines
  if (typeof r.url === 'string') info.url = r.url
  const code = num(r.code)
  if (code !== undefined) info.code = code
  if (typeof r.status === 'string') info.status = r.status
  const durationMs = num(r.totalDurationMs) ?? num(r.durationMs)
  if (durationMs !== undefined) info.durationMs = durationMs
  const toolCount = num(r.totalToolUseCount)
  if (toolCount !== undefined) info.toolCount = toolCount
  if (isObj(r.answers)) {
    info.answers = Object.fromEntries(Object.entries(r.answers).filter(([, v]) => typeof v === 'string')) as Record<string, string>
  }
  const todos = Array.isArray(r.newTodos) ? r.newTodos : null
  if (todos) {
    info.todos = todos.filter(isObj).map((t) => ({ content: str(t.content) ?? '', status: str(t.status) ?? 'pending' }))
  }
  return info
}

/** The results a user line carries, one per tool_result block. */
export function lineResults(e: Raw, at: LineAt): ToolResult[] {
  const content = isObj(e.message) ? e.message.content : undefined
  if (!Array.isArray(content)) return []
  const blocks = content.map((b, i) => [b, i] as const).filter(([b]) => isObj(b) && b.type === 'tool_result' && typeof b.tool_use_id === 'string')
  // The tool's own report belongs to the call when there's only one.
  const info = blocks.length === 1 ? resultInfo(e.toolUseResult, at) : {}
  const t = time(e.timestamp)
  return blocks.map(([b, i]) => {
    const block = b as Raw
    return {
      toolUseId: block.tool_use_id as string,
      isError: block.is_error === true,
      parts: resultParts(block.content, at, ['message', 'content', i, 'content']),
      info,
      time: t
    }
  })
}

// ─── Tool calls ──────────────────────────────────────────────────────────────

/** A tool call's input with long strings cut, recording where each whole one lives. */
function cutInput(input: unknown, at: LineAt, path: Path): { input: Record<string, unknown>; cut?: Record<string, BlobRef> } {
  const cut: Record<string, BlobRef> = {}
  let budget = 24_000
  const walk = (v: unknown, p: Path, depth: number): unknown => {
    if (typeof v === 'string') {
      const limit = Math.max(200, Math.min(LIMITS.input, budget))
      budget -= Math.min(v.length, limit)
      if (v.length <= limit) return v
      cut[p.slice(path.length).join('.')] = makeRef(at, p)
      return v.slice(0, limit)
    }
    if (depth > 6) return Array.isArray(v) ? [] : isObj(v) ? {} : v
    if (Array.isArray(v)) return v.slice(0, 200).map((x, i) => walk(x, [...p, i], depth + 1))
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, [...p, k], depth + 1)]))
    return v
  }
  const out = isObj(input) ? (walk(input, path, 0) as Record<string, unknown>) : {}
  return Object.keys(cut).length ? { input: out, cut } : { input: out }
}

// ─── A line ──────────────────────────────────────────────────────────────────

export interface LineEntries {
  entries: TranscriptEntry[]
  results: ToolResult[]
}

const NONE: LineEntries = { entries: [], results: [] }

function systemEntries(e: Raw, key: string, t: number): TranscriptEntry[] {
  const content = str(e.content) ?? ''
  switch (e.subtype) {
    case 'compact_boundary': {
      const meta = isObj(e.compactMetadata) ? e.compactMetadata : {}
      return [{ kind: 'compact', key, time: t, trigger: str(meta.trigger), preTokens: num(meta.preTokens) ?? null, earlier: null }]
    }
    case 'api_error': {
      let message = 'The request failed'
      try {
        const err = typeof e.error === 'string' ? (JSON.parse(e.error) as Raw) : isObj(e.error) ? e.error : {}
        // "401 {…}": the status leads the message.
        const leading = /^(\d{3})\b/.exec(str(err.message) ?? '')
        const status = num(err.status) ?? (leading ? Number(leading[1]) : undefined)
        if (status) message = `The request failed (${status})`
      } catch {
        // Not JSON: keep the plain message.
      }
      const attempt = num(e.retryAttempt)
      const max = num(e.maxRetries)
      return [{ kind: 'notice', key, time: t, tone: 'warning', icon: 'error', text: attempt && max ? `${message} · retry ${attempt} of ${max}` : message }]
    }
    case 'informational':
      return content ? [{ kind: 'notice', key, time: t, tone: e.level === 'warning' ? 'warning' : 'info', icon: 'info', text: content }] : []
    case 'model_refusal_fallback':
      return content ? [{ kind: 'notice', key, time: t, tone: 'warning', icon: 'switch', text: content.split('\n')[0], detail: content.includes('\n') ? content : undefined }] : []
    case 'local_command': {
      const stdout = tagged(content, 'local-command-stdout')
      const stderr = tagged(content, 'local-command-stderr')
      if (stdout === null && stderr === null) return content ? [{ kind: 'output', key, time: t, stdout: content.trim(), stderr: '' }] : []
      return [{ kind: 'output', key, time: t, stdout: (stdout ?? '').trim(), stderr: (stderr ?? '').trim() }]
    }
    case 'stop_hook_summary': {
      const errors = Array.isArray(e.hookErrors) ? e.hookErrors.filter((x) => typeof x === 'string' && x.trim()) : []
      if (!errors.length && e.preventedContinuation !== true) return []
      return [{ kind: 'notice', key, time: t, tone: 'warning', icon: 'hook', text: e.preventedContinuation === true ? 'A stop hook ended the turn' : 'A stop hook reported an error', detail: errors.join('\n') || str(e.stopReason) || undefined }]
    }
    default:
      return []
  }
}

/** The entries one transcript line shows, and the tool results it carries. */
export function lineEntries(e: Raw, at: LineAt): LineEntries {
  const uuid = str(e.uuid)
  if (!uuid) return NONE
  const t = time(e.timestamp)
  const message = isObj(e.message) ? e.message : null

  if (e.type === 'user') {
    if (e.isMeta === true || !message) return NONE
    const content = message.content
    if (e.isCompactSummary === true) {
      const text = textOf(content)
      const part = cutText(text, LIMITS.summary, at, typeof content === 'string' ? ['message', 'content'] : ['message', 'content', 0, 'text'])
      return { entries: [{ kind: 'summary', key: uuid, time: t, text: part.text, ...(part.more ? { more: part.more } : {}) }], results: [] }
    }
    const results = lineResults(e, at)
    if (results.length) {
      // A tool result line carries nothing else worth showing, unless you stopped the tool.
      const interrupted = /^\[Request interrupted by user/.test(textOf(content).trim())
      return { entries: interrupted ? userEntries(e, uuid, t, at, content, ['message', 'content'], false) : [], results }
    }
    return { entries: userEntries(e, uuid, t, at, content, ['message', 'content'], false), results: [] }
  }

  if (e.type === 'assistant') {
    if (!message || !Array.isArray(message.content)) return NONE
    const messageId = str(message.id)
    const model = str(message.model) === '<synthetic>' ? null : str(message.model)
    const entries: TranscriptEntry[] = []
    message.content.forEach((b, i) => {
      if (!isObj(b)) return
      const key = i === 0 ? uuid : `${uuid}#${i}`
      const path = ['message', 'content', i]
      if (b.type === 'text' && typeof b.text === 'string') {
        if (!b.text.trim()) return
        if (e.isApiErrorMessage === true) {
          entries.push({ kind: 'notice', key, time: t, tone: 'error', icon: 'error', text: b.text.trim() })
          return
        }
        const part = cutText(b.text, LIMITS.text, at, [...path, 'text'])
        entries.push({ kind: 'text', key, time: t, text: part.text, ...(part.more ? { more: part.more } : {}), messageId, model })
      } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        const text = typeof b.thinking === 'string' ? b.thinking : ''
        const part = cutText(text, LIMITS.text, at, [...path, 'thinking'])
        entries.push({ kind: 'thinking', key, time: t, text: part.text, ...(part.more ? { more: part.more } : {}), ms: num(e.thinkingDurationMs) ?? null, messageId, model })
      } else if ((b.type === 'tool_use' || b.type === 'server_tool_use') && typeof b.id === 'string' && typeof b.name === 'string') {
        entries.push({ kind: 'tool', key, time: t, id: b.id, name: b.name, ...cutInput(b.input, at, [...path, 'input']), messageId, model })
      } else if (b.type === 'fallback') {
        const from = isObj(b.from) ? str(b.from.model) : null
        const to = isObj(b.to) ? str(b.to.model) : null
        entries.push({ kind: 'notice', key, time: t, tone: 'info', icon: 'switch', text: from && to ? `Switched from ${from} to ${to}` : 'Switched models' })
      }
    })
    return { entries, results: [] }
  }

  if (e.type === 'system') return { entries: systemEntries(e, uuid, t), results: [] }

  if (e.type === 'attachment' && isObj(e.attachment) && (e.attachment.type === 'file' || e.attachment.type === 'directory')) {
    const mention = mentionEntry(e.attachment, uuid, t, at)
    return mention ? { entries: [mention], results: [] } : NONE
  }

  if (e.type === 'attachment' && isObj(e.attachment) && e.attachment.type === 'queued_command') {
    // Sent while Claude was working: a prompt you typed, or a background task's notice.
    const a = e.attachment
    const prompt = a.prompt
    if (a.commandMode === 'prompt' || a.commandMode === undefined) {
      return { entries: userEntries(e, uuid, t, at, prompt, ['attachment', 'prompt'], true), results: [] }
    }
    if (typeof prompt === 'string' && prompt.includes('<task-notification>')) return { entries: userEntries(e, uuid, t, at, prompt, ['attachment', 'prompt'], false), results: [] }
  }
  return NONE
}

/** Entry types the viewer knows, shown or deliberately hidden; anything else is new to Gloom. */
export const KNOWN_TYPES = new Set([
  'user',
  'assistant',
  'system',
  'attachment',
  'progress',
  'summary',
  'last-prompt',
  'custom-title',
  'ai-title',
  'mode',
  'agent-name',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'bridge-session',
  'cost-state',
  'atis-latch',
  'isolation-latch',
  'api-request',
  'api-request-blob',
  'api-request-shape',
  'tools-used',
  'worktree-state',
  'pr-link'
])
