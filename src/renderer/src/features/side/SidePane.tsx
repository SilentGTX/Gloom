// The side pane, on the trailing side, as the Claude app's panes beside a
// session: a file at a line, Claude's plan, the session's background tasks,
// a real browser (with the project's dev servers), and the artifacts the
// session made. The diff pane (and the concept's inspector) step aside for it,
// and come back when it goes.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { AppWindow, ArrowLeft, ArrowRight, Bot, GitMerge, GitPullRequest, ClipboardList, Copy, ExternalLink, FileCode2, FolderOpen, Globe, Layers, ListChecks, LoaderCircle, Play, RotateCw, Server, Square, SquareTerminal, X } from 'lucide-react'
import type { BrowserState, FileRead, PreviewList } from '@shared/ipc'
import type { SessionMeta } from '@shared/library'
import type { BackgroundTask } from '@shared/live'
import type { ToolEntry } from '@shared/transcript'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { GlassCapsule } from '../../components/ui/Glass'
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { Segmented } from '../../components/ui/Segmented'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { notify } from '../../lib/toast'
import { useLibrary } from '../../stores/library'
import { useLive } from '../../stores/live'
import { useTranscript } from '../../stores/transcript'
import { useUi, type SideTab } from '../../stores/ui'
import { useHighlight } from '../chat/highlight'
import { Markdown } from '../chat/Markdown'
import { useFurniture } from '../chat/Furniture'
import { languageOf } from '../diff/DiffPane'
import { PaneToolbar } from '../shell/Toolbar'

const TABS: { value: SideTab; label: string; title: string }[] = [
  { value: 'file', label: 'File', title: 'A file of the session, at a line' },
  { value: 'plan', label: 'Plan', title: 'Claude’s latest plan' },
  { value: 'tasks', label: 'Tasks', title: 'The task list and background work' },
  { value: 'browser', label: 'Browser', title: 'A browser beside the chat, and the project’s dev servers' },
  { value: 'artifacts', label: 'Artifacts', title: 'Pages the session published on claude.ai' },
  { value: 'pr', label: 'PR', title: 'The session’s pull request: checks, reviews, merge' }
]

export function SidePane({ session, clearCaptionButtons }: { session: SessionMeta | undefined; clearCaptionButtons: boolean }) {
  const tab = useUi((s) => s.side) ?? 'file'
  const id = session?.id ?? null
  // In a window of its own, Close closes the window.
  const inWindow = new URLSearchParams(location.search).has('popout')
  return (
    <aside aria-label="Pane" data-pane="side" className="relative flex h-full min-w-0 flex-col pt-[var(--titlebar-h)]">
      <PaneToolbar clearCaptionButtons={clearCaptionButtons}>
        <Segmented label="Pane" value={tab} segments={TABS} onChange={(next, viaKeyboard) => useUi.getState().openSide(next, viaKeyboard)} panel="side-panel" />
        <div className="flex-1" />
        <GlassCapsule label="Pane">
          {id && !inWindow && (
            <Tooltip label="Open in Window">
              <Button
                aria-label="Open in window"
                shape="round"
                onClick={() => {
                  void window.gloom?.popOut(tab, id)
                  useUi.getState().closeSide()
                }}
              >
                <AppWindow size={15} strokeWidth={1.75} aria-hidden />
              </Button>
            </Tooltip>
          )}
          <Tooltip label="Close Pane">
            <Button aria-label="Close pane" shape="round" onClick={() => (inWindow ? window.close() : useUi.getState().closeSide())}>
              <X size={15} strokeWidth={1.75} aria-hidden />
            </Button>
          </Tooltip>
        </GlassCapsule>
      </PaneToolbar>
      <div id="side-panel" role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label} className="flex min-h-0 flex-1 flex-col">
        {!id ? (
          <EmptyState icon={<Layers size={40} strokeWidth={1.25} />} title="No Session Selected">
            Open a session to see its files, plan, tasks and browser here.
          </EmptyState>
        ) : tab === 'file' ? (
          <FileView sessionId={id} />
        ) : tab === 'plan' ? (
          <PlanView sessionId={id} />
        ) : tab === 'tasks' ? (
          <TasksView sessionId={id} />
        ) : tab === 'browser' ? (
          <BrowserView sessionId={id} />
        ) : tab === 'pr' ? (
          <PrView sessionId={id} />
        ) : (
          <ArtifactsView sessionId={id} />
        )}
      </div>
    </aside>
  )
}

