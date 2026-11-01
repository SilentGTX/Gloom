import { createContext, Fragment, useContext, useId, useState, type ReactNode } from 'react'
import { ChevronRight, Circle, CircleCheck, CircleDot, LoaderCircle } from 'lucide-react'
import type { Hunk, Part, TextPart, ToolEntry, ToolResult } from '@shared/transcript'
import { hunksOf } from '@shared/transcript'
import { cn } from '../../lib/cn'
import { useColumnTranscript, useColumnTranscriptApi } from '../../stores/transcript'
import { Spinner, useConcept } from '../concept/parts'
import { Markdown } from './Markdown'
import { ImageStrip, ShowAll, useBlob, useFullText } from './media'
import type { ToolRowData } from './rows'
import { describeGroup, describeTool, pastTense, toolKind, type ToolView } from './tools'
import { FurnitureRow, isFurniture, ProposalCard } from './Furniture'
import { FileCode2 } from 'lucide-react'
import { useUi } from '../../stores/ui'

/**
 * A tool call as one line, "Edited foo.ts +12 −3", with a disclosure triangle
 * at its leading edge that opens what it did: the command and its output, the
 * diff, the file, the agent's report. While a session runs elsewhere, a call
 * still waiting for its result spins in place of its icon.
 */
export function ToolRow(props: { sessionId: string; rowKey: string; call: ToolEntry; result: ToolResult | undefined; running: boolean }) {
  const { call } = props
  // Gloom's (and the Claude app's) conversation furniture draws as itself; Verbose shows the calls too.
  const verbose = useContext(OpenByDefault).tools
  if (!verbose && isFurniture(call.name)) return <FurnitureRow sessionId={props.sessionId} call={call} result={props.result} />
  if (!verbose && call.name === 'mcp__gloom__start_session' && call.input.initiation === 'own_initiative' && !props.running) return <ProposalCard sessionId={props.sessionId} call={call} result={props.result} />
  // A command, a read, an edit… reads as a quiet line, as the Claude app shows it; an agent, a question or a plan keeps its card.
  if (!verbose && toolKind(call, props.result) !== null) return <CompactStep {...props} />
  return <ToolStep {...props} />
}

/**
 * The line a folded step or run shows, as the Claude app draws them: what
 * happened in secondary ink, the lines it added and removed, and a triangle
 * after it that opens it.
 */
function Fold({
  open,
  panel,
  onToggle,
  running,
  failed,
  added,
  removed,
  children
}: {
  open: boolean
  panel: string
  onToggle(): void
  running: boolean
  failed: string | null
  added?: number
  removed?: number
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={panel}
      onClick={onToggle}
      className={cn(
        'no-drag -mx-1.5 flex max-w-[calc(100%+12px)] min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 py-[2px] text-left text-[0.875rem] leading-[1.5] text-label-secondary outline-none',
        'hover:text-label active:text-label focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]'
      )}
    >
      {running && <LoaderCircle size={13} strokeWidth={2} aria-label="Running" className="shrink-0 animate-spin motion-reduce:animate-none" />}
      <span className="min-w-0 truncate">{children}</span>
      {failed && <span className="shrink-0 text-[0.78125rem] font-medium text-[var(--removed-text)]">{failed}</span>}
      <Counts added={added} removed={removed} />
      <ChevronRight size={12} strokeWidth={2.25} aria-hidden className={cn('shrink-0 transition-transform duration-[var(--duration-tooltip)] ease-out motion-reduce:transition-none', open && 'rotate-90')} />
    </button>
  )
}

/** What a step did, opened under its line: in the concept, on the step's card; in the classic look, indented under it. */
function FoldBody({ id, children }: { id: string; children: ReactNode }) {
  const concept = useConcept()
  return concept ? (
    <div id={id} className="concept-step is-detail mt-1 mb-1.5">
      <div className="concept-step-body">{children}</div>
    </div>
  ) : (
    <div id={id} className="pt-1 pb-2">
      {children}
    </div>
  )
}

