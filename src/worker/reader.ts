// Reads a transcript for the chat without loading it whole. The newest page
// comes first: from the end of the file back along the conversation's chain
// (every entry names its parent), so a branch left behind by a rewind drops
// out. Tool results are matched to their calls by ID, wherever they hang, since
// parallel calls put them on side branches. A compaction starts the chain
// afresh; what came before it is a page of its own (Show Earlier). Older pages
// come on request, and a followed file reports what's appended as it grows.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import {
  KNOWN_TYPES,
  lineEntries,
  lineResults,
  parseRef,
  resolveRef,
  type Cursor,
  type LineAt,
  type ToolResult,
  type TranscriptEntry,
  type TranscriptPage,
  type TranscriptUpdate
} from '@shared/transcript'
import { readLinesBackward, readLinesForward } from './indexer'

/** A page ends at the start of a turn once it shows this many entries… */
const PAGE_ENTRIES = 150
/** …or, inside one very long turn, at the start of a response past either of these. */
const PAGE_MAX_ENTRIES = 800
const PAGE_MAX_PARSED = 24 * 1024 * 1024
/** The longest line a reference may point into. */
const BLOB_MAX = 128 * 1024 * 1024

type Raw = Record<string, unknown>

/** One entry on the chain: what it links to, and what it shows. */
interface Link {
  uuid: string
  parent: string | null
  type: string
  messageId: string | null
  entries: TranscriptEntry[]
}

/** The entry type a line leads with, when it leads with one (chain entries lead with parentUuid). */
function leadingType(line: string): string | null {
  if (!line.startsWith('{"type":"')) return null
  return line.slice(9, line.indexOf('"', 9))
}

const CHAIN_TYPES = new Set(['user', 'assistant', 'system', 'attachment', 'progress'])
const SYSTEM_SUBTYPES = new Set(['compact_boundary', 'api_error', 'informational', 'local_command', 'model_refusal_fallback', 'stop_hook_summary', 'turn_duration'])

function parse(line: string): Raw | null {
  try {
    const e = JSON.parse(line) as unknown
    return e && typeof e === 'object' && !Array.isArray(e) ? (e as Raw) : null
  } catch {
    return null
  }
}

function link(e: Raw, entries: TranscriptEntry[]): Link {
  const message = e.message as Raw | undefined
  return {
    uuid: e.uuid as string,
    parent: typeof e.parentUuid === 'string' ? e.parentUuid : null,
    type: String(e.type),
    messageId: message && typeof message.id === 'string' ? message.id : null,
    entries
  }
}

/** A turn starts with something you sent, or with a background task reporting back. */
function startsTurn(entries: TranscriptEntry[]): boolean {
  return entries.some((x) => (x.kind === 'prompt' && !x.queued) || (x.kind === 'notice' && x.icon === 'task'))
}

export interface PageRead {
  page: TranscriptPage
  /** Just past the file's last complete line: appended lines start here. */
  end: number
  /** The newest entry of the chain, which appended entries continue from. */
  tip: string | null
  /** Every entry on the page's chain, shown or not. */
  chain: string[]
  /** Entry types Gloom doesn't know yet (the format is undocumented and changes). */
  unknown: string[]
}

/** Reads one page: the newest when `cursor` is null, else the page before `cursor`. */
export function readPage(file: string, cursor: Cursor | null): PageRead {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    let want: string | null = cursor ? cursor.want : null
    const links: Link[] = [] // newest first
    const results = new Map<string, ToolResult>()
    const unknown = new Set<string>()
    let shown = 0
    let parsed = 0
    let older: Cursor | null = null

    const end = readLinesBackward(fd, cursor ? Math.min(cursor.offset, size) : size, (line, offset, length) => {
      const lead = leadingType(line)
      if (lead !== null && !CHAIN_TYPES.has(lead)) {
        if (!KNOWN_TYPES.has(lead)) unknown.add(lead)
        return false
      }
      parsed += length
      const e = parse(line)
      if (!e) return false
      if (typeof e.type === 'string' && !KNOWN_TYPES.has(e.type)) unknown.add(e.type)
      if (e.type === 'system' && typeof e.subtype === 'string' && !SYSTEM_SUBTYPES.has(e.subtype)) unknown.add(`system:${e.subtype}`)
      if (typeof e.uuid !== 'string' || e.isSidechain === true) return false
      const at: LineAt = { offset, length }
      // The newest entry ends the chain that's shown.
      want ??= e.uuid
      if (e.uuid !== want) {
        // Not on the chain, but it may hold a parallel call's result.
        if (e.type === 'user') for (const r of lineResults(e, at)) if (!results.has(r.toolUseId)) results.set(r.toolUseId, r)
        return false
      }
      const shows = lineEntries(e, at)
      for (const r of shows.results) if (!results.has(r.toolUseId)) results.set(r.toolUseId, r)
      const l = link(e, shows.entries)
      links.push(l)
      shown += shows.entries.length

      if (e.type === 'system' && e.subtype === 'compact_boundary') {
        // The chain starts afresh here; Show Earlier reads on from the conversation before it.
        const compact = shows.entries[0]
        if (compact?.kind === 'compact' && typeof e.logicalParentUuid === 'string') compact.earlier = { offset, want: e.logicalParentUuid }
        return true
      }
      if (!l.parent) return true
      want = l.parent
      const newer = links.at(-2)
      const startsResponse = l.type === 'assistant' && (!newer || newer.type !== 'assistant' || newer.messageId !== l.messageId)
      if ((shown >= PAGE_ENTRIES && startsTurn(shows.entries)) || ((shown >= PAGE_MAX_ENTRIES || parsed >= PAGE_MAX_PARSED) && startsResponse)) {
        older = { offset, want: l.parent }
        return true
      }
      return false
    })

    links.reverse()
    const entries = links.flatMap((l) => l.entries)
    const calls = new Set(entries.flatMap((x) => (x.kind === 'tool' ? [x.id] : [])))
    const kept: Record<string, ToolResult> = {}
    for (const [id, r] of results) if (calls.has(id)) kept[id] = r
    return { page: { entries, results: kept, older }, end, tip: links.at(-1)?.uuid ?? null, chain: links.map((l) => l.uuid), unknown: [...unknown] }
  } finally {
    closeSync(fd)
  }
}

