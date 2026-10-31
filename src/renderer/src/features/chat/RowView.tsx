import { memo, useContext, useId, useState, type ReactNode } from 'react'
import { ArrowLeftRight, Bell, ChevronRight, CircleAlert, ClipboardType, Hand, Info, MessageSquareQuote, Webhook } from 'lucide-react'
import type { CompactEntry, MentionEntry, NoticeEntry, NoticeIcon, OutputEntry, PromptEntry, SummaryEntry, TextEntry, ThinkingEntry } from '@shared/transcript'
import { cn } from '../../lib/cn'
import { useColumnTranscript } from '../../stores/transcript'
import { useConcept } from '../concept/parts'
import { StreamRow, WorkingRow } from './LiveRows'
import { Markdown } from './Markdown'
import { ImageStrip, ShowAll, useFullText } from './media'
import { PromptActions, RewindAllowed } from './Rewind'
import type { Row } from './rows'
import { formatDuration, TextCard, ToolRow, useOpen } from './ToolRow'
import { describeMention, modelName } from './tools'

/** One row of the transcript. Rows only ever fade; Virtuoso measures them, so nothing animates their size. */
export const RowView = memo(function RowView({ row, sessionId }: { row: Row; sessionId: string }) {
  const concept = useConcept()
  return (
    // The concept's column is 720 px with 32 px sides, and its cards sit a little further apart.
    <div data-row-key={row.key} className={cn('mx-auto w-full max-w-[720px]', concept ? 'px-8' : 'px-6')} style={{ paddingTop: concept ? conceptSpace(row) : row.space }}>
      <RowBody row={row} sessionId={sessionId} />
    </div>
  )
})

/** Cards need air between them: a run of tool calls, tight as lines, opens up to 8 px as cards. */
function conceptSpace(row: Row): number {
  return row.space === 2 ? 8 : row.space === 12 ? 16 : row.space
}

function RowBody({ row, sessionId }: { row: Row; sessionId: string }) {
  switch (row.kind) {
    case 'time':
      return <TimeRow time={row.time} />
    case 'prompt':
      return <PromptRow sessionId={sessionId} entry={row.entry} />
    case 'mention':
      return <MentionRow sessionId={sessionId} rowKey={row.key} entry={row.entry} />
    case 'text':
      return <TextRow sessionId={sessionId} entry={row.entry} />
    case 'thinking':
      return <ThinkingRow rowKey={row.key} entry={row.entry} />
    case 'tool':
      return <ToolRow sessionId={sessionId} rowKey={row.key} call={row.entry} result={row.result} running={row.running} />
    case 'notice':
      return <NoticeRow rowKey={row.key} entry={row.entry} repeats={row.repeats} />
    case 'output':
      return <OutputRow entry={row.entry} />
    case 'compact':
      return <CompactRow rowKey={row.key} entry={row.entry} summary={row.summary} />
    case 'turn':
      return (
        <p className="text-caption text-label-secondary tabular">
          Worked for {formatDuration(row.ms)}
          {modelName(row.model) && ` · ${modelName(row.model)}`}
        </p>
      )
    case 'stream':
      return <StreamRow rowKey={row.key} block={row.block} />
    case 'working':
      return <WorkingRow since={row.since} activity={row.activity} />
  }
}

// ─── Time ────────────────────────────────────────────────────────────────────

/** "Today 2:57 PM", "Yesterday 9:12 AM", "Monday 10:03 AM", then "Mon, Oct 12 at 10:03 AM". */
export function formatWhen(ms: number, now = Date.now()): { day: string; time: string } {
  const date = new Date(ms)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const days = Math.floor((midnight.getTime() - new Date(date).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return { day: 'Today', time }
  if (days === 1) return { day: 'Yesterday', time }
  if (days < 7) return { day: date.toLocaleDateString(undefined, { weekday: 'long' }), time }
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return { day: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }), time: `at ${time}` }
}

function TimeRow({ time }: { time: number }) {
  const { day, time: at } = formatWhen(time)
  return (
    <p className="text-center text-caption text-label-secondary tabular">
      <span className="font-semibold">{day}</span> {at}
    </p>
  )
}

// ─── What you sent ───────────────────────────────────────────────────────────

