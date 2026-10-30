// The transcript as the chat's rows: entries in order, each tool call with its
// result, the time above a prompt after a pause, and how long each turn took
// under its reply. Pure, so it's tested without a window.
import type { CompactEntry, NoticeEntry, OutputEntry, PromptEntry, SummaryEntry, TextEntry, ThinkingEntry, ToolEntry, ToolResult, TranscriptEntry } from '@shared/transcript'
import { describeTool } from './tools'

/** Space above a row, in pixels: tight inside a run of tool calls, loose before a new turn. */
export type Space = 2 | 6 | 12 | 20 | 28

interface RowBase {
  key: string
  space: Space
}

export type Row = RowBase &
  (
    | { kind: 'time'; time: number }
    | { kind: 'prompt'; entry: PromptEntry }
    | { kind: 'text'; entry: TextEntry }
    | { kind: 'thinking'; entry: ThinkingEntry }
    /** `running`: no result yet in a session that's live elsewhere. */
    | { kind: 'tool'; entry: ToolEntry; result: ToolResult | undefined; running: boolean }
    /** `repeats`: the same notice in a row (an API error retried), shown once. */
    | { kind: 'notice'; entry: NoticeEntry; repeats: number }
    | { kind: 'output'; entry: OutputEntry }
    | { kind: 'compact'; entry: CompactEntry; summary: SummaryEntry | null }
    | { kind: 'turn'; ms: number; model: string | null }
  )

/** A pause this long, or a new day, puts the time above the next prompt. */
const PAUSE_MS = 30 * 60 * 1000

function startsTurn(e: TranscriptEntry): boolean {
  return (e.kind === 'prompt' && !e.queued) || (e.kind === 'notice' && e.icon === 'task')
}

const isReply = (e: TranscriptEntry) => e.kind === 'text' || e.kind === 'tool' || e.kind === 'thinking'
const compact = (kind: Row['kind']) => kind === 'tool' || kind === 'thinking'

export function buildRows(entries: readonly TranscriptEntry[], results: Readonly<Record<string, ToolResult>>, { live = false } = {}): Row[] {
  const rows: Row[] = []
  let start: TranscriptEntry | null = null
  let last: TranscriptEntry | null = null
  let model: string | null = null
  let replied = false
  let prev: TranscriptEntry | null = null

  const endTurn = () => {
    if (start && last && replied && last.time - start.time >= 1000) rows.push({ kind: 'turn', key: `turn:${start.key}`, space: 6, ms: last.time - start.time, model })
    start = null
  }
  /** Space above a row, from what comes before it. */
  const spaceFor = (kind: Row['kind']): Space => {
    const before = rows.at(-1)
    if (!before) return 12
    if (compact(kind) && compact(before.kind)) return 2
    if (before.kind === 'time') return 6
    if (kind === 'prompt' || kind === 'compact') return 20
    return 12
  }

  for (const e of entries) {
    if (startsTurn(e) || e.kind === 'compact') {
      endTurn()
      if (startsTurn(e)) {
        start = e
        last = e
        model = null
        replied = false
      }
      const day = (t: number) => new Date(t).toDateString()
      if (!prev || e.time - prev.time >= PAUSE_MS || day(e.time) !== day(prev.time)) rows.push({ kind: 'time', key: `time:${e.key}`, space: rows.length ? 28 : 12, time: e.time })
    }
    prev = e
    if (start) {
      last = e
      if (isReply(e)) {
        replied = true
        if ('model' in e && e.model) model = e.model
      }
    }

    switch (e.kind) {
      case 'prompt':
        rows.push({ kind: 'prompt', key: e.key, space: spaceFor('prompt'), entry: e })
        break
      case 'text':
        rows.push({ kind: 'text', key: e.key, space: spaceFor('text'), entry: e })
        break
      case 'thinking':
        // Thinking the model didn't show leaves nothing to read: no row.
        if (e.text.trim()) rows.push({ kind: 'thinking', key: e.key, space: spaceFor('thinking'), entry: e })
        break
      case 'tool':
        rows.push({ kind: 'tool', key: e.key, space: spaceFor('tool'), entry: e, result: results[e.id], running: false })
        break
      case 'notice': {
        const before = rows.at(-1)
        if (before?.kind === 'notice' && before.entry.icon === e.icon && before.entry.tone === e.tone && e.icon === 'error') {
          rows[rows.length - 1] = { ...before, entry: e, repeats: before.repeats + 1 }
        } else rows.push({ kind: 'notice', key: e.key, space: spaceFor('notice'), entry: e, repeats: 1 })
        break
      }
      case 'output':
        rows.push({ kind: 'output', key: e.key, space: rows.at(-1)?.kind === 'prompt' ? 6 : spaceFor('output'), entry: e })
        break
      case 'compact':
        rows.push({ kind: 'compact', key: e.key, space: spaceFor('compact'), entry: e, summary: null })
        break
      case 'summary': {
        // The summary belongs to the compaction just before it.
        const owner = [...rows].reverse().find((r) => r.kind === 'compact')
        if (owner?.kind === 'compact' && !owner.summary) owner.summary = e
        break
      }
    }
  }

  if (live) {
    // The last turn is still going: its calls without results are running, and it has no time yet.
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]
      if (r.kind === 'prompt' || r.kind === 'compact') break
      if (r.kind === 'tool' && !r.result) rows[i] = { ...r, running: true }
    }
  } else endTurn()
  return rows
}

// ─── Find ────────────────────────────────────────────────────────────────────

/** The text Find looks through: what the row shows, then what it hides behind a disclosure. */
export function rowText(row: Row): { shown: string; hidden: string } {
  switch (row.kind) {
    case 'prompt':
      return { shown: row.entry.command ?? stripMarkup(row.entry.text), hidden: '' }
    case 'text':
      return { shown: stripMarkdown(row.entry.text), hidden: '' }
    case 'thinking':
      return { shown: '', hidden: row.entry.text }
    case 'tool': {
      const view = describeTool(row.entry, row.result)
      const shown = [view.verb, view.target, view.note].filter(Boolean).join(' ')
      return { shown, hidden: toolText(row.entry, row.result) }
    }
    case 'notice':
      return { shown: row.entry.text, hidden: row.entry.detail ?? '' }
    case 'output':
      return { shown: [row.entry.input, row.entry.stdout, row.entry.stderr].filter(Boolean).join('\n'), hidden: '' }
    case 'compact':
      return { shown: 'Conversation compacted', hidden: row.summary?.text ?? '' }
    default:
      return { shown: '', hidden: '' }
  }
}

/** Every string in a call's input and its result, as the details show them. */
function toolText(call: ToolEntry, result: ToolResult | undefined): string {
  const out: string[] = []
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v)
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(call.input)
  if (result) {
    for (const p of result.parts) if (p.type === 'text') out.push(p.text)
    const { stdout, stderr, hunks, content } = result.info
    if (stdout) out.push(stdout.text)
    if (stderr) out.push(stderr.text)
    if (content) out.push(content.text)
    if (hunks) for (const h of hunks) out.push(h.lines.map((l) => l.slice(1)).join('\n'))
  }
  return out.join('\n')
}

/** Pasted blocks' tags aren't shown; their text is. */
function stripMarkup(text: string): string {
  return text.replace(/<\/?pasted_content\b[^>]*>/g, '')
}

/** Markdown's syntax, roughly as rendering removes it, so matches line up with what's on screen. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^```[^\n]*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(?<![\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
}

/** Case-insensitive occurrences of `query` in `text`. */
export function countMatches(text: string, query: string): number {
  if (!query) return 0
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  let n = 0
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++
  return n
}