// ─── File ────────────────────────────────────────────────────────────────────

/** A file of the session's, highlighted, at the line it was opened at (the line is marked). */
function FileView({ sessionId }: { sessionId: string }) {
  const file = useUi((s) => s.sideFile)
  const [read, setRead] = useState<FileRead | null>(null)
  const list = useRef<VirtuosoHandle>(null)
  useEffect(() => {
    if (!file) return
    let alive = true
    setRead(null)
    void window.gloom?.readFile(sessionId, file.path).then((r) => alive && setRead(r))
    return () => {
      alive = false
    }
  }, [sessionId, file])
  const text = read?.ok ? read.text : ''
  const lines = useMemo(() => text.replace(/\r\n/g, '\n').split('\n'), [text])
  const tokens = useHighlight(read?.ok ? text : '', file ? languageOf(file.path) : undefined)
  useLayoutEffect(() => {
    if (read?.ok && file?.line) requestAnimationFrame(() => list.current?.scrollToIndex({ index: Math.max(0, file.line! - 1), align: 'center' }))
  }, [read, file])
  if (!file)
    return (
      <EmptyState icon={<FileCode2 size={40} strokeWidth={1.25} />} title="No File Open">
        Open one from a step Claude took (Read, Edit, Write), or from the changes.
      </EmptyState>
    )
  if (!read)
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle size={18} strokeWidth={1.75} aria-label="Reading the file" className="animate-spin text-label-secondary motion-reduce:animate-none" />
      </div>
    )
  const name = file.path.split(/[\\/]/).pop() ?? file.path
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-3 pt-1 pb-2">
        <FileCode2 size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-label" title={read.path}>
          {name}
          {file.line ? <span className="text-label-secondary">:{file.line}</span> : null}
        </span>
        <Tooltip label="Show in File Explorer">
          <Button size="small" aria-label="Show in File Explorer" onClick={() => void window.gloom?.diff.reveal(read.path)}>
            <FolderOpen size={13} strokeWidth={1.75} aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip label="Copy Path">
          <Button
            size="small"
            aria-label="Copy path"
            onClick={() => {
              void navigator.clipboard.writeText(read.path)
              notify('Copied the path')
            }}
          >
            <Copy size={13} strokeWidth={1.75} aria-hidden />
          </Button>
        </Tooltip>
      </div>
      {!read.ok ? (
        <p className="px-4 text-[13px] text-label-secondary">{read.reason}</p>
      ) : (
        <>
          {read.truncated && <p className="px-4 pb-1 text-[11.5px] text-label-secondary">Only the first 2 MB of this {(read.size / (1024 * 1024)).toFixed(1)} MB file show here.</p>}
          <Virtuoso
            ref={list}
            className="code-text min-h-0 flex-1"
            data={lines}
            computeItemKey={(i) => i}
            itemContent={(i, line) => (
              <div className={cn('flex px-3 font-mono text-[12px] leading-[1.6]', file.line === i + 1 && 'bg-[var(--accent-fill)]')}>
                <span aria-hidden className="w-12 shrink-0 pr-3 text-right text-label-tertiary tabular select-none">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                  {tokens?.[i]
                    ? tokens[i].map(([content, color, style], j) => (
                        <span key={j} style={{ color: color || undefined, fontStyle: style & 1 ? 'italic' : undefined, fontWeight: style & 2 ? 600 : undefined }}>
                          {content}
                        </span>
                      ))
                    : line || ' '}
                </span>
              </div>
            )}
          />
        </>
      )}
    </div>
  )
}

/** Opens a file in the side pane's File tab, at a line. */
export function openFile(path: string, line?: number | null): void {
  useUi.getState().openFile(path, line ?? null)
}

// ─── Plan ────────────────────────────────────────────────────────────────────