/** One tool call as a quiet line: "Edited Furniture.tsx +35 −23 ›", or a lone command by its description, "Ran the unit suites". */
function CompactStep({ sessionId, rowKey, call, result, running }: { sessionId: string; rowKey: string; call: ToolEntry; result: ToolResult | undefined; running: boolean }) {
  const [open, flip] = useOpen(rowKey, 'tools')
  const view = describeTool(call, result, running)
  const panel = useId()
  const description = (call.name === 'Bash' || call.name === 'PowerShell') && typeof call.input.description === 'string' && call.input.description.trim() ? call.input.description : null
  return (
    <div className="min-w-0">
      <Fold open={open} panel={panel} onToggle={flip} running={running && !result} failed={result?.isError ? 'Failed' : null} added={view.added} removed={view.removed}>
        {description && !(running && !result) ? (
          pastTense(description)
        ) : (
          <>
            {view.verb}
            {view.target && <span className={cn(view.mono && 'font-mono text-[0.8125rem]')}> {view.target}</span>}
            {view.note && <span className="text-[0.8125rem]"> · {view.note}</span>}
          </>
        )}
      </Fold>
      {open && (
        <FoldBody id={panel}>
          <Details sessionId={sessionId} call={call} result={result} view={view} running={running} />
        </FoldBody>
      )}
    </div>
  )
}