/**
 * Your message, in a bubble on the trailing side; images ride above it.
 * Hovering it (or tabbing into it) offers Edit and Rewind to Here beside it.
 */
function PromptRow({ sessionId, entry }: { sessionId: string; entry: PromptEntry }) {
  const { full, loading, load } = useFullText(sessionId, entry.more)
  const text = full ?? entry.text
  const rewind = useContext(RewindAllowed) && !entry.queued
  const concept = useConcept()
  return (
    <div className={cn('group/prompt flex flex-col items-end gap-1.5', concept ? 'pl-[20%]' : 'pl-[12%]')}>
      {entry.queued && <span className="text-caption text-label-secondary">Sent while Claude was working</span>}
      {entry.images.length > 0 && <ImageStrip sessionId={sessionId} images={entry.images} height={132} label="Attached image" />}
      {(entry.command || text) && (
        <div className="flex max-w-full items-center gap-2">
          {rewind && <PromptActions sessionId={sessionId} entry={entry} />}
          <div
            className={cn(
              'min-w-0 bg-[var(--bubble)] text-[0.9375rem] leading-[1.5] shadow-[var(--bubble-shadow)] select-text',
              // The concept's bubble has a tail at its bottom right, towards you.
              concept ? 'rounded-[16px_16px_4px_16px] px-3.5 py-2.5' : 'rounded-[18px] px-3.5 py-2'
            )}
          >
            {entry.command ? <span className="font-mono text-[0.875rem]">{entry.command}</span> : <PromptText text={text} />}
            {entry.more && !full && (
              <div className="-mb-0.5 -ml-1.5">
                <ShowAll onClick={load} loading={loading} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * A file or folder your message mentioned, on its side, as Claude Code shows
 * it under the message: "Read notes/a.txt · 2 lines". It opens to what Claude
 * Code read in: the file's lines, or the folder's listing.
 */
function MentionRow({ sessionId, rowKey, entry }: { sessionId: string; rowKey: string; entry: MentionEntry }) {
  const [open, flip] = useOpen(rowKey, 'tools')
  const setExpanded = (_key: string, _open: boolean) => flip()
  const panel = useId()
  const view = describeMention(entry)
  const Icon = view.icon
  const opens = !!entry.content.text
  const line = (
    <>
      <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
      <span className="flex min-w-0 items-baseline gap-1.5 text-[0.875rem] leading-[1.5]">
        <span className="shrink-0 text-label-secondary">{view.verb}</span>
        <span title={entry.full} className="min-w-0 truncate font-mono text-[0.8125rem] text-label">
          {entry.path}
          {entry.folder && !entry.path.endsWith('/') && '/'}
        </span>
        {view.note && <span className="shrink-0 text-[0.8125rem] text-label-secondary tabular">{view.note}</span>}
      </span>
    </>
  )
  return (
    <div className="flex flex-col items-end pl-[12%]">
      {opens ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setExpanded(rowKey, !open)}
          className="no-drag -mr-2 flex max-w-[calc(100%+8px)] min-w-0 items-center gap-1.5 rounded-[8px] px-2 py-[3px] text-left outline-none hover:bg-fill active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]"
        >
          <ChevronRight
            size={12}
            strokeWidth={2.25}
            aria-hidden
            className={cn('shrink-0 text-label-secondary transition-transform duration-[var(--duration-tooltip)] ease-out motion-reduce:transition-none', open && 'rotate-90')}
          />
          {line}
        </button>
      ) : (
        <div className="flex max-w-full min-w-0 items-center gap-1.5 py-[3px]">{line}</div>
      )}
      {opens && open && (
        <div id={panel} className="w-full pt-1.5 pb-1">
          <TextCard sessionId={sessionId} part={entry.content} />
        </div>
      )}
    </div>
  )
}

const PASTED = /<pasted_content\b[^>]*>([\s\S]*?)(?:<\/pasted_content>|$)/g

/** Your words as you typed them; pasted blocks fold into a chip that opens. */
function PromptText({ text }: { text: string }) {
  const pieces: ReactNode[] = []
  let at = 0
  for (const m of text.matchAll(PASTED)) {
    const before = text.slice(at, m.index).trim()
    if (before) pieces.push(<p key={`t${at}`} className="break-words whitespace-pre-wrap">{before}</p>)
    pieces.push(<Pasted key={`p${m.index}`} text={m[1].replace(/^\n+|\n+$/g, '')} />)
    at = m.index + m[0].length
  }
  const rest = text.slice(at).trim()
  if (rest) pieces.push(<p key={`t${at}`} className="break-words whitespace-pre-wrap">{rest}</p>)
  return <div className="space-y-1.5">{pieces}</div>
}

function Pasted({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const lines = text.split('\n').length
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="no-drag flex items-center gap-1.5 rounded-[8px] bg-fill-strong py-1 pr-2.5 pl-1.5 text-footnote font-medium text-label outline-none hover:bg-fill-pressed focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
      >
        <ChevronRight size={11} strokeWidth={2.25} aria-hidden className={cn('transition-transform duration-[var(--duration-tooltip)] ease-out motion-reduce:transition-none', open && 'rotate-90')} />
        <ClipboardType size={13} strokeWidth={1.75} aria-hidden className="text-label-secondary" />
        Pasted text
        <span className="font-normal text-label-secondary tabular">
          · {lines.toLocaleString()} {lines === 1 ? 'line' : 'lines'}
        </span>
      </button>
      {open && <pre className="code-text mt-1.5 max-h-[420px] overflow-auto rounded-[8px] bg-fill p-2.5 whitespace-pre-wrap">{text}</pre>}
    </div>
  )
}

// ─── Claude ──────────────────────────────────────────────────────────────────

function TextRow({ sessionId, entry }: { sessionId: string; entry: TextEntry }) {
  const { full, loading, load } = useFullText(sessionId, entry.more)
  return (
    <div>
      <Markdown text={full ?? entry.text} />
      {entry.more && !full && (
        <div className="mt-1 -ml-1.5">
          <ShowAll onClick={load} loading={loading} />
        </div>
      )}
    </div>
  )
}

/** Thinking, named for how long it took when that's known: folded, unless the Transcript View opens it. */
function ThinkingRow({ rowKey, entry }: { rowKey: string; entry: ThinkingEntry }) {
  const [open, flip] = useOpen(rowKey, 'thinking')
  const setExpanded = (_key: string, _open: boolean) => flip()
  const label = entry.ms ? `Thought for ${formatDuration(entry.ms)}` : 'Thinking'
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setExpanded(rowKey, !open)}
        className="no-drag -mx-2 flex items-center gap-1.5 rounded-[8px] px-2 py-[3px] text-[0.875rem] text-label-secondary outline-none hover:bg-fill active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]"
      >
        <ChevronRight size={12} strokeWidth={2.25} aria-hidden className={cn('transition-transform duration-[var(--duration-tooltip)] ease-out motion-reduce:transition-none', open && 'rotate-90')} />
        {label}
      </button>
      {open && <Markdown text={entry.text} className="mt-1 border-l-2 border-separator-strong pb-1 pl-3 text-[0.875rem] text-label-secondary" />}
    </div>
  )
}

// ─── Events ──────────────────────────────────────────────────────────────────

const NOTICE_ICONS: Record<NoticeIcon, typeof Info> = {
  interrupt: Hand,
  error: CircleAlert,
  switch: ArrowLeftRight,
  info: Info,
  task: Bell,
  message: MessageSquareQuote,
  hook: Webhook
}

/**
 * Something that happened. Short informational ones sit centred and small;
 * warnings and errors sit on the reading edge with their icon, and any more to
 * read opens beneath.
 */
function NoticeRow({ rowKey, entry, repeats }: { rowKey: string; entry: NoticeEntry; repeats: number }) {
  const [open, flip] = useOpen(rowKey, 'tools')
  const setExpanded = (_key: string, _open: boolean) => flip()
  const Icon = NOTICE_ICONS[entry.icon]
  // A request retried in a row reads as one notice: "The request failed (529) · retried 3 times".
  const text = repeats > 1 ? `${entry.text.split(' · ')[0]} · retried ${repeats} times` : entry.text
  if (entry.tone === 'info' && !entry.detail) {
    return (
      <p className="flex items-center justify-center gap-1.5 text-center text-footnote text-label-secondary select-text">
        <Icon size={13} strokeWidth={1.75} aria-hidden className="shrink-0" />
        <span className="min-w-0">{text}</span>
      </p>
    )
  }
  const tint = entry.tone === 'error' ? 'text-[var(--removed-text)]' : entry.tone === 'warning' ? 'text-[var(--warning)]' : 'text-label-secondary'
  return (
    <div className="text-footnote">
      <div className="flex items-start gap-2">
        <Icon size={14} strokeWidth={1.75} aria-hidden className={cn('mt-[2px] shrink-0', tint)} />
        <p className="min-w-0 flex-1 text-label select-text">{text}</p>
        {entry.detail && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setExpanded(rowKey, !open)}
            className="no-drag shrink-0 rounded-[6px] px-1.5 font-medium text-accent-text outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          >
            {open ? 'Hide Details' : 'Details'}
          </button>
        )}
      </div>
      {open && entry.detail && <p className="mt-1 ml-[22px] whitespace-pre-wrap text-label-secondary select-text">{entry.detail}</p>}
    </div>
  )
}