/** What a BlobRef points to: an image as a data URL, a long text, a whole diff. */
export function readBlob(file: string, ref: string): unknown {
  const r = parseRef(ref)
  if (!r || r.length > BLOB_MAX) throw new Error('bad reference')
  const fd = openSync(file, 'r')
  try {
    if (r.offset + r.length > fstatSync(fd).size) throw new Error('reference past the end of the file')
    const buf = Buffer.allocUnsafe(r.length)
    const n = readSync(fd, buf, 0, r.length, r.offset)
    const e = parse(buf.toString('utf8', 0, n))
    if (!e) throw new Error('reference to a line that is not an entry')
    return resolveRef(e, r.path)
  } finally {
    closeSync(fd)
  }
}

/**
 * Keeps a transcript you're looking at current. Each update reads only what was
 * appended. Entries continuing the shown chain are sent as they are; tool
 * results go by ID; a branch off anything earlier (a rewind) or a rewritten
 * file sends the newest page again instead.
 */
export class Follower {
  private end: number
  private tip: string | null
  private shown: Set<string>
  /** Everything appended since the page was read, by uuid, to walk back through. */
  private appended = new Map<string, Link>()

  constructor(
    readonly file: string,
    read: PageRead
  ) {
    this.end = read.end
    this.tip = read.tip
    this.shown = new Set(read.chain)
  }

  update(): TranscriptUpdate | null {
    let fd: number
    try {
      fd = openSync(this.file, 'r')
    } catch {
      return { type: 'gone' }
    }
    try {
      const size = fstatSync(fd).size
      if (size === this.end) return null
      if (size < this.end) return this.reload()
      const added: Link[] = []
      const results: Record<string, ToolResult> = {}
      this.end = readLinesForward(fd, this.end, size, (line, offset, length) => {
        const lead = leadingType(line)
        if (lead !== null && !CHAIN_TYPES.has(lead)) return
        const e = parse(line)
        if (!e || typeof e.uuid !== 'string' || e.isSidechain === true) return
        const shows = lineEntries(e, { offset, length })
        for (const r of shows.results) results[r.toolUseId] = r
        const l = link(e, shows.entries)
        added.push(l)
        this.appended.set(l.uuid, l)
      })
      const withResults = (entries: TranscriptEntry[]): TranscriptUpdate | null =>
        entries.length || Object.keys(results).length ? { type: 'append', entries, results } : null
      if (!added.length) return withResults([])

      // The newest entry ends the chain now; walk back to where it meets what's shown.
      const leaf = added[added.length - 1]
      const segment: Link[] = []
      let u: string | null = leaf.uuid
      while (u !== null && u !== this.tip) {
        if (this.shown.has(u)) {
          // Off something shown, but not the newest: a side branch (a parallel call's
          // result, a hook) adds nothing to the chain; anything that shows is a rewind.
          return segment.every((l) => l.entries.length === 0) ? withResults([]) : this.reload()
        }
        const l = this.appended.get(u)
        if (!l) return this.reload()
        segment.push(l)
        u = l.parent
      }
      // Walked past the start without meeting the tip: a new chain (a compaction, say).
      if (u === null && this.tip !== null) return this.reload()
      segment.reverse()
      this.tip = leaf.uuid
      for (const l of segment) this.shown.add(l.uuid)
      return withResults(segment.flatMap((l) => l.entries))
    } finally {
      closeSync(fd)
    }
  }

  private reload(): TranscriptUpdate {
    const read = readPage(this.file, null)
    this.end = read.end
    this.tip = read.tip
    this.shown = new Set(read.chain)
    this.appended.clear()
    return { type: 'reload', page: read.page }
  }
}
