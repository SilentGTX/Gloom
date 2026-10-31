import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, MotionConfig, Reorder, useDragControls, useReducedMotion } from 'motion/react'
import { ChevronRight, Copy, Folder, GitBranch, Globe, Laptop, PanelRight, Plug, SquareChevronRight } from 'lucide-react'
import { totals, type DiffFile, type SessionDiff, type TreeDiff } from '@shared/diff'
import { EFFORT_LABELS, modeInfo, modelLabel, type McpServer, type UsageWindow } from '@shared/live'
import type { SessionMeta } from '@shared/library'
import type { TranscriptEntry } from '@shared/transcript'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { runCommand } from '../../lib/commands'
import { fullDate } from '../../lib/time'
import { notify } from '../../lib/toast'
import { useDiff, type Loaded } from '../../stores/diff'
import { useLive } from '../../stores/live'
import { useTranscript } from '../../stores/transcript'
import { INSPECTOR_PARTS, useUi, type InspectorPart } from '../../stores/ui'
import { useWorktrees } from '../chat/Worktree'
import { FileStatusIcon } from '../diff/DiffPane'
import { copySessionId, resumeSession, revealSession } from '../sessions/SessionMenu'
import { PaneToolbar } from '../shell/Toolbar'

/** A list longer than this shows its first few and a Show More. */
const FIRST = 6