/** A run of tool calls as one line, "Ran 2 commands, read a file, edited a file +3 ›"; it opens to each step, a line of its own. */
export function ToolRunRow({ sessionId, rowKey, steps }: { sessionId: string; rowKey: string; steps: ToolRowData[] }) {
  const [open, flip] = useOpen(rowKey, 'tools')
  const panel = useId()
  const view = describeGroup(steps.map((s) => ({ call: s.entry, result: s.result, running: s.running })))
  return (
    <div className="min-w-0">
      <Fold open={open} panel={panel} onToggle={flip} running={view.running} failed={view.failed ? `${view.failed} failed` : null} added={view.added} removed={view.removed}>
        {view.text}
      </Fold>
      {open && (
        <div id={panel} className="mt-0.5 mb-1 ml-1 flex flex-col border-l border-separator-strong pl-3">
          {steps.map((s) => (
            <ToolRow key={s.key} sessionId={sessionId} rowKey={s.key} call={s.entry} result={s.result} running={s.running} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolStep({ sessionId, rowKey, call, result, running }: { sessionId: string; rowKey: string; call: ToolEntry; result: ToolResult | undefined; running: boolean }) {
  const [open, flip] = useOpen(rowKey, 'tools')
  const setExpanded = (_key: string, _open: boolean) => flip()
  const view = describeTool(call, result, running)
  const panel = useId()
  const failed = result?.isError === true
  const Icon = view.icon
  const concept = useConcept()
  const latestTodos = useContext(LatestTodos)

  if (concept) {
    // The newest to-do list stands open as a checklist; earlier ones fold away like any step.
    if (view.details === 'todos' && latestTodos === rowKey) return <TodoCard todos={Array.isArray(call.input.todos) ? (call.input.todos as Todo[]) : []} />
    return (
      <div className="concept-step">
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setExpanded(rowKey, !open)} className="concept-step-head no-drag">
          <ChevronRight size={12} strokeWidth={2.25} aria-hidden className={cn('concept-chevron', open && 'is-open')} />
          <span className="concept-glyph" aria-hidden>
            {running ? <Spinner /> : <Icon size={14} strokeWidth={1.75} className={cn(failed && 'text-[var(--removed-text)]')} />}
          </span>
          {running && <span className="sr-only">Running</span>}
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[0.875rem] leading-[1.5]">
            <span className="shrink-0 text-label-secondary">{view.verb}</span>
            {view.target && <span className={cn('min-w-0 truncate text-label', view.mono && 'font-mono text-[0.78125rem]')}>{view.target}</span>}
            {view.note && <span className="min-w-0 shrink-0 truncate text-[0.78125rem] text-label-secondary">{view.note}</span>}
          </span>
          {failed ? (
            <span className="shrink-0 text-[0.78125rem] font-medium text-[var(--removed-text)]">Failed</span>
          ) : (
            <Counts added={view.added} removed={view.removed} />
          )}
        </button>
        {open && (
          <div id={panel} className="concept-step-body">
            <Details sessionId={sessionId} call={call} result={result} view={view} running={running} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setExpanded(rowKey, !open)}
        className={cn(
          'no-drag group/tool -mx-2 flex w-[calc(100%+16px)] min-w-0 items-center gap-1.5 rounded-[8px] px-2 py-[3px] text-left outline-none',
          'hover:bg-fill active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]'
        )}
      >
        <ChevronRight
          size={12}
          strokeWidth={2.25}
          aria-hidden
          className={cn('shrink-0 text-label-secondary transition-transform duration-[var(--duration-tooltip)] ease-out motion-reduce:transition-none', open && 'rotate-90')}
        />
        {running ? (
          <LoaderCircle size={14} strokeWidth={1.75} aria-label="Running" className="shrink-0 animate-spin text-label-secondary motion-reduce:animate-none" />
        ) : (
          <Icon size={14} strokeWidth={1.75} aria-hidden className={cn('shrink-0', failed ? 'text-[var(--removed-text)]' : 'text-label-secondary')} />
        )}
        <Summary view={view} />
        {failed && <span className="shrink-0 text-caption font-medium text-[var(--removed-text)]">Failed</span>}
      </button>
      {open && (
        <div id={panel} className="pt-1.5 pb-2 pl-[26px]">
          <Details sessionId={sessionId} call={call} result={result} view={view} running={running} />
        </div>
      )}
    </div>
  )
}

/** The key of the transcript's newest to-do list, which the concept shows as an open checklist. */
export const LatestTodos = createContext<string | null>(null)

/** What the conversation's Transcript View opens without a click: Claude's thinking (Thinking, Verbose), every tool call (Verbose). */
export const OpenByDefault = createContext<{ thinking: boolean; tools: boolean }>({ thinking: false, tools: false })

/**
 * Whether a folding row is open, and its toggle. A row you clicked is the
 * other way round from how the Transcript View opens rows of its kind
 * (Verbose: every tool call and event; Thinking and Verbose: thinking).
 */
export function useOpen(rowKey: string, kind: 'tools' | 'thinking'): [boolean, () => void] {
  const transcriptApi = useColumnTranscriptApi()
  const toggled = useColumnTranscript((s) => s.expanded.has(rowKey))
  const open = useContext(OpenByDefault)[kind] !== toggled
  return [open, () => transcriptApi.getState().setExpanded(rowKey, !toggled)]
}

type Todo = { content?: unknown; status?: unknown }

/** "+12 −3" at a step card's trailing edge. */
function Counts({ added, removed }: { added?: number; removed?: number }) {
  if (!added && !removed) return null
  return (
    <span className="flex shrink-0 gap-1.5 text-[0.78125rem] font-medium tabular">
      {!!added && <span className="text-[var(--added-text)]">+{added}</span>}
      {!!removed && <span className="text-[var(--removed-text)]">−{removed}</span>}
    </span>
  )
}

/**
 * The concept's to-do list: a card of round checks, filled with a tick when
 * done, a dot in a ring while under way, an empty ring still to do. The
 * shapes say it as well as the colour, and each item says it aloud.
 */
function TodoCard({ todos }: { todos: Todo[] }) {
  if (!todos.length) return null
  return (
    <div className="concept-step">
      <ul aria-label="To-do list" className="flex flex-col gap-2 px-3.5 py-3 text-[0.875rem]">
        {todos.map((t, i) => {
          const status = str(t.status)
          return (
            <li key={i} className="flex items-start gap-2.5">
              <span aria-hidden className={cn('concept-check', status === 'completed' ? 'is-done' : status === 'in_progress' ? 'is-now' : 'is-todo')} />
              <span className="sr-only">{status === 'completed' ? 'Done:' : status === 'in_progress' ? 'Under way:' : 'To do:'}</span>
              <span className={cn('min-w-0 select-text', status === 'completed' && 'text-label-secondary line-through')}>{str(t.content)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Summary({ view }: { view: ToolView }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[0.875rem] leading-[1.5]">
      <span className="shrink-0 text-label-secondary">{view.verb}</span>
      {view.target && <span className={cn('min-w-0 truncate text-label', view.mono && 'font-mono text-[0.8125rem]')}>{view.target}</span>}
      {view.note && <span className="shrink-0 truncate text-[0.8125rem] text-label-secondary">{view.note}</span>}
      {(view.added !== undefined || view.removed !== undefined) && (view.added || view.removed) ? (
        <span className="shrink-0 text-[0.8125rem] font-medium tabular">
          {!!view.added && <span className="text-[var(--added-text)]">+{view.added}</span>}
          {!!view.added && !!view.removed && ' '}
          {!!view.removed && <span className="text-[var(--removed-text)]">−{view.removed}</span>}
        </span>
      ) : null}
    </span>
  )
}

// ─── Details ─────────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function Details(props: { sessionId: string; call: ToolEntry; result: ToolResult | undefined; view: ToolView; running: boolean }) {
  // A step on a file (Read, Edit, Write) opens that file in the side pane, at the line it read from.
  const path = typeof props.call.input.file_path === 'string' ? props.call.input.file_path : typeof props.call.input.notebook_path === 'string' ? props.call.input.notebook_path : null
  if (!path) return <DetailsBody {...props} />
  const line = typeof props.call.input.offset === 'number' ? props.call.input.offset : null
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => useUi.getState().openFile(path, line)}
        className="no-drag inline-flex items-center gap-1 rounded-[6px] px-1 text-footnote font-medium text-accent-text outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
      >
        <FileCode2 size={12} strokeWidth={1.75} aria-hidden />
        Open File
      </button>
      <DetailsBody {...props} />
    </div>
  )
}

function DetailsBody({ sessionId, call, result, view, running }: { sessionId: string; call: ToolEntry; result: ToolResult | undefined; view: ToolView; running: boolean }) {
  const input = call.input
  const failed = result?.isError === true
  const nothing = !result && <Caption>{running ? 'Running…' : 'No result was recorded.'}</Caption>

  switch (view.details) {
    case 'shell': {
      const out = result?.info
      return (
        <div className="space-y-1.5">
          {str(input.description) && <Caption>{str(input.description)}</Caption>}
          <div className="code-card overflow-hidden">
            <TextBlock sessionId={sessionId} part={{ type: 'text', text: str(input.command), more: call.cut?.command }} prefix="$ " />
            {result && (
              <div className="border-t border-[var(--card-edge)]">
                {out?.stdout || out?.stderr ? (
                  <>
                    {out.stdout && <TextBlock sessionId={sessionId} part={out.stdout} />}
                    {out.stderr && <TextBlock sessionId={sessionId} part={out.stderr} tone="error" />}
                  </>
                ) : (
                  <Parts sessionId={sessionId} parts={result.parts} tone={failed ? 'error' : undefined} bare />
                )}
              </div>
            )}
          </div>
          {out?.interrupted && <Caption>Interrupted.</Caption>}
          {nothing}
        </div>
      )
    }
    case 'diff': {
      const info = result?.info
      if (failed || !info) return <>{result ? <Parts sessionId={sessionId} parts={result.parts} tone="error" /> : nothing}</>
      if (info.hunks?.length) return <Diff sessionId={sessionId} hunks={info.hunks} more={info.hunksMore} />
      if (info.content) return <TextCard sessionId={sessionId} part={info.content} tone="added" />
      return <Parts sessionId={sessionId} parts={result.parts} />
    }
    case 'markdown': {
      const plan = str(input.plan)
      const report = result?.parts.filter((p): p is TextPart => p.type === 'text').map((p) => p.text).join('\n\n')
      return (
        <div className="space-y-2">
          {plan && <Markdown text={plan} className="text-[0.875rem]" />}
          {!plan && str(input.prompt) && <Disclosed label="Prompt" text={str(input.prompt)} />}
          {report && !plan ? <Markdown text={report} className="text-[0.875rem]" /> : !plan && nothing}
          {result?.info.durationMs !== undefined && (
            <Caption>
              {formatDuration(result.info.durationMs)}
              {result.info.toolCount !== undefined && ` · ${result.info.toolCount} tool ${result.info.toolCount === 1 ? 'use' : 'uses'}`}
            </Caption>
          )}
        </div>
      )
    }
    case 'todos':
      return <Todos todos={Array.isArray(input.todos) ? (input.todos as { content?: unknown; status?: unknown }[]) : []} />
    case 'questions':
      return <Questions sessionId={sessionId} input={input} result={result} />
    case 'output':
      return result ? <Parts sessionId={sessionId} parts={result.parts} tone={failed ? 'error' : undefined} /> : <>{nothing}</>
    default:
      return (
        <div className="space-y-2">
          <InputList sessionId={sessionId} call={call} />
          {result ? <Parts sessionId={sessionId} parts={result.parts} tone={failed ? 'error' : undefined} /> : nothing}
        </div>
      )
  }
}

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-footnote text-label-secondary select-text">{children}</p>
}

type Tone = 'error' | 'added'

/** Text the tool returned, monospaced; "Show All" reads the rest when it was cut short. */
function TextBlock({ sessionId, part, prefix, tone }: { sessionId: string; part: TextPart; prefix?: string; tone?: Tone }) {
  const { full, loading, load } = useFullText(sessionId, part.more)
  const text = full ?? part.text
  return (
    <div className="px-3 py-2">
      <pre
        className={cn('code-text break-words whitespace-pre-wrap', tone === 'error' && 'text-[var(--removed-text)]', tone === 'added' && 'text-[var(--added-text)]')}
      >
        {prefix && <span className="text-label-secondary select-none">{prefix}</span>}
        {text}
      </pre>
      {part.more && !full && (
        <div className="mt-1 -ml-1.5">
          <ShowAll onClick={load} loading={loading} />
        </div>
      )}
    </div>
  )
}

export function TextCard({ sessionId, part, tone }: { sessionId: string; part: TextPart; tone?: Tone }) {
  return (
    <div className="code-card">
      <TextBlock sessionId={sessionId} part={part} tone={tone} />
    </div>
  )
}

/** A result's parts: text in cards, images in a strip. */
function Parts({ sessionId, parts, tone, bare }: { sessionId: string; parts: Part[]; tone?: Tone; bare?: boolean }) {
  const texts = parts.filter((p): p is TextPart => p.type === 'text' && !!p.text.trim())
  const images = parts.filter((p) => p.type === 'image')
  if (!texts.length && !images.length) return bare ? null : <Caption>No output.</Caption>
  return (
    <div className={cn(!bare && 'space-y-1.5')}>
      {texts.map((p, i) => (bare ? <TextBlock key={i} sessionId={sessionId} part={p} tone={tone} /> : <TextCard key={i} sessionId={sessionId} part={p} tone={tone} />))}
      {images.length > 0 && <ImageStrip sessionId={sessionId} images={images} height={140} label="Screenshot" />}
    </div>
  )
}

/** A unified diff with new-file line numbers; removed lines show the old ones. */
function Diff({ sessionId, hunks, more }: { sessionId: string; hunks: Hunk[]; more?: string }) {
  const [asked, setAsked] = useState(false)
  const whole = useBlob(sessionId, more, asked)
  const shown = whole !== undefined && whole !== null ? hunksOf(whole) : hunks
  return (
    <div>
      <div className="code-card overflow-x-auto">
        <div className="code-text min-w-max py-1.5">
          {shown.map((h, i) => {
            let oldLine = h.oldStart
            let newLine = h.newStart
            return (
              <Fragment key={i}>
                {i > 0 && <div className="mx-3 my-1 h-px bg-[var(--card-edge)]" />}
                {h.lines.map((line, j) => {
                  const sign = line[0]
                  let number: number
                  if (sign === '-') number = oldLine++
                  else if (sign === '+') number = newLine++
                  else {
                    number = newLine++
                    oldLine++
                  }
                  return (
                    <div key={j} className={cn('flex pr-4', sign === '+' && 'diff-added', sign === '-' && 'diff-removed')}>
                      <span className="w-11 shrink-0 pr-2 text-right text-label-secondary tabular select-none">{number}</span>
                      <span
                        aria-label={sign === '+' ? 'Added' : sign === '-' ? 'Removed' : undefined}
                        className={cn('w-4 shrink-0 select-none', sign === '+' && 'text-[var(--added-text)]', sign === '-' && 'text-[var(--removed-text)]')}
                      >
                        {sign === '+' || sign === '-' ? sign : ''}
                      </span>
                      <span className="whitespace-pre">{line.slice(1) || ' '}</span>
                    </div>
                  )
                })}
              </Fragment>
            )
          })}
        </div>
      </div>
      {more && whole === undefined && (
        <div className="mt-1 -ml-1.5">
          <ShowAll onClick={() => setAsked(true)} loading={asked}>
            Show the Whole Diff
          </ShowAll>
        </div>
      )}
    </div>
  )
}

/** A long input (an agent's prompt) behind its own disclosure. */
function Disclosed({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="no-drag -ml-1 flex items-center gap-1 rounded-[6px] px-1 py-0.5 text-footnote font-medium text-label-secondary outline-none hover:bg-fill active:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
      >
        <ChevronRight size={11} strokeWidth={2.25} aria-hidden className={cn('transition-transform duration-[var(--duration-tooltip)] ease-out motion-reduce:transition-none', open && 'rotate-90')} />
        {label}
      </button>
      {open && <p className="mt-1 text-footnote whitespace-pre-wrap text-label-secondary select-text">{text}</p>}
    </div>
  )
}

function Todos({ todos }: { todos: { content?: unknown; status?: unknown }[] }) {
  if (!todos.length) return <Caption>The list is empty.</Caption>
  return (
    <ul className="space-y-0.5 text-[0.875rem]">
      {todos.map((t, i) => {
        const status = str(t.status)
        const Mark = status === 'completed' ? CircleCheck : status === 'in_progress' ? CircleDot : Circle
        return (
          <li key={i} className="flex items-start gap-2">
            <Mark size={14} strokeWidth={1.75} aria-label={status.replace('_', ' ') || 'pending'} className="mt-[3px] shrink-0 text-label-secondary" />
            <span className={cn('select-text', status === 'completed' && 'text-label-secondary line-through')}>{str(t.content)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function Questions({ sessionId, input, result }: { sessionId: string; input: Record<string, unknown>; result: ToolResult | undefined }) {
  const questions = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : []
  const answers = result?.info.answers ?? {}
  return (
    <div className="space-y-3 text-[0.875rem]">
      {questions.map((q, i) => {
        const question = str(q.question)
        const answer = answers[question]
        const options = Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : []
        return (
          <div key={i}>
            <p className="font-medium select-text">{question}</p>
            <ul className="mt-1 space-y-0.5">
              {options.map((o, j) => {
                const label = str(o.label)
                const chosen = !!answer && answer.split(', ').includes(label)
                return (
                  <li key={j} className="flex items-start gap-2">
                    {chosen ? (
                      <CircleCheck size={14} strokeWidth={2} aria-label="Chosen" className="mt-[3px] shrink-0 text-accent-text" />
                    ) : (
                      <Circle size={14} strokeWidth={1.75} aria-hidden className="mt-[3px] shrink-0 text-label-secondary" />
                    )}
                    <span className={cn('select-text', chosen ? 'font-medium' : 'text-label-secondary')}>
                      {label}
                      {str(o.description) && <span className="text-label-secondary"> — {str(o.description)}</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
            {answer && !options.some((o) => answer.split(', ').includes(str(o.label))) && <Caption>Answered: {answer}</Caption>}
          </div>
        )
      })}
      {!questions.length && result && <Parts sessionId={sessionId} parts={result.parts} />}
    </div>
  )
}

/** A call's input as a list: short values inline, long or multi-line ones in a card. */
function InputList({ sessionId, call }: { sessionId: string; call: ToolEntry }) {
  const rows = Object.entries(call.input).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!rows.length) return null
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 text-footnote">
      {rows.map(([key, value]) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
        const long = text.length > 80 || text.includes('\n')
        return (
          <Fragment key={key}>
            <dt className="pt-0.5 text-label-secondary">{key}</dt>
            <dd className="min-w-0">
              {long ? (
                <TextCard sessionId={sessionId} part={{ type: 'text', text, more: typeof value === 'string' ? call.cut?.[key] : undefined }} />
              ) : (
                <span className="font-mono text-[0.8125rem] break-words text-label select-text">{text}</span>
              )}
            </dd>
          </Fragment>
        )
      })}
    </dl>
  )
}

/** "2m 13s", "45s", "1h 4m". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${Math.max(1, s)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}
