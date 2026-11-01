import { forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react'
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowDown, FileWarning, LoaderCircle, MessagesSquare } from 'lucide-react'
import { mergeProvisional } from '@shared/live'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { GlassCapsule } from '../../components/ui/Glass'
import { cn } from '../../lib/cn'
import { composerSpace } from '../../lib/composer-space'
import { useDelayed } from '../../lib/delayed'
import { isBusy, useLive } from '../../stores/live'
import { useColumnTranscript, useColumnTranscriptApi } from '../../stores/transcript'
import { useConcept } from '../concept/parts'
import { clearMatches, findMatches, paintMatches, popMatch, useFind } from './find'
import { FindBar } from './FindBar'
import { PromptCards } from './PromptCards'
import { cutAt, RewindAllowed } from './Rewind'
import { buildRows, countMatches, groupTools, liveRows, rowText, type Row } from './rows'
import { RowView } from './RowView'
import { useTranscriptView } from '../sessions/actions'
import { PLAN_TOOLS } from '@shared/plan'
import { Contents, furnitureOf, useFurniture } from './Furniture'
import { LatestTodos, OpenByDefault } from './ToolRow'

/** Virtuoso counts rows from here, so older pages can be put above without the view jumping. */
const BASE_INDEX = 1_000_000
/** Space under the last row, past the composer floating over the transcript's foot. */
const BOTTOM_SPACE = 32
const bottomSpace = () => BOTTOM_SPACE + composerSpace()

/**
 * A session's transcript, newest at the bottom, where it opens. Scrolling up
 * reads older pages until a compaction, which offers what came before it.
 * While the session runs elsewhere, what it writes appears as it's written.
 */
export function Transcript({ sessionId, live }: { sessionId: string; live: boolean }) {
  const status = useColumnTranscript((s) => s.status)
  const error = useColumnTranscript((s) => s.error)
  const entries = useColumnTranscript((s) => s.entries)
  const results = useColumnTranscript((s) => s.results)
  const epoch = useColumnTranscript((s) => s.epoch)
  // In a session Gloom runs, what the stream has shown joins what the file holds, and the reply streams below.
  const provisional = useLive((s) => s.provisional[sessionId])
  const stream = useLive((s) => s.streams[sessionId] ?? null)
  const summary = useLive((s) => s.sessions[sessionId])
  const running = isBusy(summary)
  const busy = running && summary?.state !== 'waiting'
  const since = busy ? (summary?.turnStarted ?? null) : null
  const activity = summary?.activity ?? null
  // After a rewind the conversation stops before the message rewound to, until the file catches up.
  const rewoundTo = summary?.rewoundTo ?? null
  // The transcript's rows keep their identity while the stream moves; only the live tail is rebuilt.
  const base = useMemo(() => {
    const merged = mergeProvisional(cutAt(entries, rewoundTo), results, provisional)
    return buildRows(merged.entries, merged.results, { live: live || running })
  }, [entries, results, provisional, live, running, rewoundTo])
  const rows = useMemo(() => {
    const tail = liveRows(base.at(-1), busy ? stream : null, since ? { since, activity } : null)
    return tail.length ? [...base, ...tail] : base
  }, [base, busy, stream, since, activity])
  const slow = useDelayed(status === 'loading', 300)
  const latestTodos = useMemo(() => rows.findLast((r) => r.kind === 'tool' && r.entry.name === 'TodoWrite')?.key ?? null, [rows])
  // View › Transcript View, as the Claude app's: Normal leaves Claude's thinking out, Thinking shows it, Verbose opens everything.
  const view = useTranscriptView(sessionId)
  // Normal leaves thinking out; the task list's own calls show only in Verbose (the list itself is pinned at the foot).
  // Outside Verbose, each run of tool calls folds into one line, as the Claude app shows them.
  const shown = useMemo(
    () => (view === 'verbose' ? rows : groupTools(rows.filter((r) => (view === 'normal' ? r.kind !== 'thinking' : true) && !(r.kind === 'tool' && PLAN_TOOLS.has(r.entry.name))))),
    [rows, view]
  )
  // The task list, the latest next-step box and the chapters, for the composer and the contents.
  useEffect(() => {
    const merged = mergeProvisional(cutAt(entries, rewoundTo), results, provisional)
    useFurniture.setState({ [sessionId]: furnitureOf(merged.entries) })
  }, [entries, results, provisional, rewoundTo, sessionId])
  const openByDefault = useMemo(() => ({ thinking: view !== 'normal', tools: view === 'verbose' }), [view])
  // Switching views starts every row from how the new view opens them.
  const transcriptApi = useColumnTranscriptApi()
  useEffect(() => transcriptApi.setState({ expanded: new Set() }), [view, transcriptApi])

  if (status === 'loading' || status === 'idle') {
    return <div className="flex flex-1 items-center justify-center">{slow && <LoaderCircle size={20} strokeWidth={1.75} aria-label="Loading the transcript" className="animate-spin text-label-secondary motion-reduce:animate-none" />}</div>
  }
  if (status === 'error') {
    return (
      <EmptyState icon={<FileWarning size={40} strokeWidth={1.25} />} title="Can’t Show This Session">
        {error}
      </EmptyState>
    )
  }
  if (!rows.length) {
    // A session made here, waiting for its first message.
    if (summary?.state === 'new') {
      const folder = summary.cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || summary.cwd
      return (
        <div className="flex flex-1 flex-col" style={{ paddingBottom: 'var(--composer-space)' }}>
          <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title="New Session">
            Claude works in <span className="font-medium text-label">{folder}</span>. Ask for anything below.
          </EmptyState>
        </div>
      )
    }
    return (
      <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title="Nothing Here Yet">
        This session has no messages yet.
      </EmptyState>
    )
  }
  return (
    <RewindAllowed.Provider value={!live && !running}>
      <LatestTodos.Provider value={latestTodos}>
        <OpenByDefault.Provider value={openByDefault}>
          <TranscriptList key={`${sessionId}:${epoch}`} sessionId={sessionId} rows={shown} />
        </OpenByDefault.Provider>
      </LatestTodos.Provider>
    </RewindAllowed.Provider>
  )
}