const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000).toLocaleString()}K` : n.toLocaleString())
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** The editor a folder opens in (VS Code, when it's installed), asked once. */
let editorAsked: Promise<string | null> | null = null
function useEditorName(): string | null | undefined {
  const [name, setName] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    editorAsked ??= window.gloom?.editorName().catch(() => null) ?? Promise.resolve(null)
    let alive = true
    void editorAsked.then((n) => alive && setName(n))
    return () => {
      alive = false
    }
  }, [])
  return name
}

/** Every section once, in your order (a section a newer Gloom adds goes at the end). */
function inOrder(stored: readonly InspectorPart[]): InspectorPart[] {
  const known = stored.filter((p, i) => INSPECTOR_PARTS.includes(p) && stored.indexOf(p) === i)
  return [...known, ...INSPECTOR_PARTS.filter((p) => !known.includes(p))]
}

/** The newest to-do list in the session: the stream's first, then the file's. */
function useTodos(id: string): { content: string; status: string }[] | null {
  const entries = useTranscript((s) => (s.id === id ? s.entries : null))
  const provisional = useLive((s) => s.provisional[id]?.entries)
  return useMemo(() => {
    const isTodos = (e: TranscriptEntry) => e.kind === 'tool' && e.name === 'TodoWrite'
    const last = provisional?.findLast(isTodos) ?? entries?.findLast(isTodos)
    if (!last || last.kind !== 'tool' || !Array.isArray(last.input.todos)) return null
    return (last.input.todos as Record<string, unknown>[]).map((t) => ({ content: str(t.content), status: str(t.status) }))
  }, [entries, provisional])
}

/**
 * The concept's inspector, on the trailing side, as Claude Code's panel is:
 * a column of sections, each a card whose header folds it (it then says what
 * matters in a word: a count, a share) and drags it to another place, which
 * Gloom keeps. Alt+Up and Alt+Down move the section whose header has the
 * keyboard. Long lists show their first six, then Show More. It follows the
 * session you choose; Ctrl+I shows and hides it.
 */
export function Inspector({ session, clearCaptionButtons }: { session: SessionMeta | undefined; clearCaptionButtons: boolean }) {
  const stored = useUi((s) => s.inspectorOrder)
  const order = useMemo(() => inOrder(stored), [stored])
  const todos = useTodos(session?.id ?? '')
  // The sections with something to show: Tasks waits for a to-do list.
  const shown = order.filter((p) => p !== 'tasks' || !!todos?.length)
  // Moved from the keyboard just now: the sections jump, as rows do after a key.
  const [keyed, setKeyed] = useState(false)

  /** Puts the shown sections in this order, the hidden ones keeping their places. */
  const reorder = (next: InspectorPart[]) => {
    const queue = [...next]
    useUi.getState().setInspectorOrder(order.map((p) => (shown.includes(p) ? queue.shift()! : p)))
  }
  const move = (part: InspectorPart, by: -1 | 1) => {
    const at = shown.indexOf(part)
    const to = at + by
    if (to < 0 || to >= shown.length) return
    const next = [...shown]
    ;[next[at], next[to]] = [next[to], next[at]]
    setKeyed(true)
    reorder(next)
  }

  return (
    <aside aria-label="Inspector" data-pane="inspector" className="concept-inspector relative flex h-full min-w-0 flex-col pt-[var(--titlebar-h)]">
      <PaneToolbar clearCaptionButtons={clearCaptionButtons}>
        <h2 className="px-1 font-display text-[13px] font-semibold text-label">Inspector</h2>
      </PaneToolbar>
      {session ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4" onPointerDownCapture={() => keyed && setKeyed(false)}>
          <MotionConfig transition={keyed ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.3 }} reducedMotion="user">
            <Reorder.Group as="div" axis="y" values={shown} onReorder={reorder} className="flex flex-col gap-2.5">
              {shown.map((part) => {
                const props = { session, onMove: (by: -1 | 1) => move(part, by) }
                switch (part) {
                  case 'changes':
                    return <ChangesPart key={part} {...props} />
                  case 'tasks':
                    return <TasksPart key={part} {...props} todos={todos ?? []} />
                  case 'context':
                    return <ContextPart key={part} {...props} />
                  case 'environment':
                    return <EnvironmentPart key={part} {...props} />
                  case 'connectors':
                    return <ConnectorsPart key={part} {...props} />
                  case 'session':
                    return <SessionPart key={part} {...props} />
                }
              })}
            </Reorder.Group>
          </MotionConfig>
        </div>
      ) : (
        <p className="px-4 pt-2 text-footnote text-label-secondary">Choose a session to see its changes, its context and its details.</p>
      )}
    </aside>
  )
}

interface PartProps {
  session: SessionMeta
  onMove(by: -1 | 1): void
}

/**
 * One section: a card whose header folds and unfolds it (the triangle points
 * down while it's open) and, dragged, carries it to another place. A drag
 * that ends isn't also a click. What it holds grows into its room and shrinks
 * back out of it; from the keyboard it snaps, under reduced motion it fades.
 */
function Section({ part, title, summary, onMove, children }: { part: InspectorPart; title: string; summary?: ReactNode; onMove(by: -1 | 1): void; children: ReactNode }) {
  const controls = useDragControls()
  const open = useUi((s) => !s.inspectorFolded.includes(part))
  const reduce = useReducedMotion()
  const dragged = useRef(false)
  const [lifted, setLifted] = useState(false)
  const [keyed, setKeyed] = useState(false)
  const body = useId()
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    onMove(e.key === 'ArrowUp' ? -1 : 1)
  }
  const fold = keyed ? { duration: 0 } : reduce ? { duration: 0.15 } : { type: 'spring' as const, bounce: 0, duration: 0.25 }
  return (
    <Reorder.Item
      as="section"
      value={part}
      aria-label={title}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => {
        dragged.current = true
        setLifted(true)
      }}
      onDragEnd={() => {
        setLifted(false)
        requestAnimationFrame(() => (dragged.current = false))
      }}
      whileDrag={{ scale: 1.02, zIndex: 2 }}
      className={cn('concept-panel', lifted && 'is-lifted')}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={body}
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        onPointerDown={(e) => e.button === 0 && controls.start(e)}
        onClick={(e) => {
          if (dragged.current) return
          setKeyed(e.detail === 0)
          useUi.getState().foldInspectorPart(part)
        }}
        onKeyDown={onKey}
        className="concept-panel-head no-drag"
      >
        <span className="font-semibold text-label">{title}</span>
        <ChevronRight size={11} strokeWidth={2.5} aria-hidden className={cn('concept-chevron', open && 'is-open')} />
        <span className="flex-1" />
        {summary}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            id={body}
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0, overflow: 'clip' }}
            transition={fold}
            style={{ overflow: 'clip' }}
          >
            <div className="px-3 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}

/** The first six of a long list, and the button that shows the rest or puts them away. A new session starts short. */
function useFirstFew<T>(items: readonly T[], sessionId: string): { shown: readonly T[]; toggle: ReactNode } {
  const [all, setAll] = useState(false)
  useEffect(() => setAll(false), [sessionId])
  const more = items.length - FIRST
  if (more <= 0) return { shown: items, toggle: null }
  return {
    shown: all ? items : items.slice(0, FIRST),
    toggle: (
      <button type="button" onClick={() => setAll(!all)} className="concept-more no-drag">
        {all ? 'Show Less' : `Show ${more} More`}
      </button>
    )
  }
}

function Note({ children }: { children: ReactNode }) {
  return <p className="py-1 text-[12.5px] text-label-secondary">{children}</p>
}

// ─── Changes ────────────────────────────────────────────────────────────────

/** The files the session changed, with their counts; Review Diff opens them in the Changes view. */
function ChangesPart({ session, onMove }: PartProps) {
  const tab = useUi((s) => s.diffTab)
  const loaded = useDiff((s) => s[tab]) as Loaded<SessionDiff | TreeDiff>
  const current = loaded.id === session.id ? loaded : null
  const files = current?.value && 'files' in current.value ? current.value.files : null
  const { shown, toggle } = useFirstFew(files ?? [], session.id)
  const editor = useEditorName()
  const review = () => useUi.getState().setView('changes')
  const openEditor = async () => {
    const opened = await window.gloom?.openInEditor(session.id).catch(() => false)
    if (opened === false) notify('Its working folder isn’t on this PC any more.')
  }
  const { added, removed } = totals(files ?? [])
  const note = !current || current.status === 'loading' ? 'Reading the changes…' : current.status === 'error' ? current.error : files ? (tab === 'session' ? 'Claude hasn’t edited anything yet.' : 'Nothing has changed.') : treeNote(current.value as TreeDiff | null)
  return (
    <Section
      part="changes"
      title={tab === 'session' ? 'Changes' : 'Working Tree'}
      summary={
        files?.length ? (
          <span className="concept-panel-summary" title={`${plural(added, 'line')} added, ${plural(removed, 'line')} removed`}>
            {plural(files.length, 'file')}
          </span>
        ) : undefined
      }
      onMove={onMove}
    >
      {files?.length ? (
        <ul className="-mx-1.5 flex flex-col">
          {shown.map((file) => (
            <FileRow key={file.path} file={file} onOpen={review} />
          ))}
        </ul>
      ) : (
        <Note>{note}</Note>
      )}
      {toggle}
      <div className="mt-2.5 flex gap-2">
        <Button size="text" tone="secondary" className="flex-1" disabled={!files?.length} onClick={review}>
          Review Diff
        </Button>
        {!session.remote && (
          <Button size="text" tone="secondary" className="flex-1" disabled={editor === undefined} onClick={() => void (editor ? openEditor() : revealSession(session.id))}>
            {editor ? 'Open in Editor' : 'Show in Explorer'}
          </Button>
        )}
      </div>
    </Section>
  )
}

function treeNote(tree: TreeDiff | null): string {
  switch (tree?.kind) {
    case 'not-repo':
      return 'Not a git repository.'
    case 'no-git':
      return 'Git isn’t installed.'
    case 'missing-folder':
      return 'Its working folder is gone.'
    case 'remote':
      return 'It ran on another machine.'
    case 'error':
      return tree.message
    default:
      return 'Nothing has changed.'
  }
}

function FileRow({ file, onOpen }: { file: DiffFile; onOpen(): void }) {
  const name = file.path.slice(file.path.lastIndexOf('/') + 1)
  return (
    <li>
      <button type="button" onClick={onOpen} title={file.path} className="concept-panel-row no-drag">
        <FileStatusIcon status={file.status} />
        <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-label">{name}</span>
        <span className="flex shrink-0 gap-1.5 text-[12px] font-medium tabular">
          {file.added > 0 && <span className="text-[var(--added-text)]">+{file.added}</span>}
          {file.removed > 0 && <span className="text-[var(--removed-text)]">−{file.removed}</span>}
        </span>
      </button>
    </li>
  )
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

/** Claude's newest to-do list: what's done, what's under way, what's left. */
function TasksPart({ session, onMove, todos }: PartProps & { todos: { content: string; status: string }[] }) {
  const done = todos.filter((t) => t.status === 'completed').length
  const { shown, toggle } = useFirstFew(todos, session.id)
  return (
    <Section part="tasks" title="Tasks" summary={<span className="concept-panel-summary">{`${done} of ${todos.length}`}</span>} onMove={onMove}>
      <ul aria-label="To-do list" className="flex flex-col gap-1.5 py-0.5 text-[12.5px]">
        {shown.map((t, i) => (
          <li key={i} className="flex items-start gap-2">
            <span aria-hidden className={cn('concept-check is-small', t.status === 'completed' ? 'is-done' : t.status === 'in_progress' ? 'is-now' : 'is-todo')} />
            <span className="sr-only">{t.status === 'completed' ? 'Done:' : t.status === 'in_progress' ? 'Under way:' : 'To do:'}</span>
            <span className={cn('min-w-0 select-text', t.status === 'completed' ? 'text-label-secondary line-through' : 'text-label')}>{t.content}</span>
          </li>
        ))}
      </ul>
      {toggle}
    </Section>
  )
}

// ─── Context ────────────────────────────────────────────────────────────────

/** How full the context is: folded, its share and a small bar, as Claude Code's panel says it; open, the tokens and your plan's use. */
function ContextPart({ session, onMove }: PartProps) {
  const summary = useLive((s) => s.sessions[session.id])
  const usage = useLive((s) => s.usage)
  const context = summary?.context ?? null
  const percent = context ? Math.round(context.percent) : null
  const busy = summary?.state === 'working' || summary?.state === 'starting'
  return (
    <Section
      part="context"
      title="Context"
      summary={
        percent === null ? (
          <span className="concept-panel-summary">—</span>
        ) : (
          <span className="concept-panel-summary flex items-center gap-2">
            {percent}%
            <span aria-hidden className="concept-minibar">
              <span style={{ width: `${Math.max(4, Math.min(100, percent))}%` }} />
            </span>
          </span>
        )
      }
      onMove={onMove}
    >
      <div className="flex items-center gap-3.5 py-1">
        <span
          className="concept-ring"
          role="meter"
          aria-label="Context used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          style={{ '--ring': `${percent ?? 0}%` } as React.CSSProperties}
        />
        <div className="min-w-0">
          <p className="font-display text-[16px] font-semibold text-label tabular">{percent === null ? '—' : `${percent}%`}</p>
          <p className="text-[12px] text-label-secondary tabular">{context ? `${tokens(context.used)} of ${tokens(context.max)} tokens` : 'Measured after Claude’s next reply'}</p>
        </div>
      </div>
      {(usage?.fiveHour || usage?.weekly) && (
        <div className="mt-2 flex flex-col gap-2">
          {usage.fiveHour && <Meter title="5-hour limit" window={usage.fiveHour} />}
          {usage.weekly && <Meter title="Weekly limit" window={usage.weekly} />}
        </div>
      )}
      {summary && context && (
        <Button size="text" tone="secondary" className="mt-2.5 w-full" disabled={busy} onClick={() => void useLive.getState().sendText(session.id, '/compact')}>
          Compact Now
        </Button>
      )}
    </Section>
  )
}

function Meter({ title, window }: { title: string; window: UsageWindow }) {
  const percent = window.percent === null ? null : Math.round(window.percent)
  const resets = window.resetsAt ? new Date(window.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null
  return (
    <div title={resets ? `Resets ${resets}` : undefined}>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-label">{title}</span>
        <span className="text-label-secondary tabular">{percent === null ? '—' : `${percent}%`}</span>
      </div>
      {percent !== null && (
        <span aria-hidden className="concept-minibar is-wide mt-1">
          <span style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
        </span>
      )}
    </div>
  )
}

// ─── Environment ────────────────────────────────────────────────────────────

/** Where it runs: this computer or another, the folder, the branch; and the way out to a terminal. */
function EnvironmentPart({ session, onMove }: PartProps) {
  const summary = useLive((s) => s.sessions[session.id])
  const worktree = useWorktrees((s) => s.info[session.id])
  const cwd = (summary?.cwd ?? session.cwd ?? session.project).replace(/[\\/]+$/, '')
  const cut = Math.max(cwd.lastIndexOf('\\'), cwd.lastIndexOf('/'))
  const folder = cut >= 0 ? cwd.slice(cut + 1) : cwd
  const parent = cut > 0 ? cwd.slice(0, cut + 1) : ''
  const branch = worktree?.branch ?? (session.gitBranch && session.gitBranch !== 'HEAD' ? session.gitBranch : null)
  return (
    <Section part="environment" title="Environment" onMove={onMove}>
      <ul className="-mx-1.5 flex flex-col">
        <li className="concept-panel-row">
          {session.remote ? <Globe size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" /> : <Laptop size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />}
          <span className="text-label">{session.remote ? 'Another machine' : 'This computer'}</span>
        </li>
        <li>
          <Tooltip label="Show in File Explorer" detail={cwd}>
            <button type="button" disabled={session.remote} onClick={() => void revealSession(session.id)} className="concept-panel-row no-drag">
              <Folder size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
              <span className="min-w-0 truncate text-left text-label">
                {folder}
                {parent && <span className="text-label-secondary"> · {parent}</span>}
              </span>
            </button>
          </Tooltip>
        </li>
        {branch && (
          <li className="concept-panel-row">
            <GitBranch size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
            <span className="min-w-0 truncate font-mono text-[12px] text-label">{branch}</span>
            {worktree && <span className="shrink-0 text-[12px] text-label-secondary">worktree</span>}
          </li>
        )}
        {!session.remote && session.file && (
          <li>
            <button type="button" onClick={() => void resumeSession(session.id)} className="concept-panel-row no-drag">
              <SquareChevronRight size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
              <span className="text-label">Resume in Terminal</span>
            </button>
          </li>
        )}
      </ul>
    </Section>
  )
}

// ─── Connectors ─────────────────────────────────────────────────────────────

const MCP_STATUS: Record<string, { text: string; tone: string } | undefined> = {
  failed: { text: 'Failed', tone: 'text-[var(--removed-text)]' },
  'needs-auth': { text: 'Needs sign-in', tone: 'text-[var(--warning)]' },
  pending: { text: 'Connecting…', tone: 'text-label-secondary' },
  disabled: { text: 'Off', tone: 'text-label-secondary' }
}

/** The session's MCP servers, as its process reported them when it started. */
function ConnectorsPart({ session, onMove }: PartProps) {
  const servers = useLive((s) => s.sessions[session.id]?.mcp ?? null)
  const list: McpServer[] = servers ?? []
  const { shown, toggle } = useFirstFew(list, session.id)
  return (
    <Section part="connectors" title="Connectors" summary={servers?.length ? <span className="concept-panel-summary">{servers.length}</span> : undefined} onMove={onMove}>
      {servers === null ? (
        <Note>Listed once this session runs in Gloom.</Note>
      ) : !servers.length ? (
        <Note>No MCP servers.</Note>
      ) : (
        <ul className="-mx-1.5 flex flex-col">
          {shown.map((s) => {
            const status = MCP_STATUS[s.status]
            return (
              <li key={s.name} className="concept-panel-row">
                <Plug size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
                <span className="min-w-0 flex-1 truncate text-label">{s.name}</span>
                {status ? <span className={cn('shrink-0 text-[12px]', status.tone)}>{status.text}</span> : <span className="sr-only">Connected</span>}
              </li>
            )
          })}
        </ul>
      )}
      {toggle}
    </Section>
  )
}

// ─── Session ────────────────────────────────────────────────────────────────

/** The model, the permission mode, the effort, when it started, and its ID. */
function SessionPart({ session, onMove }: PartProps) {
  const summary = useLive((s) => s.sessions[session.id])
  const settings = useLive((s) => s.settings)
  const models = useLive((s) => s.models)
  const model = modelLabel(summary ? (summary.activeModel ?? summary.model) : settings.model, models)
  const mode = summary?.mode ?? settings.mode
  const effort = summary ? summary.effort : settings.effort
  const facts: [string, ReactNode][] = [
    ['Model', model],
    ['Permissions', modeInfo(mode).label],
    ['Effort', effort ? EFFORT_LABELS[effort] : 'Default'],
    ['Started', fullDate(session.created)],
    [
      'Session ID',
      <span className="flex items-center justify-end gap-1">
        <span className="min-w-0 truncate font-mono text-[11.5px]" title={session.id}>
          {session.id.slice(0, 8)}
        </span>
        <Tooltip label="Copy Session ID">
          <Button size="small" aria-label="Copy session ID" onClick={() => void copySessionId(session.id)}>
            <Copy size={12} strokeWidth={1.75} aria-hidden />
          </Button>
        </Tooltip>
      </span>
    ]
  ]
  return (
    <Section part="session" title="Session" summary={<span className="concept-panel-summary">{model}</span>} onMove={onMove}>
      <dl className="concept-facts py-0.5">
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

/** The toolbar's inspector button: held in while the inspector shows. */
export function InspectorButton({ shown }: { shown: boolean }) {
  return (
    <Tooltip label={shown ? 'Hide Inspector' : 'Show Inspector'} shortcut="Ctrl+I">
      <Button aria-label="Inspector" aria-pressed={shown} pressed={shown} shape="round" onClick={() => runCommand('session.info')}>
        <PanelRight size={16} strokeWidth={1.75} aria-hidden />
      </Button>
    </Tooltip>
  )
}
