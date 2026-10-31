// What a turn leaves in the conversation through Gloom's tools (and the
// Claude app's, whose sessions open here too), drawn from the tool calls the
// transcript holds:
// - the task list pinned under the latest message (update_plan),
// - the next-step box at a turn's end (wrap_up): the recap, and a question
//   whose buttons answer it,
// - chapter dividers and a table of contents (mark_chapter),
// - inline widgets in a sandboxed frame (show_widget),
// - sessions Claude proposed, with Start (start_session, own initiative).
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Bookmark, Check, ChevronDown, CircleDashed, ListTree, LoaderCircle, Play, SplitSquareHorizontal, X } from 'lucide-react'
import { create } from 'zustand'
import { chapterOf, CHAPTER_TOOLS, planOf, PLAN_TOOLS, widgetOf, WIDGET_TOOLS, WRAP_TOOLS, wrapUpOf, type PlanStep, type WrapUp } from '@shared/plan'
import type { ToolEntry, ToolResult, TranscriptEntry } from '@shared/transcript'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { notify } from '../../lib/toast'
import { isBusy, useLive } from '../../stores/live'
import { useUi } from '../../stores/ui'
import { useConcept } from '../concept/parts'
import { useBlob } from './media'

// ─── What the transcript says ───────────────────────────────────────────────

export interface Chapter {
  key: string
  title: string
  summary: string | null
}

interface Furniture {
  id: string | null
  plan: PlanStep[]
  /** The next-step box of the latest turn: a wrap_up after your last message. */
  wrap: WrapUp | null
  wrapKey: string | null
  chapters: Chapter[]
}

/** Kept by the transcript as it reads; the composer and the table of contents read it. */
export const useFurniture = create<Furniture>(() => ({ id: null, plan: [], wrap: null, wrapKey: null, chapters: [] }))

/** The list, the latest box and the chapters, from a conversation's entries. */
export function furnitureOf(entries: readonly TranscriptEntry[]): Omit<Furniture, 'id'> {
  const tools = entries.filter((e): e is ToolEntry => e.kind === 'tool')
  const plan = planOf(tools)
  const lastPrompt = entries.findLastIndex((e) => e.kind === 'prompt')
  let wrap: WrapUp | null = null
  let wrapKey: string | null = null
  for (let i = entries.length - 1; i > lastPrompt; i--) {
    const e = entries[i]
    if (e.kind === 'tool' && WRAP_TOOLS.has(e.name)) {
      wrap = wrapUpOf(e.input)
      wrapKey = e.key
      break
    }
  }
  const chapters = tools.flatMap((t): Chapter[] => {
    if (!CHAPTER_TOOLS.has(t.name)) return []
    const c = chapterOf(t.input)
    return c ? [{ key: t.key, ...c }] : []
  })
  return { plan, wrap, wrapKey, chapters }
}

/** Tool calls that are furniture: drawn as their own rows (or under the latest message), not as tool steps. */
export function isFurniture(name: string): boolean {
  return PLAN_TOOLS.has(name) || WRAP_TOOLS.has(name) || CHAPTER_TOOLS.has(name) || WIDGET_TOOLS.has(name)
}

// ─── Under the latest message ───────────────────────────────────────────────

/** The task list and the next-step box, above the composer: the conversation's foot. */
export function TurnFurniture({ sessionId }: { sessionId: string }) {
  const furniture = useFurniture()
  const summary = useLive((s) => s.sessions[sessionId])
  if (furniture.id !== sessionId) return null
  const busy = isBusy(summary)
  return (
    <>
      {furniture.plan.length > 0 && <PlanList steps={furniture.plan} working={busy} />}
      {!busy && furniture.wrap && furniture.wrapKey && <NextStep key={furniture.wrapKey} sessionId={sessionId} wrap={furniture.wrap} />}
    </>
  )
}

/**
 * The task list Claude keeps (update_plan), pinned under its latest message:
 * folded to the step under way, open to show them all. Done steps are struck
 * through; the one under way says so in words and a spinning ring.
 */