/** Keeps each row's position steady as older rows arrive above it (Virtuoso's firstItemIndex). */
function useFirstItemIndex(rows: Row[]): number {
  const anchor = useRef<{ key: string; index: number } | null>(null)
  return useMemo(() => {
    const before = anchor.current
    let first = BASE_INDEX
    if (before) {
      const at = rows.findIndex((r) => r.key === before.key)
      if (at >= 0) first = before.index - at
    }
    // Anchor on a row that stays put: a time label can come and go as older rows arrive.
    const i = Math.max(0, rows.findIndex((r) => r.kind !== 'time' && r.kind !== 'turn'))
    anchor.current = rows[i] ? { key: rows[i].key, index: first + i } : null
    return first
  }, [rows])
}

interface ListContext {
  loadingOlder: boolean
  sessionId: string
  /** The concept: Claude's requests wait at the end of the conversation, not over the composer. */
  inline: boolean
}

/** The card Claude waits on, at the end of the conversation (the concept), in the rows' column. */
function InlineCards({ sessionId }: { sessionId: string }) {
  const summary = useLive((s) => s.sessions[sessionId])
  if (!summary) return null
  return (
    <div className="mx-auto w-full max-w-[720px] px-8 pt-4">
      <PromptCards sessionId={sessionId} summary={summary} inline />
    </div>
  )
}

/**
 * The scroller: focusable, so arrow keys, Page Up/Down, Home and End move
 * through the transcript, with a ring inside its edge while the keyboard is on it.
 */
const Scroller = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function Scroller({ className, style, ...props }, ref) {
  return (
    <div
      {...props}
      // Virtuoso's own style says `outline: none`, which outranks the ring below: without it, the
      // keyboard's ring shows.
      style={{ ...style, outline: undefined }}
      ref={ref}
      tabIndex={0}
      aria-label="Transcript"
      data-pane="transcript"
      className={cn(className, 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]')}
    />
  )
})

const components = {
  Scroller,
  Header: ({ context }: { context?: ListContext }) => (
    <div className="flex h-12 items-end justify-center pb-2">
      {context?.loadingOlder && <LoaderCircle size={16} strokeWidth={1.75} aria-label="Loading earlier messages" className="animate-spin text-label-secondary motion-reduce:animate-none" />}
    </div>
  ),
  Footer: ({ context }: { context?: ListContext }) => (
    <>
      {context?.inline && <InlineCards sessionId={context.sessionId} />}
      <div style={{ height: `calc(var(--composer-space, 0px) + ${BOTTOM_SPACE}px)` }} />
    </>
  )
}

