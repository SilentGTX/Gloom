// Reads what the session list needs from Claude Code's transcripts without
// loading them whole: the head for when a session started and its first prompt,
// the tail for its latest title, last prompt, working folder and activity. The
// CLI re-appends its title and last prompt as it goes, so they sit near the end
// (always within the last 32 KB on this PC, in files up to 520 MB).
import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { SessionMeta } from '@shared/library'

/** Bump when what's read changes, so every cached entry is read again. */
export const INDEX_VERSION = 1
const TAIL_CHUNK = 256 * 1024
const HEAD_CHUNK = 64 * 1024
/** The first prompt can sit behind copied history in a continued session. */
const HEAD_LIMIT = 1024 * 1024
/** How far back the tail looks for a title before falling back to the first prompt. */
const TAIL_LIMIT = 2 * 1024 * 1024
/** Appends bigger than this (a session that ran on while Gloom was closed) are read as a fresh tail. */
const APPEND_LIMIT = 4 * 1024 * 1024
const PROMPT_MAX = 400
const NEWLINE = 0x0a

/** What the indexer keeps per transcript; the session's metadata is derived from it. */
export interface FileIndex {
  size: number
  mtimeMs: number
  /** Just past the last complete line read: appended bytes are read from here. */
  end: number
  created: number | null
  firstPrompt: string | null
  customTitle: string | null
  aiTitle: string | null
  lastPrompt: string | null
  updated: number | null
  cwd: string | null
  gitBranch: string | null
  version: string | null
  entrypoint: string | null
}

export interface IndexCache {
  version: number
  files: Record<string, FileIndex>
}

/** A transcript is `<projects>/<project>/<id>.jsonl`; `agent-*` files and anything deeper are subagents. */
export function isTranscript(file: string, projectsDir: string): boolean {
  const name = basename(file)
  return name.endsWith('.jsonl') && !name.startsWith('agent-') && samePath(dirname(dirname(file)), projectsDir)
}

/** Paths compare case-insensitively on Windows, whichever way their slashes lean. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  return norm(a) === norm(b)
}

export function listTranscripts(projectsDir: string): string[] {
  const files: string[] = []
  let projects: string[]
  try {
    projects = readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return files
  }
  for (const project of projects) {
    try {
      for (const f of readdirSync(join(projectsDir, project), { withFileTypes: true })) {
        if (f.isFile() && f.name.endsWith('.jsonl') && !f.name.startsWith('agent-')) files.push(join(projectsDir, project, f.name))
      }
    } catch {
      // A project folder that vanished mid-scan.
    }
  }
  return files
}

// ─── Lines ───────────────────────────────────────────────────────────────────

/** Called with a line, its byte offset in the file and its length in bytes (without the newline). */
export type LineFn = (line: string, offset: number, length: number) => boolean | void

/**
 * Calls `fn` with each complete line in [start, end), oldest first, until it
 * returns true or `limit` bytes are read. Returns the offset just past the last
 * newline it reached, which is where an incomplete last line starts.
 */
export function readLinesForward(fd: number, start: number, end: number, fn: LineFn, limit = Infinity): number {
  let pos = start
  let lineStart = start
  let pending: Buffer[] = []
  while (pos < end && pos - start < limit) {
    const raw = Buffer.allocUnsafe(Math.min(HEAD_CHUNK, end - pos))
    const n = readSync(fd, raw, 0, raw.length, pos)
    if (n <= 0) break
    const buf = raw.subarray(0, n)
    let from = 0
    for (let nl = buf.indexOf(NEWLINE); nl !== -1; nl = buf.indexOf(NEWLINE, from)) {
      const piece = buf.subarray(from, nl)
      const line = pending.length ? Buffer.concat([...pending, piece]).toString('utf8') : piece.toString('utf8')
      pending = []
      const offset = lineStart
      from = nl + 1
      lineStart = pos + from
      if (fn(line, offset, pos + nl - offset)) return lineStart
    }
    if (from < n) pending.push(buf.subarray(from))
    pos += n
  }
  return lineStart
}