/** Claude's latest plan (ExitPlanMode): the one waiting for you, else the last it presented. */
function PlanView({ sessionId }: { sessionId: string }) {
  const waiting = useLive((s) => s.sessions[sessionId]?.cards.find((c) => c.kind === 'plan'))
  const entries = useTranscript((s) => (s.id === sessionId ? s.entries : null))
  const provisional = useLive((s) => s.provisional[sessionId]?.entries)
  const plan = useMemo(() => {
    if (waiting?.kind === 'plan') return waiting.plan
    const all = [...(entries ?? []), ...(provisional ?? [])]
    const last = all.findLast((e): e is ToolEntry => e.kind === 'tool' && e.name === 'ExitPlanMode' && typeof e.input.plan === 'string')
    return last ? (last.input.plan as string) : null
  }, [waiting, entries, provisional])
  if (!plan)
    return (
      <EmptyState icon={<ClipboardList size={40} strokeWidth={1.25} />} title="No Plan Yet">
        In Plan mode, Claude’s plan shows here for you to read beside the conversation.
      </EmptyState>
    )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      {waiting && <p className="mb-3 rounded-[10px] bg-[var(--accent-fill)] px-3 py-2 text-[12.5px] text-label">Waiting for you: approve it or keep planning in the conversation.</p>}
      <Markdown text={plan} className="text-[0.875rem]" />
    </div>
  )
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

const TASK_ICONS: Record<string, typeof Bot> = { local_bash: SquareTerminal, local_agent: Bot, monitor: Server }

