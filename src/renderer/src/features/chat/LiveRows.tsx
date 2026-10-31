import { ChevronRight, LoaderCircle } from 'lucide-react'
import type { Activity, StreamBlock } from '@shared/live'
import { cn } from '../../lib/cn'
import { useNow } from '../../lib/now'
import { useTranscript } from '../../stores/transcript'
import { Markdown } from './Markdown'
import { formatDuration } from './ToolRow'

/** What a tool's call is about to do, while its input still streams in. */
function toolVerb(name: string | undefined): string {
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return 'Preparing a command'
    case 'Write':
      return 'Writing a file'
    case 'Edit':
    case 'MultiEdit':
      return 'Preparing an edit'
    case 'Read':
      return 'Reading'
    case 'Grep':
    case 'Glob':
      return 'Searching'
    case 'WebFetch':
      return 'Fetching a page'
    case 'WebSearch':
      return 'Searching the web'
    case 'Task':
    case 'Agent':
      return 'Briefing an agent'
    case 'TodoWrite':
      return 'Updating the to-do list'
    default:
      return name?.startsWith('mcp__') ? `Using ${name.split('__').slice(2).join(' ').replace(/_/g, ' ')}` : `Using ${name ?? 'a tool'}`
  }
}

/**
 * A block of the reply still arriving. Text reads as it comes; the text itself
 * isn't animated. Thinking folds, as finished thinking does.
 */
export function StreamRow({ rowKey, block }: { rowKey: string; block: StreamBlock }) {
  const open = useTranscript((s) => s.expanded.has(rowKey))
  const setExpanded = useTranscript((s) => s.setExpanded)
  if (block.kind === 'text') return <Markdown text={block.text} />
  if (block.kind === 'tool') {
    return (
      <div className="-mx-2 flex items-center gap-2 px-2 py-[3px] text-[0.875rem] text-label-secondary">
        <LoaderCircle size={14} strokeWidth={1.75} aria-hidden className="shrink-0 animate-spin motion-reduce:animate-none" />
        <span className="live-text">{toolVerb(block.name)}</span>
      </div>
    )
  }
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setExpanded(rowKey, !open)}
        className="no-drag -mx-2 flex items-center gap-1.5 rounded-[8px] px-2 py-[3px] text-[0.875rem] text-label-secondary outline-none hover:bg-fill active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]"
      >
        <ChevronRight size={12} strokeWidth={2.25} aria-hidden className={cn('transition-transform duration-[var(--duration-tooltip)] ease-out motion-reduce:transition-none', open && 'rotate-90')} />
        <span className="live-text">Thinking</span>
      </button>
      {open && block.text && <Markdown text={block.text} className="mt-1 border-l-2 border-separator-strong pb-1 pl-3 text-[0.875rem] text-label-secondary" />}
    </div>
  )
}

const ACTIVITY: Record<Activity, string> = {
  requesting: 'Working',
  thinking: 'Thinking',
  writing: 'Writing',
  tool: 'Working',
  compacting: 'Compacting the conversation'
}

/**
 * The turn under way, at the foot of the transcript: what Claude is doing and
 * for how long. Light sweeps across the words, as across a running session's
 * title in the sidebar; under reduced motion they hold still.
 */
export function WorkingRow({ since, activity }: { since: number; activity: Activity | null }) {
  const now = useNow(1000)
  const seconds = Math.max(0, now - since)
  // Not a live region: the toolbar's status says "Working…" once; a clock ticking here would be read out every second.
  return (
    <p className="flex items-baseline gap-1.5 text-[0.875rem] text-label-secondary">
      <span className="live-text font-medium">{ACTIVITY[activity ?? 'requesting']}</span>
      {seconds >= 1000 && (
        <span className="tabular text-footnote" aria-hidden>
          · {formatDuration(seconds)}
        </span>
      )}
    </p>
  )
}