function PlanList({ steps, working }: { steps: PlanStep[]; working: boolean }) {
  const concept = useConcept()
  const [open, setOpen] = useState(true)
  const done = steps.filter((s) => s.status === 'completed').length
  const current = steps.find((s) => s.status === 'in_progress')
  const finished = done === steps.length
  return (
    <section aria-label="Task list" className={cn('flex flex-col text-[13px] text-label', concept ? 'concept-composer rounded-[14px] px-3 py-2' : 'glass-strong rounded-[14px] px-3.5 py-2')}>
      <div className="relative z-[2]">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="no-drag flex w-full items-center gap-2 rounded-[6px] text-left outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]">
          <ListTree size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
          <span className="min-w-0 flex-1 truncate">
            {open || !current ? (
              <span className="font-medium">{finished ? 'Every step is done' : 'Tasks'}</span>
            ) : (
              <>
                <span className="text-label-secondary">Now: </span>
                {current.content}
              </>
            )}
          </span>
          <span className="shrink-0 text-[12px] text-label-secondary tabular">
            {done} of {steps.length}
          </span>
          <ChevronDown size={12} strokeWidth={2.25} aria-hidden className={cn('shrink-0 text-label-secondary transition-transform duration-[var(--duration-tooltip)] motion-reduce:transition-none', !open && '-rotate-90')} />
        </button>
        {open && (
          <ol className="mt-1.5 flex flex-col gap-0.5 pb-0.5">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 py-px">
                <StepMark status={step.status} working={working} />
                <span className={cn('min-w-0 leading-snug', step.status === 'completed' && 'text-label-secondary line-through', step.status === 'in_progress' && 'font-medium')}>{step.content}</span>
                <span className="sr-only">{step.status === 'completed' ? ', done' : step.status === 'in_progress' ? ', under way' : ', to do'}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

function StepMark({ status, working }: { status: PlanStep['status']; working: boolean }) {
  if (status === 'completed')
    return (
      <span aria-hidden className="mt-[2px] flex size-[14px] shrink-0 items-center justify-center rounded-full bg-accent text-[var(--on-accent)]">
        <Check size={9} strokeWidth={3.5} />
      </span>
    )
  if (status === 'in_progress')
    return working ? (
      <LoaderCircle size={14} strokeWidth={2} aria-hidden className="mt-[2px] shrink-0 animate-spin text-accent-text motion-reduce:animate-none" />
    ) : (
      <CircleDashed size={14} strokeWidth={2} aria-hidden className="mt-[2px] shrink-0 text-accent-text" />
    )
  return <span aria-hidden className="mt-[2px] size-[14px] shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--label-tertiary)]" />
}

/**
 * The next-step box (wrap_up): what's now true and where it stands, then the
 * one decision Claude leaves you, with its answers as buttons (the first is
 * Claude's pick). A button's words go to Claude as your message.
 */
function NextStep({ sessionId, wrap }: { sessionId: string; wrap: WrapUp }) {
  const concept = useConcept()
  const reduce = useReducedMotion()
  const [sent, setSent] = useState(false)
  const answer = async (label: string) => {
    setSent(true)
    if (!(await useLive.getState().sendText(sessionId, label))) setSent(false)
  }
  return (
    <motion.section
      aria-label="Next step"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
      className={cn('text-[13px] text-label', concept ? 'concept-composer rounded-[14px] px-3.5 py-3' : 'glass-strong rounded-[14px] px-3.5 py-3')}
    >
      <div className="relative z-[2] flex flex-col gap-2">
        <p className="leading-snug text-label-secondary">{wrap.recap}</p>
        {wrap.ask && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 font-medium leading-snug">{wrap.ask}</p>
            <div className="flex shrink-0 gap-1.5">
              {wrap.actions.map((a, i) => (
                <Button key={a.label} size="text" tone={i === 0 ? 'primary' : 'secondary'} disabled={sent} onClick={() => void answer(a.label)}>
                  {a.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.section>
  )
}

// ─── In the conversation ────────────────────────────────────────────────────

/** A tool call that's furniture, drawn in its place in the conversation (or nothing: the list and box live at the foot). */
export function FurnitureRow({ sessionId, call, result }: { sessionId: string; call: ToolEntry; result: ToolResult | undefined }) {
  if (CHAPTER_TOOLS.has(call.name)) return <ChapterDivider call={call} />
  if (WIDGET_TOOLS.has(call.name)) return <WidgetCard sessionId={sessionId} call={call} />
  if (WRAP_TOOLS.has(call.name)) return <WrapRecap sessionId={sessionId} call={call} />
  void result
  return null
}

/** An earlier turn's next-step box, read as its recap, quietly; the latest one is the box at the foot. */
function WrapRecap({ sessionId, call }: { sessionId: string; call: ToolEntry }) {
  const inTheBox = useFurniture((s) => s.id === sessionId && s.wrapKey === call.key)
  const busy = useLive((s) => isBusy(s.sessions[sessionId]))
  const wrap = wrapUpOf(call.input)
  if (!wrap || (inTheBox && !busy)) return null
  return <p className="border-l-2 border-separator-strong py-0.5 pl-3 text-[0.8125rem] leading-snug text-label-secondary">{wrap.recap}</p>
}

/** A chapter's divider: its title between two rules, where the work turned to it. */
function ChapterDivider({ call }: { call: ToolEntry }) {
  const chapter = chapterOf(call.input)
  if (!chapter) return null
  return (
    <div id={`chapter-${call.key}`} role="separator" aria-label={`Chapter: ${chapter.title}`} className="flex items-center gap-3 py-1" title={chapter.summary ?? undefined}>
      <span aria-hidden className="h-px flex-1 bg-separator-strong" />
      <span className="flex items-center gap-1.5 text-[0.75rem] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">
        <Bookmark size={11} strokeWidth={2} aria-hidden />
        {chapter.title}
      </span>
      <span aria-hidden className="h-px flex-1 bg-separator-strong" />
    </div>
  )
}

/**
 * The table of contents, at the conversation's top corner once it has
 * chapters: a click scrolls to one (through the transcript's own list, which
 * draws only the rows near the screen).
 */
export function Contents({ onGo }: { onGo(key: string): void }) {
  const chapters = useFurniture((s) => s.chapters)
  const [open, setOpen] = useState(false)
  const reduce = useReducedMotion()
  if (chapters.length < 2) return null
  return (
    <div className="pointer-events-auto absolute top-2 right-3 z-[5]">
      <Tooltip label={open ? 'Hide Contents' : 'Contents'}>
        <Button shape="round" aria-label="Contents" aria-expanded={open} onClick={() => setOpen(!open)} className="glass-strong">
          <ListTree size={15} strokeWidth={1.75} />
        </Button>
      </Tooltip>
      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Chapters"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: -4 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.2 }}
            style={{ transformOrigin: 'top right' }}
            className="glass-strong absolute top-9 right-0 w-64 rounded-[12px] p-1.5"
          >
            <ol className="relative z-[2] flex flex-col">
              {chapters.map((c, i) => (
                <li key={c.key}>
                  <button
                    type="button"
                    title={c.summary ?? undefined}
                    onClick={() => {
                      setOpen(false)
                      onGo(c.key)
                    }}
                    className="no-drag flex w-full items-baseline gap-2 rounded-[7px] px-2 py-1.5 text-left text-[13px] text-label outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
                  >
                    <span className="w-4 shrink-0 text-right text-[11px] text-label-secondary tabular">{i + 1}</span>
                    <span className="min-w-0 truncate">{c.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Gloom's accent and appearance, for a widget's colours. */
function widgetTheme(): { dark: boolean; accent: string } {
  const css = getComputedStyle(document.documentElement)
  const probe = document.createElement('span')
  probe.style.color = css.getPropertyValue('--accent').trim() || '#8860ea'
  document.body.appendChild(probe)
  const rgb = getComputedStyle(probe).color.match(/\d+/g)?.map(Number) ?? [136, 96, 234]
  probe.remove()
  const hex = `#${rgb
    .slice(0, 3)
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`
  return { dark: matchMedia('(prefers-color-scheme: dark)').matches, accent: hex }
}

/**
 * An inline widget (show_widget): Claude's SVG or HTML in a sandboxed frame
 * from Gloom's widget scheme, as tall as it draws itself. Its sendPrompt()
 * puts the text in the composer for you to send.
 */
function WidgetCard({ sessionId, call }: { sessionId: string; call: ToolEntry }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const whole = useBlob(sessionId, call.cut?.widget_code)
  const widget = useMemo(() => widgetOf(typeof whole === 'string' ? { ...call.input, widget_code: whole } : call.cut?.widget_code ? null : call.input), [call, whole])
  const [url, setUrl] = useState<string | null>(null)
  const [height, setHeight] = useState(160)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    if (!widget) return
    let alive = true
    window.gloom
      ?.widget(`${sessionId}:${call.key}`, widget.code, widget.title, widgetTheme())
      .then((u) => alive && setUrl(u))
      .catch((error: unknown) => alive && setFailed(String((error as Error)?.message ?? error)))
    return () => {
      alive = false
    }
  }, [widget, sessionId, call.key])
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return
      const data = event.data as { gloomWidget?: unknown; height?: unknown; text?: unknown }
      if (data.gloomWidget === 'size' && typeof data.height === 'number') setHeight(Math.max(40, Math.min(1200, data.height)))
      if (data.gloomWidget === 'prompt' && typeof data.text === 'string' && data.text.trim()) {
        const live = useLive.getState()
        live.setDraft(sessionId, { ...live.draft(sessionId), text: data.text })
        notify('The widget put its words in the message box: send them when you’re ready')
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-composer]')?.focus())
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sessionId])
  if (failed) return <p className="text-[0.8125rem] text-label-secondary">The widget couldn’t be shown. {failed}</p>
  if (!widget) return <p className="text-[0.8125rem] text-label-secondary">Loading the widget…</p>
  return (
    <figure className="overflow-hidden rounded-[12px] shadow-[inset_0_0_0_0.5px_var(--separator-strong)]">
      {url ? (
        <iframe ref={frame} src={url} title={widget.title} sandbox="allow-scripts" referrerPolicy="no-referrer" className="block w-full border-0 bg-transparent" style={{ height }} />
      ) : (
        <div className="flex h-24 items-center justify-center">
          <LoaderCircle size={16} strokeWidth={2} aria-label="Loading the widget" className="animate-spin text-label-secondary motion-reduce:animate-none" />
        </div>
      )}
    </figure>
  )
}

// ─── Sessions Claude proposed ───────────────────────────────────────────────

/** A proposal's task ID, from start_session's answer ("task_id=<id>"). */
export function proposalId(result: ToolResult | undefined): string | null {
  const text = (result?.parts ?? []).map((p) => (p.type === 'text' ? p.text : '')).join('\n')
  return /task_id=([0-9a-f-]{36})/.exec(text)?.[1] ?? null
}

/**
 * A session Claude proposed on its own initiative: its title and brief, with
 * Start (it runs beside this one, linked) and Dismiss. A card whose proposal
 * was started or withdrawn says so.
 */
export function ProposalCard({ sessionId, call, result }: { sessionId: string; call: ToolEntry; result: ToolResult | undefined }) {
  const taskId = proposalId(result)
  const [state, setState] = useState<'unknown' | 'waiting' | 'gone' | 'starting'>('unknown')
  useEffect(() => {
    if (!taskId) return
    let alive = true
    void window.gloom?.side.pending(taskId).then((waiting) => alive && setState(waiting ? 'waiting' : 'gone'))
    return () => {
      alive = false
    }
  }, [taskId])
  const title = typeof call.input.title === 'string' ? call.input.title : 'A session of its own'
  const brief = typeof call.input.prompt === 'string' ? call.input.prompt : ''
  const start = async () => {
    if (!taskId) return
    setState('starting')
    try {
      const id = await window.gloom!.side.start(taskId)
      setState('gone')
      notify(`Started “${title}”`, { action: { label: 'Show', onClick: () => useUi.getState().select([id]) } })
    } catch (error) {
      setState('waiting')
      notify(String((error as Error)?.message ?? error).replace(/^.*?Error: /, ''))
    }
  }
  return (
    <section aria-label={`Proposed session: ${title}`} className="rounded-[12px] bg-fill px-3.5 py-2.5 text-[13px] text-label">
      <div className="flex items-start gap-2.5">
        <SplitSquareHorizontal size={15} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-accent-text" />
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug">{title}</p>
          {brief && <p className="mt-0.5 line-clamp-3 text-[12.5px] leading-snug text-label-secondary">{brief}</p>}
        </div>
        {state === 'waiting' || state === 'starting' ? (
          <div className="flex shrink-0 gap-1.5">
            <Tooltip label="Dismiss">
              <Button size="small" aria-label="Dismiss the proposal" disabled={state === 'starting'} onClick={() => taskId && void window.gloom?.side.dismiss(sessionId, taskId).then(() => setState('gone'))}>
                <X size={12} strokeWidth={2} aria-hidden />
              </Button>
            </Tooltip>
            <Button size="text" tone="primary" disabled={state === 'starting'} onClick={() => void start()}>
              <Play size={12} strokeWidth={2} aria-hidden fill="currentColor" /> Start
            </Button>
          </div>
        ) : (
          state === 'gone' && <span className="shrink-0 text-[12px] text-label-secondary">Started or withdrawn</span>
        )}
      </div>
    </section>
  )
}