/**
 * Calls `fn` with each complete line before `end`, newest first, reading back
 * in chunks until it returns true or `limit` bytes are read. A last line with
 * no newline yet is still being written, so it's skipped. Returns the offset
 * just past the file's last newline (0 if none was found).
 */
export function readLinesBackward(fd: number, end: number, fn: LineFn, limit = Infinity): number {
  let pos = end
  let carry: Buffer | null = null
  let lastNewline = -1
  let first = true
  while (pos > 0 && end - pos < limit) {
    const start = Math.max(0, pos - TAIL_CHUNK)
    const buf = Buffer.allocUnsafe(pos - start)
    const n = readSync(fd, buf, 0, buf.length, start)
    if (n <= 0) break
    const data: Buffer = carry ? Buffer.concat([buf.subarray(0, n), carry]) : buf.subarray(0, n)
    let stop = data.length
    if (first) {
      // Whatever follows the last newline is unfinished.
      const nl = data.lastIndexOf(NEWLINE)
      if (nl === -1) {
        carry = data
        pos = start
        continue
      }
      lastNewline = start + nl
      stop = nl
      first = false
    }
    // data[0, stop) ends at a line boundary; walk its lines back to front.
    // (A negative offset would make lastIndexOf search from the end, hence the guard.)
    let lineEnd = stop
    while (lineEnd > 0) {
      const nl = data.lastIndexOf(NEWLINE, lineEnd - 1)
      if (nl === -1) break
      // data[0] sits at `start` in the file.
      if (fn(data.toString('utf8', nl + 1, lineEnd), start + nl + 1, lineEnd - nl - 1)) return lastNewline + 1
      lineEnd = nl
    }
    // data[0, lineEnd) began in an earlier chunk, unless this is the file's start.
    if (start === 0) {
      if (lineEnd > 0) fn(data.toString('utf8', 0, lineEnd), 0, lineEnd)
      break
    }
    carry = data.subarray(0, lineEnd)
    pos = start
  }
  return lastNewline + 1
}

// ─── Entries ─────────────────────────────────────────────────────────────────

type Entry = Record<string, unknown>

/** Big entries that never carry what the index needs; skipped without parsing. */
const SKIP_PREFIXES = ['{"type":"file-history-snapshot"', '{"type":"file-history-delta"', '{"type":"api-request', '{"type":"atis-latch"']