function TranscriptList({ sessionId, rows }: { sessionId: string; rows: Row[] }) {
  const virtuoso = useRef<VirtuosoHandle>(null)
  const scroller = useRef<HTMLElement | null>(null)
  const loadingOlder = useColumnTranscript((s) => s.loadingOlder)
  const loadOlder = useColumnTranscript((s) => s.loadOlder)
  const setExpanded = useColumnTranscript((s) => s.setExpanded)
  const openByDefault = useContext(OpenByDefault)
  const firstItemIndex = useFirstItemIndex(rows)
  const [scrolled, setScrolled] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const visible = useRef<ListRange>({ startIndex: 0, endIndex: 0 })
  const reduce = useReducedMotion()
  const inline = useConcept()
  const waitingCard = useLive((s) => s.sessions[sessionId]?.cards[0]?.requestId ?? null)

  // ─── Staying at the bottom ─────────────────────────────────────────────────
  // Whether you're at the bottom is decided when you scroll, not when the
  // content grows under you, so a reply arriving keeps the view where you left it.
  const pinned = useRef(true)
  const settle = useRef(0)
  const toBottom = useCallback(() => {
    // New rows are measured over a frame or two; follow until the bottom holds still.
    let frames = 0
    cancelAnimationFrame(settle.current)
    const step = () => {
      const s = scroller.current
      if (!s) return
      const end = s.scrollHeight - s.clientHeight
      if (Math.abs(s.scrollTop - end) > 1) s.scrollTop = end
      if (++frames < 8) settle.current = requestAnimationFrame(step)
    }
    settle.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => {
    if (pinned.current) toBottom()
  }, [rows, toBottom])
  // The composer grew (a long message, a card above it): the last row stays in view.
  useEffect(() => {
    const onComposer = () => pinned.current && toBottom()
    window.addEventListener('gloom:composer', onComposer)
    return () => window.removeEventListener('gloom:composer', onComposer)
  }, [toBottom])
  useEffect(() => () => cancelAnimationFrame(settle.current), [])
  // In the concept Claude's request waits at the end of the conversation: it comes into view as it
  // arrives (it takes the keyboard, so it must be seen), and the status pill brings you back to it.
  useEffect(() => {
    if (!inline) return
    const show = () => {
      pinned.current = true
      toBottom()
    }
    if (waitingCard) show()
    window.addEventListener('gloom:show-card', show)
    return () => window.removeEventListener('gloom:show-card', show)
  }, [inline, waitingCard, toBottom])
  // Going up (wheel, keys, the scroll bar) lets go of the bottom at once, even a notch short of
  // the margin, so a reply streaming in can't pull you back. Only your own going down holds it
  // again (or reaching the very end): the list nudges the view down by itself when rows above
  // you are measured again (a tool finishing, a code block), and that isn't you coming back.
  const lastTop = useRef(0)
  const held = useRef(false)
  /** When you last scrolled by wheel or keys; a wheel's smooth scroll runs on for a moment after. */
  const intent = useRef(0)
  const leave = useCallback(() => {
    pinned.current = false
    cancelAnimationFrame(settle.current)
  }, [])
  const onScroll = useCallback((e: Event) => {
    const s = e.currentTarget as HTMLElement
    const gap = s.scrollHeight - s.clientHeight - s.scrollTop
    const down = s.scrollTop > lastTop.current
    lastTop.current = s.scrollTop
    const yours = held.current || performance.now() - intent.current < 400
    if (gap >= bottomSpace() + 64 || (yours && !down)) pinned.current = false
    else if (gap < 2 || (yours && down)) pinned.current = true
  }, [])
  const onWheel = useCallback(
    (e: WheelEvent) => {
      intent.current = performance.now()
      if (e.deltaY < 0) leave()
    },
    [leave]
  )
  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) intent.current = performance.now()
      if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home' || (e.key === ' ' && e.shiftKey)) leave()
    },
    [leave]
  )
  const onPress = useCallback(() => (held.current = true), [])
  const onRelease = useCallback(() => (held.current = false), [])
  const listen = useCallback(
    (el: HTMLElement | null, on: boolean) => {
      if (!el) return
      const fn = on ? el.addEventListener.bind(el) : el.removeEventListener.bind(el)
      fn('scroll', onScroll as EventListener, { passive: true })
      fn('wheel', onWheel as EventListener, { passive: true })
      fn('keydown', onKey as EventListener)
      fn('pointerdown', onPress)
      const win = on ? window.addEventListener.bind(window) : window.removeEventListener.bind(window)
      win('pointerup', onRelease)
    },
    [onScroll, onWheel, onKey, onPress, onRelease]
  )

  // ─── Find ──────────────────────────────────────────────────────────────────
  const findOpen = useFind((s) => s.open)
  const query = useFind((s) => s.query)
  const current = useFind((s) => s.current)
  const moves = useFind((s) => s.moves)
  const instant = useFind((s) => s.instant)
  const matches = useMemo(() => (findOpen ? findMatches(rows, query) : []), [rows, findOpen, query])
  const match = matches[current]

  useEffect(() => {
    useFind.setState({ total: matches.length })
  }, [matches.length])

  // A new search starts from the first match at or below the top of the view.
  useEffect(() => {
    if (!findOpen || !matches.length) return
    const top = visible.current.startIndex
    const i = matches.findIndex((m) => m.rowIndex >= top)
    useFind.getState().setCurrent(i < 0 ? 0 : i, true)
    // Only when the search itself changes, not as rows stream in.
  }, [findOpen, query, matches.length > 0])

  const paint = useCallback(
    (reveal: boolean) => {
      const range = paintMatches(scroller.current, findOpen ? query : '', match)
      if (!reveal || !range || !scroller.current) return
      // A tall row (an opened output, say) may hold its match below the fold: bring the match itself into view.
      const box = range.getBoundingClientRect()
      const view = scroller.current.getBoundingClientRect()
      const margin = 80
      if (box.top < view.top + margin || box.bottom > view.bottom - margin) {
        scroller.current.scrollBy({ top: box.top - (view.top + view.height / 2) })
      }
      requestAnimationFrame(() => {
        const fresh = paintMatches(scroller.current, findOpen ? query : '', match)
        if (fresh && !useFind.getState().typing) popMatch(fresh)
      })
    },
    [findOpen, query, match]
  )

  // Moving to a match: open what hides it, scroll to its row, then mark it.
  useEffect(() => {
    if (!match) return
    // A row is open when it's the other way round from the view's default (a thinking or tool row Verbose opens is already).
    if (match.hidden) {
      const row = rows[match.rowIndex]
      const kind = row?.kind
      const opens = kind === 'thinking' ? openByDefault.thinking : kind === 'tool' ? openByDefault.tools : false
      setExpanded(match.key, !opens)
      // A run opens, and so does each of its steps whose details hold the match.
      if (row?.kind === 'tools') for (const step of row.steps) if (countMatches(rowText(step).hidden, query)) setExpanded(step.key, true)
    }
    virtuoso.current?.scrollIntoView({
      index: match.rowIndex,
      align: 'center',
      behavior: 'auto',
      done: () => requestAnimationFrame(() => requestAnimationFrame(() => paint(true)))
    })
    // `moves` counts every move, including back to the same match.
  }, [moves])

  // Rows scrolled into view get their matches marked; closing Find clears them.
  useEffect(() => {
    if (!findOpen) clearMatches()
    else paint(false)
  }, [findOpen, query, rows, paint])
  useEffect(() => () => clearMatches(), [])

  const repaint = useRef(0)
  const onRendered = () => {
    if (!findOpen || !query) return
    cancelAnimationFrame(repaint.current)
    repaint.current = requestAnimationFrame(() => paint(false))
  }

  // The table of contents takes you to a chapter's divider, through the list (it draws only rows near the screen).
  const goToChapter = (key: string) => {
    const index = rows.findIndex((r) => r.key === key)
    if (index >= 0) virtuoso.current?.scrollIntoView({ index, align: 'start', behavior: 'auto' })
  }

  return (
    <div className="relative min-h-0 flex-1">
      <Contents sessionId={sessionId} onGo={goToChapter} />
      <Virtuoso
        ref={virtuoso}
        scrollerRef={(el) => {
          listen(scroller.current, false)
          scroller.current = el as HTMLElement | null
          listen(scroller.current, true)
        }}
        data={rows}
        context={{ loadingOlder, sessionId, inline }}
        components={components}
        firstItemIndex={firstItemIndex}
        // Opens at the very bottom, past the last row's end to the spacer under it.
        initialTopMostItemIndex={{ index: rows.length - 1, align: 'end', offset: bottomSpace() }}
        computeItemKey={(_, row) => row.key}
        itemContent={(_, row) => <RowView row={row} sessionId={sessionId} />}
        startReached={() => loadOlder()}
        atTopStateChange={(top) => setScrolled(!top)}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={bottomSpace() + 64}
        rangeChanged={(range) => {
          visible.current = { startIndex: range.startIndex - firstItemIndex, endIndex: range.endIndex - firstItemIndex }
        }}
        itemsRendered={onRendered}
        increaseViewportBy={{ top: 800, bottom: 400 }}
        className={cn('h-full', scrolled && 'scroll-edge')}
      />
      <AnimatePresence>
        {!atBottom && (
          <motion.div
            key="latest"
            className="absolute right-4 z-[5]"
            style={{ bottom: 'calc(var(--composer-space, 0px) + 16px)' }}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
          >
            <GlassCapsule>
              <Button
                aria-label="Scroll to the latest message"
                shape="round"
                onClick={() => {
                  pinned.current = true
                  virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
                  toBottom()
                }}
              >
                <ArrowDown size={16} strokeWidth={1.75} />
              </Button>
            </GlassCapsule>
          </motion.div>
        )}
      </AnimatePresence>
      <FindBar total={matches.length} instant={instant} />
    </div>
  )
}