/** A slash command's output, or a `!` command and what it printed. */
function OutputRow({ entry }: { entry: OutputEntry }) {
  if (!entry.input && !entry.stdout && !entry.stderr) return null
  return (
    <div className={cn('flex', !entry.input && 'justify-end pl-[12%]')}>
      <pre className="code-text code-card max-w-full overflow-x-auto px-3 py-2 break-words whitespace-pre-wrap">
        {entry.input && (
          <span>
            <span className="text-label-secondary select-none">! </span>
            {entry.input}
            {(entry.stdout || entry.stderr) && '\n'}
          </span>
        )}
        {entry.stdout}
        {entry.stderr && <span className="text-[var(--removed-text)]">{entry.stdout ? `\n${entry.stderr}` : entry.stderr}</span>}
      </pre>
    </div>
  )
}

/** "Conversation compacted", with the summary Claude carried on from, and Show Earlier above it. */
function CompactRow({ rowKey, entry, summary }: { rowKey: string; entry: CompactEntry; summary: SummaryEntry | null }) {
  const earlier = useColumnTranscript((s) => s.earlier[rowKey])
  const showEarlier = useColumnTranscript((s) => s.showEarlier)
  const [open, flip] = useOpen(rowKey, 'tools')
  const setExpanded = (_key: string, _open: boolean) => flip()
  const tokens = entry.preTokens ? ` · ${Math.round(entry.preTokens / 1000).toLocaleString()}K tokens` : ''
  return (
    <div className="flex flex-col items-center gap-1.5">
      {entry.earlier && earlier !== 'shown' && (
        <div className="pb-1">
          {earlier === 'missing' ? (
            <p className="text-footnote text-label-secondary">The conversation before this isn’t in this transcript.</p>
          ) : (
            <ShowAll onClick={() => showEarlier(rowKey)} loading={earlier === 'loading'}>
              Show Earlier Messages
            </ShowAll>
          )}
        </div>
      )}
      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-separator-strong" />
        <span className="text-caption font-medium text-label-secondary tabular">
          Conversation compacted
          {entry.trigger === 'auto' ? ' automatically' : ''}
          {tokens}
        </span>
        <div className="h-px flex-1 bg-separator-strong" />
      </div>
      {summary && (
        <div className="w-full">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setExpanded(rowKey, !open)}
            className="no-drag mx-auto flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-footnote font-medium text-accent-text outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          >
            {open ? 'Hide the Summary' : 'Show the Summary'}
          </button>
          {open && <SummaryText entry={summary} />}
        </div>
      )}
    </div>
  )
}

function SummaryText({ entry }: { entry: SummaryEntry }) {
  const sessionId = useColumnTranscript((s) => s.id) ?? ''
  const { full, loading, load } = useFullText(sessionId, entry.more)
  return (
    <div className="mt-2">
      <Markdown text={full ?? entry.text} className="text-[0.875rem] text-label-secondary" />
      {entry.more && !full && (
        <div className="mt-1 -ml-1.5">
          <ShowAll onClick={load} loading={loading} />
        </div>
      )}
    </div>
  )
}