function parse(line: string): Entry | null {
  if (!line || SKIP_PREFIXES.some((p) => line.startsWith(p))) return null
  try {
    const e = JSON.parse(line) as unknown
    return e && typeof e === 'object' && !Array.isArray(e) ? (e as Entry) : null
  } catch {
    return null
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

function time(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** A prompt as the list shows it: pasted blocks folded, slash commands by name, one line. */
export function cleanPrompt(text: string): string | null {
  let t = text
  const command = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(t)
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(t)?.[1]?.trim()
    t = args ? `${command[1]} ${args}` : command[1]
  }
  if (/^\s*<(local-command-|bash-|system-reminder)/.test(t)) return null
  t = t
    .replace(/<pasted_content\b[^>]*>[\s\S]*?(<\/pasted_content>|$)/g, ' [Pasted text] ')
    .replace(/<system-reminder>[\s\S]*?(<\/system-reminder>|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t.slice(0, PROMPT_MAX) : null
}

/** What you typed, from a queued prompt or a user message; null for tool results, meta and commands' output. */
function promptOf(e: Entry): string | null {
  if (e.type === 'queue-operation') return e.operation === 'enqueue' && typeof e.content === 'string' ? cleanPrompt(e.content) : null
  if (e.type !== 'user' || e.isMeta || e.isSidechain || e.isCompactSummary || e.toolUseResult !== undefined) return null
  const content = (e.message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return cleanPrompt(content)
  if (!Array.isArray(content) || content.some((b) => (b as Entry)?.type === 'tool_result')) return null
  const text = content
    .filter((b): b is { type: 'text'; text: string } => (b as Entry)?.type === 'text' && typeof (b as Entry).text === 'string')
    .map((b) => b.text)
    .join(' ')
  return cleanPrompt(text)
}

function blank(size: number, mtimeMs: number): FileIndex {
  return {
    size,
    mtimeMs,
    end: 0,
    created: null,
    firstPrompt: null,
    customTitle: null,
    aiTitle: null,
    lastPrompt: null,
    updated: null,
    cwd: null,
    gitBranch: null,
    version: null,
    entrypoint: null
  }
}

/** Fills what's still missing from an entry. Used newest-first on the tail. */
function takeLatest(fi: FileIndex, e: Entry): void {
  if (e.type === 'custom-title') fi.customTitle ??= str(e.customTitle)
  else if (e.type === 'ai-title') fi.aiTitle ??= str(e.aiTitle)
  else if (e.type === 'last-prompt') fi.lastPrompt ??= cleanPrompt(String(e.lastPrompt ?? ''))
  fi.updated ??= time(e.timestamp)
  fi.cwd ??= str(e.cwd)
  fi.gitBranch ??= str(e.gitBranch)
  fi.version ??= str(e.version)
  fi.entrypoint ??= str(e.entrypoint)
}

/** Overwrites with a newer entry. Used oldest-first on appended lines. */
function takeNewer(fi: FileIndex, e: Entry): void {
  if (e.type === 'custom-title') fi.customTitle = str(e.customTitle) ?? fi.customTitle
  else if (e.type === 'ai-title') fi.aiTitle = str(e.aiTitle) ?? fi.aiTitle
  else if (e.type === 'last-prompt') fi.lastPrompt = cleanPrompt(String(e.lastPrompt ?? '')) ?? fi.lastPrompt
  const t = time(e.timestamp)
  if (t !== null) {
    fi.updated = Math.max(fi.updated ?? 0, t)
    fi.created ??= t
  }
  fi.cwd = str(e.cwd) ?? fi.cwd
  fi.gitBranch = str(e.gitBranch) ?? fi.gitBranch
  fi.version = str(e.version) ?? fi.version
  fi.entrypoint = str(e.entrypoint) ?? fi.entrypoint
  fi.firstPrompt ??= promptOf(e)
}

function readHead(fd: number, size: number, fi: FileIndex): void {
  readLinesForward(
    fd,
    0,
    size,
    (line) => {
      const e = parse(line)
      if (!e) return false
      fi.created ??= time(e.timestamp)
      fi.cwd ??= str(e.cwd)
      fi.firstPrompt ??= promptOf(e)
      return fi.created !== null && fi.firstPrompt !== null
    },
    HEAD_LIMIT
  )
}

/** Reads back from the end until it has a title, the last prompt, the working folder and the last activity. */
function readTail(fd: number, size: number, fi: FileIndex): void {
  // The head's working folder is only a fallback for the tail's.
  const headCwd = fi.cwd
  fi.cwd = null
  let scanned = 0
  fi.end = readLinesBackward(
    fd,
    size,
    (line) => {
      scanned += line.length + 1
      const e = parse(line)
      if (e) takeLatest(fi, e)
      // A Claude app title wins over the CLI's; past the first chunk, either will do.
      const titled = fi.customTitle !== null || (fi.aiTitle !== null && scanned > TAIL_CHUNK)
      return titled && fi.lastPrompt !== null && fi.updated !== null && fi.cwd !== null
    },
    TAIL_LIMIT
  )
  fi.cwd ??= headCwd
}

/** Reads one transcript's head and tail. */
export function indexFile(file: string): FileIndex {
  const fd = openSync(file, 'r')
  try {
    const { size, mtimeMs } = fstatSync(fd)
    return indexOpen(fd, size, mtimeMs)
  } finally {
    closeSync(fd)
  }
}

function indexOpen(fd: number, size: number, mtimeMs: number): FileIndex {
  const fi = blank(size, mtimeMs)
  readHead(fd, size, fi)
  readTail(fd, size, fi)
  return fi
}

/** Brings an entry up to date with what was appended since `prev.end`; anything else is read afresh. */
export function indexAppended(file: string, prev: FileIndex): FileIndex {
  const fd = openSync(file, 'r')
  try {
    const { size, mtimeMs } = fstatSync(fd)
    if (size === prev.size) return { ...prev, mtimeMs }
    // Shorter means rewritten, not appended.
    if (size < prev.size) return indexOpen(fd, size, mtimeMs)
    if (size - prev.end > APPEND_LIMIT) {
      // A long way behind: keep what the head said, read a fresh tail.
      const fi: FileIndex = { ...blank(size, mtimeMs), created: prev.created, firstPrompt: prev.firstPrompt, cwd: prev.cwd }
      readTail(fd, size, fi)
      fi.customTitle ??= prev.customTitle
      fi.aiTitle ??= prev.aiTitle
      fi.lastPrompt ??= prev.lastPrompt
      return fi
    }
    const fi: FileIndex = { ...prev, size, mtimeMs }
    fi.end = readLinesForward(fd, prev.end, size, (line) => {
      const e = parse(line)
      if (e) takeNewer(fi, e)
    })
    return fi
  } finally {
    closeSync(fd)
  }
}

/** The session a transcript holds, or null while it has no prompt yet. */
export function toMeta(file: string, fi: FileIndex): SessionMeta | null {
  const title = fi.customTitle ?? fi.aiTitle
  if (!title && !fi.firstPrompt && !fi.lastPrompt) return null
  const project = basename(dirname(file))
  return {
    id: basename(file, '.jsonl'),
    file,
    project,
    cwd: fi.cwd,
    title,
    firstPrompt: fi.firstPrompt,
    lastPrompt: fi.lastPrompt,
    created: fi.created ?? fi.mtimeMs,
    updated: fi.updated ?? fi.mtimeMs,
    size: fi.size,
    entrypoint: fi.entrypoint,
    gitBranch: fi.gitBranch,
    version: fi.version,
    remote: project.startsWith('ssh-')
  }
}

export interface IndexStats {
  files: number
  /** Files read now; the rest came from the cache. */
  read: number
  ms: number
}

/** Indexes every transcript, reusing cached entries whose size and modified time still match. */
export function indexAll(projectsDir: string, cache: Record<string, FileIndex>): { files: Record<string, FileIndex>; stats: IndexStats } {
  const started = performance.now()
  const files: Record<string, FileIndex> = {}
  let read = 0
  for (const file of listTranscripts(projectsDir)) {
    try {
      const prev = cache[file]
      if (prev) {
        const { size, mtimeMs } = statSync(file)
        if (size === prev.size && mtimeMs === prev.mtimeMs) {
          files[file] = prev
          continue
        }
      }
      files[file] = prev ? indexAppended(file, prev) : indexFile(file)
      read++
    } catch {
      // Unreadable right now (locked, or gone): the next change event tries again.
    }
  }
  return { files, stats: { files: Object.keys(files).length, read, ms: Math.round(performance.now() - started) } }
}

/** Sessions from indexed files. Should two folders hold the same session ID, the newer file wins. */
export function collectSessions(files: Record<string, FileIndex>, only?: ReadonlySet<string>): Map<string, SessionMeta> {
  const sessions = new Map<string, SessionMeta>()
  for (const [file, fi] of Object.entries(files)) {
    if (only && !only.has(basename(file, '.jsonl'))) continue
    const meta = toMeta(file, fi)
    if (!meta) continue
    const other = sessions.get(meta.id)
    if (!other || meta.updated > other.updated) sessions.set(meta.id, meta)
  }
  return sessions
}