function taskTime(t: BackgroundTask, now: number): string {
  const ms = (t.ended ?? now) - t.started
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

/** Stable empties, so a store read that finds nothing doesn't draw again forever. */
const NO_TASKS: BackgroundTask[] = []
const NO_STEPS: { content: string; status: 'pending' | 'in_progress' | 'completed' }[] = []

/** The task list Claude keeps, then the session's background shells, subagents and monitors, with Stop. */
function TasksView({ sessionId }: { sessionId: string }) {
  const tasks = useLive((s) => s.sessions[sessionId]?.tasks ?? NO_TASKS)
  const plan = useFurniture((s) => s[sessionId]?.plan ?? NO_STEPS)
  const [now, setNow] = useState(Date.now())
  const running = tasks.some((t) => t.status === 'running')
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  if (!tasks.length && !plan.length)
    return (
      <EmptyState icon={<ListChecks size={40} strokeWidth={1.25} />} title="Nothing in the Background">
        Shells, subagents and monitors Claude runs in the background show here, with Stop.
      </EmptyState>
    )
  const stop = async (taskId: string) => {
    try {
      await window.gloom?.live.stopTask(sessionId, taskId)
    } catch (error) {
      notify(String((error as Error)?.message ?? error).replace(/^.*?Error: /, ''))
    }
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      {plan.length > 0 && (
        <>
          <h3 className="px-1 pb-1 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">Task list</h3>
          <ol className="mb-3 flex flex-col">
            {plan.map((s, i) => (
              <li key={i} className={cn('px-1 py-0.5 text-[13px]', s.status === 'completed' && 'text-label-secondary line-through', s.status === 'in_progress' && 'font-medium')}>
                {i + 1}. {s.content}
                <span className="sr-only">{s.status === 'completed' ? ', done' : s.status === 'in_progress' ? ', under way' : ', to do'}</span>
              </li>
            ))}
          </ol>
        </>
      )}
      {tasks.length > 0 && <h3 className="px-1 pb-1 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">In the background</h3>}
      <ul className="flex flex-col gap-1">
        {[...tasks].reverse().map((t) => {
          const Icon = TASK_ICONS[t.type] ?? Layers
          return (
            <li key={t.id} className="rounded-[10px] bg-fill px-3 py-2">
              <div className="flex items-center gap-2">
                <Icon size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-label">{t.description}</span>
                <span className={cn('shrink-0 text-[12px] tabular', t.status === 'failed' ? 'text-[var(--removed-text)]' : 'text-label-secondary')}>
                  {t.status === 'running' ? taskTime(t, now) : t.status === 'completed' ? `Done · ${taskTime(t, now)}` : t.status === 'failed' ? 'Failed' : t.status === 'stopped' ? 'Stopped' : t.status}
                </span>
                {t.status === 'running' && (
                  <Tooltip label="Stop">
                    <Button size="small" aria-label={`Stop ${t.description}`} onClick={() => void stop(t.id)}>
                      <Square size={10} strokeWidth={0} fill="currentColor" aria-hidden />
                    </Button>
                  </Tooltip>
                )}
              </div>
              {(t.summary || t.lastTool || t.error) && (
                <p className="mt-1 text-[12px] leading-snug text-label-secondary">
                  {t.error ?? t.summary ?? `Using ${t.lastTool}`}
                  {t.toolUses ? ` · ${t.toolUses} tool use${t.toolUses === 1 ? '' : 's'}` : ''}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Browser ─────────────────────────────────────────────────────────────────

/** Whether a menu, dialog or sheet is up: the page (a native view, drawn over the window) steps out of its way. */
function useCovered(): boolean {
  const [covered, setCovered] = useState(false)
  useEffect(() => {
    const check = () => setCovered(!!document.querySelector('[role="menu"], [role="dialog"]:not([aria-label="Pane"]), [role="listbox"]'))
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] })
    check()
    return () => observer.disconnect()
  }, [])
  return covered
}

/**
 * A browser beside the chat: the session's page, the address field, back,
 * forward and reload, and the project's dev servers (.claude/launch.json).
 * The page is a real browser view of Gloom's own, laid over this place.
 */
function BrowserView({ sessionId }: { sessionId: string }) {
  const place = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<BrowserState | null>(null)
  const [address, setAddress] = useState('')
  // While you type in the address field, the page's own address doesn't overwrite it.
  const editing = useRef(false)
  const setEditing = (on: boolean) => (editing.current = on)
  const covered = useCovered()
  useEffect(() => {
    let alive = true
    void window.gloom?.browser.state(sessionId).then((s) => {
      if (!alive) return
      setState(s)
      if (!editing.current) setAddress(s.url === 'about:blank' ? '' : s.url)
    })
    const off = window.gloom?.browser.onChanged((s) => {
      if (s.sessionId !== sessionId) return
      setState(s)
      if (!editing.current) setAddress(s.url === 'about:blank' ? '' : s.url)
    })
    return () => {
      alive = false
      off?.()
    }
  }, [sessionId])
  // The page follows its place as the pane resizes or moves; it steps away while something covers it.
  useLayoutEffect(() => {
    const el = place.current
    const api = window.gloom
    if (!el || !api) return
    const show = () => {
      const r = el.getBoundingClientRect()
      if (covered || r.width < 4 || r.height < 4) void api.browser.hide()
      else void api.browser.show(sessionId, { x: r.left, y: r.top, width: r.width, height: r.height })
    }
    show()
    const observer = new ResizeObserver(show)
    observer.observe(el)
    window.addEventListener('resize', show)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', show)
      void api.browser.hide()
    }
  }, [sessionId, covered])
  const go = (e: FormEvent) => {
    e.preventDefault()
    setEditing(false)
    void window.gloom?.browser.navigate(sessionId, address).then(setState)
  }
  const blank = !state?.url || state.url === 'about:blank'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={go} className="flex items-center gap-1 px-3 pt-1 pb-2">
        <Tooltip label="Back">
          <Button size="small" aria-label="Back" disabled={!state?.canGoBack} onClick={() => void window.gloom?.browser.go(sessionId, 'back')}>
            <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip label="Forward">
          <Button size="small" aria-label="Forward" disabled={!state?.canGoForward} onClick={() => void window.gloom?.browser.go(sessionId, 'forward')}>
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip label="Reload">
          <Button size="small" aria-label="Reload" disabled={blank} onClick={() => void window.gloom?.browser.go(sessionId, 'reload')}>
            {state?.loading ? <LoaderCircle size={14} strokeWidth={1.75} aria-hidden className="animate-spin motion-reduce:animate-none" /> : <RotateCw size={14} strokeWidth={1.75} aria-hidden />}
          </Button>
        </Tooltip>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => {
            setEditing(true)
            e.target.select()
          }}
          onBlur={() => setEditing(false)}
          placeholder="Search, or type an address"
          aria-label="Address"
          spellCheck={false}
          className="no-drag h-7 min-w-0 flex-1 rounded-[8px] bg-[var(--field)] px-2.5 text-[12.5px] text-label outline-none shadow-[inset_0_0_0_0.5px_var(--separator-strong)] placeholder:text-label-tertiary focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
        />
        <DevServers sessionId={sessionId} />
        <Tooltip label="Open in Your Browser">
          <Button size="small" aria-label="Open in your browser" disabled={blank} onClick={() => state?.url && window.open(state.url)}>
            <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
          </Button>
        </Tooltip>
      </form>
      <div ref={place} className="relative min-h-0 flex-1 bg-[var(--field)]">
        {blank && (
          <div className="absolute inset-0 flex items-center justify-center">
            <EmptyState icon={<Globe size={40} strokeWidth={1.25} />} title="Nothing Open">
              Type an address, or start a dev server. Claude opens pages here too when it checks its work.
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  )
}

/** The project's dev servers (.claude/launch.json): start one and it opens here; stop the ones running. */
function DevServers({ sessionId }: { sessionId: string }) {
  const [list, setList] = useState<PreviewList | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const refresh = () => void window.gloom?.browser.previews(sessionId).then(setList)
  const start = async (name: string) => {
    setBusy(name)
    try {
      const server = await window.gloom!.browser.startPreview(sessionId, name)
      if (server.status === 'failed') notify(`${name} stopped as it started. Its output is in preview logs.`)
    } catch (error) {
      notify(String((error as Error)?.message ?? error).replace(/^.*?Error: /, ''))
    }
    setBusy(null)
    refresh()
  }
  return (
    <MenuRoot onOpenChange={(open) => open && refresh()}>
      <Tooltip label="Dev Servers">
        <MenuTrigger aria-label="Dev servers" className="no-drag flex size-7 items-center justify-center rounded-[7px] text-label-secondary outline-none hover:bg-fill-strong hover:text-label focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] data-[popup-open]:bg-fill-strong">
          {busy ? <LoaderCircle size={14} strokeWidth={1.75} aria-hidden className="animate-spin motion-reduce:animate-none" /> : <Server size={14} strokeWidth={1.75} aria-hidden />}
        </MenuTrigger>
      </Tooltip>
      <MenuPopup align="end">
        {list?.problem && <MenuItem label={list.problem} disabled />}
        {!list?.configurations.length && !list?.problem && <MenuItem label="No .claude/launch.json in this project" disabled />}
        {list?.configurations.map((c) => {
          const running = list.running.find((r) => r.name === c.name && (r.status === 'running' || r.status === 'starting'))
          return running ? (
            <MenuItem key={c.name} label={`Stop ${c.name}`} detail={running.url ?? undefined} icon={<Square />} onClick={() => void window.gloom?.browser.stopPreview(running.id).then(refresh)} />
          ) : (
            <MenuItem key={c.name} label={`Start ${c.name}`} detail={c.url ?? (c.port ? `localhost:${c.port}` : undefined)} icon={<Play />} onClick={() => void start(c.name)} />
          )
        })}
        <MenuSeparator />
        <MenuItem label="What Is launch.json?" detail='{"configurations": [{"name", "runtimeExecutable", "runtimeArgs", "port"}]}' disabled />
      </MenuPopup>
    </MenuRoot>
  )
}

// ─── Artifacts ───────────────────────────────────────────────────────────────

const ARTIFACT = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/g

/** Pages the session published on claude.ai (artifact links in its replies and tool output), opened in the Browser tab. */
function ArtifactsView({ sessionId }: { sessionId: string }) {
  const entries = useTranscript((s) => (s.id === sessionId ? s.entries : null))
  const results = useTranscript((s) => (s.id === sessionId ? s.results : null))
  const links = useMemo(() => {
    const found = new Set<string>()
    for (const e of entries ?? []) if (e.kind === 'text') for (const m of e.text.matchAll(ARTIFACT)) found.add(m[0])
    for (const r of Object.values(results ?? {})) for (const p of r.parts) if (p.type === 'text') for (const m of p.text.matchAll(ARTIFACT)) found.add(m[0])
    return [...found]
  }, [entries, results])
  if (!links.length)
    return (
      <EmptyState icon={<Layers size={40} strokeWidth={1.25} />} title="No Artifacts">
        Pages Claude publishes on claude.ai from this session show here.
      </EmptyState>
    )
  return (
    <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
      {links.map((url) => (
        <li key={url}>
          <button
            type="button"
            onClick={() => {
              useUi.getState().openSide('browser')
              void window.gloom?.browser.navigate(sessionId, url)
            }}
            className="no-drag flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left text-[13px] text-label outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          >
            <Globe size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
            <span className="min-w-0 truncate font-mono text-[12px]">{url.replace('https://', '')}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ─── Pull request ────────────────────────────────────────────────────────────

const CHECK_TONE: Record<string, string> = { passed: 'text-[var(--added-text)]', failed: 'text-[var(--removed-text)]', pending: 'text-[var(--warning)]' }

/**
 * The session's pull request, as the Claude app's PR pane: found from its
 * branch (or linked by hand), its checks, the review, whether it merges
 * cleanly; Merge and auto-merge; and the monitor: Auto-fix (Gloom wakes the
 * session on failed checks, conflicts and new review comments) and archiving
 * the session once the PR closes.
 */
function PrView({ sessionId }: { sessionId: string }) {
  const known = useLive((s) => s.prs[sessionId])
  const pr = useLibraryEntryPr(sessionId)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const refresh = async (maxAge?: number) => {
    setLoading(true)
    setError(null)
    try {
      const status = await window.gloom!.pr.status(sessionId, maxAge)
      useLive.setState({ prs: { ...useLive.getState().prs, [sessionId]: status } })
    } catch (e) {
      setError(String((e as Error)?.message ?? e).replace(/^.*?Error: /, ''))
    }
    setLoading(false)
  }
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(60_000), 60_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])
  const act = async (what: () => Promise<unknown>, done?: string) => {
    try {
      await what()
      if (done) notify(done)
      await refresh(0)
    } catch (e) {
      notify(String((e as Error)?.message ?? e).replace(/^.*?Error: /, ''))
    }
  }
  if (error) return <p className="px-4 text-[13px] text-label-secondary">{error}</p>
  if (known === undefined)
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle size={18} strokeWidth={1.75} aria-label="Reading the pull request" className="animate-spin text-label-secondary motion-reduce:animate-none" />
      </div>
    )
  if (!known)
    return (
      <div className="flex flex-col gap-3 px-4">
        <EmptyState icon={<GitPullRequest size={40} strokeWidth={1.25} />} title="No Pull Request">
          When Claude opens one for this session’s branch (gh pr create), it shows here. Or link one opened elsewhere:
        </EmptyState>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (link.trim()) void act(() => window.gloom!.pr.bind(sessionId, link.trim()), 'Linked the pull request')
          }}
        >
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
            aria-label="Pull request URL"
            className="no-drag h-8 min-w-0 flex-1 rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 text-[13px] text-label outline-none shadow-[inset_0_0_0_0.5px_var(--separator-strong)] placeholder:text-label-tertiary focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          />
          <Button size="text" tone="secondary" type="submit">
            Link
          </Button>
        </form>
      </div>
    )
  const failed = known.checks.filter((c) => c.state === 'failed').length
  const pending = known.checks.filter((c) => c.state === 'pending').length
  const passed = known.checks.filter((c) => c.state === 'passed').length
  const open = known.state === 'OPEN'
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
      <div className="flex items-start gap-2">
        <GitPullRequest size={16} strokeWidth={1.75} aria-hidden className={cn('mt-0.5 shrink-0', known.state === 'MERGED' ? 'text-accent-text' : open ? 'text-[var(--added-text)]' : 'text-label-secondary')} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug font-semibold text-label">
            {known.title} <span className="font-normal text-label-secondary">#{known.number}</span>
          </p>
          <p className="mt-0.5 text-[12px] text-label-secondary">
            {known.state === 'MERGED' ? 'Merged' : known.state === 'CLOSED' ? 'Closed' : known.draft ? 'Draft' : 'Open'} · {known.head} → {known.base}
            {known.review === 'APPROVED' ? ' · Approved' : known.review === 'CHANGES_REQUESTED' ? ' · Changes requested' : known.review === 'REVIEW_REQUIRED' ? ' · Review required' : ''}
            {open && known.mergeable === 'CONFLICTING' ? ' · Conflicts' : ''}
          </p>
        </div>
        <Tooltip label="Open on GitHub">
          <Button size="small" aria-label="Open on GitHub" onClick={() => window.open(known.url)}>
            <ExternalLink size={13} strokeWidth={1.75} aria-hidden />
          </Button>
        </Tooltip>
        <Tooltip label="Refresh">
          <Button size="small" aria-label="Refresh" onClick={() => void refresh(0)}>
            <RotateCw size={13} strokeWidth={1.75} aria-hidden className={cn(loading && 'animate-spin motion-reduce:animate-none')} />
          </Button>
        </Tooltip>
      </div>

      {known.checks.length > 0 && (
        <section aria-label="Checks" className="mt-4">
          <h3 className="pb-1 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">
            Checks · {failed ? `${failed} failed` : pending ? `${pending} running` : 'all passed'}
            {failed || pending ? ` · ${passed} passed` : ''}
          </h3>
          <ul className="flex flex-col">
            {known.checks.map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex items-center gap-2 py-0.5 text-[13px]">
                <span className={cn('w-14 shrink-0 text-[12px] font-medium', CHECK_TONE[c.state] ?? 'text-label-secondary')}>{c.state}</span>
                <span className="min-w-0 flex-1 truncate text-label">{c.name}</span>
                {c.url && (
                  <button type="button" onClick={() => window.open(c.url!)} className="no-drag shrink-0 rounded-[5px] px-1 text-[12px] text-accent-text outline-none hover:bg-fill focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]">
                    Details
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && (
        <section aria-label="Merge" className="mt-4 flex flex-wrap items-center gap-2">
          <MenuRoot>
            <MenuTrigger className="no-drag inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-3.5 text-[13px] font-semibold text-[var(--on-accent)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]">
              <GitMerge size={14} strokeWidth={2} aria-hidden /> Merge…
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuItem label="Squash and Merge" onClick={() => void act(() => window.gloom!.pr.merge(sessionId, 'squash'), 'Merged')} />
              <MenuItem label="Create a Merge Commit" onClick={() => void act(() => window.gloom!.pr.merge(sessionId, 'merge'), 'Merged')} />
              <MenuItem label="Rebase and Merge" onClick={() => void act(() => window.gloom!.pr.merge(sessionId, 'rebase'), 'Merged')} />
            </MenuPopup>
          </MenuRoot>
          <label className="flex items-center gap-2 text-[13px] text-label">
            <input type="checkbox" checked={known.autoMerge} onChange={(e) => void act(() => window.gloom!.pr.autoMerge(sessionId, e.target.checked, 'squash'))} className="size-4 accent-[var(--accent)]" />
            Auto-merge when checks pass
          </label>
        </section>
      )}

      <section aria-label="Monitor" className="mt-5">
        <h3 className="pb-1 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">Monitor</h3>
        <label className="flex items-start gap-2 py-1 text-[13px] text-label">
          <input type="checkbox" checked={!!pr?.autoFix} disabled={!open} onChange={(e) => void act(() => window.gloom!.pr.monitor(sessionId, { autoFix: e.target.checked }))} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            Auto-fix
            <span className="block text-[12px] text-label-secondary">Wake this session when checks fail, the branch conflicts, or reviewers comment.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 py-1 text-[13px] text-label">
          <input type="checkbox" checked={!!pr?.autoArchive} onChange={(e) => void act(() => window.gloom!.pr.monitor(sessionId, { autoArchive: e.target.checked }))} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            Archive the session when the pull request closes
          </span>
        </label>
      </section>
    </div>
  )
}

/** The session's PR link and monitor switches, as the library keeps them. */
function useLibraryEntryPr(sessionId: string) {
  return useLibrary((s) => s.library.sessions[sessionId]?.pr)
}
