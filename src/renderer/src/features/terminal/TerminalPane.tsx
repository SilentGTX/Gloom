import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { ChevronDown, Plus, SquareTerminal, TriangleAlert, X } from 'lucide-react'
import { formatAccelerator } from '@shared/commands'
import type { SessionMeta } from '@shared/library'
import { folderKey, type TerminalInfo } from '@shared/terminal'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { runCommand } from '../../lib/commands'
import { folderTerminals, takeFocusWish, useTerminals, wantFocus } from '../../stores/terminals'
import { fitScreen, focusScreen, mountScreen } from './registry'

/** A session you switch to with the pane open gets a terminal once you've stayed this long, so clicking through sessions doesn't start shells. */
const SETTLE_MS = 350

/** "PowerShell", then "PowerShell 2" when there are two; a tab Claude opened goes by the name it gave it ("dev server"). */
function tabLabels(terminals: TerminalInfo[]): string[] {
  const seen = new Map<string, number>()
  return terminals.map((t) => {
    const base = t.title ?? t.short
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base} ${n}`
  })
}

/**
 * The terminal pane, under the chat: the shells open in the session's working
 * folder, as tabs, the one picked showing below. Opened from the toolbar or
 * the View menu with no shell yet, it starts one; the last tab closing puts
 * the pane away.
 */
export function TerminalPane({ session, embedded }: { session: SessionMeta | undefined; /** In the concept's Terminal view, which the toolbar's segments hide. */ embedded?: boolean }) {
  const all = useTerminals((s) => s.terminals)
  const folder = session?.cwd ?? null
  const terminals = useMemo(() => folderTerminals(all, folder), [all, folder])
  const activeId = useTerminals((s) => (folder ? s.active[folderKey(folder)] : undefined))
  const failed = useTerminals((s) => (folder ? s.failed[folderKey(folder)] : undefined))
  const active = terminals.find((t) => t.id === activeId) ?? terminals[0]
  const host = useRef<HTMLDivElement>(null)
  const labels = tabLabels(terminals)

  // A folder with no shell yet gets one, unless one just failed to start there.
  const sessionId = session?.id
  const none = terminals.length === 0
  useEffect(() => {
    if (!sessionId || !folder || !none || failed) return
    const timer = setTimeout(() => void useTerminals.getState().open(sessionId, folder), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [sessionId, folder, none, failed])

  // The picked shell's screen, sized to the pane and kept sized.
  const activeTerminal = active?.id
  useEffect(() => {
    const el = host.current
    if (!activeTerminal || !el) return
    mountScreen(activeTerminal, el)
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitScreen(activeTerminal))
    })
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [activeTerminal])

  // Opened, picked or made just now: the shell takes the keyboard (a session switch leaves it where it is).
  useEffect(() => {
    if (activeTerminal && takeFocusWish()) focusScreen(activeTerminal)
  }, [activeTerminal])

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = terminals.findIndex((t) => t.id === active?.id)
    const next = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: terminals.length - 1 }[e.key]
    if (next === undefined || !terminals[next]) return
    e.preventDefault()
    useTerminals.getState().select(terminals[next].id)
    document.getElementById(`terminal-tab-${terminals[next].id}`)?.focus()
  }

  return (
    <section aria-label="Terminal" data-pane="terminal" className="terminal-pane flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 pr-1.5 pl-2">
        <div role="tablist" aria-label="Terminals" onKeyDown={onTabKey} className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {terminals.map((t, i) => {
            const selected = t.id === active?.id
            return (
              <div key={t.id} className={cn('terminal-tab group/tab flex h-7 shrink-0 items-center rounded-[7px]', selected && 'is-selected')}>
                <div
                  id={`terminal-tab-${t.id}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls="terminal-screen"
                  tabIndex={selected ? 0 : -1}
                  onPointerDown={() => {
                    if (selected) {
                      requestAnimationFrame(() => focusScreen(t.id))
                      return
                    }
                    wantFocus()
                    useTerminals.getState().select(t.id)
                  }}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && focusScreen(t.id)}
                  className="flex h-full items-center gap-1.5 rounded-[7px] pr-1 pl-2 text-[12px] font-medium outline-none select-none focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
                >
                  <SquareTerminal size={13} strokeWidth={1.75} aria-hidden className="shrink-0 opacity-80" />
                  <span className={cn('whitespace-nowrap', t.exitCode !== null && 'line-through decoration-label-tertiary')}>{labels[i]}</span>
                  {t.exitCode !== null && <span className="sr-only">, ended</span>}
                </div>
                <Tooltip label={`Close ${labels[i]}`}>
                  <button
                    type="button"
                    aria-label={`Close ${labels[i]}`}
                    onClick={() => useTerminals.getState().close(t.id)}
                    className={cn(
                      'no-drag mr-1 flex size-5 items-center justify-center rounded-[5px] text-label-secondary outline-none hover:bg-fill-strong hover:text-label active:bg-fill-pressed focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]',
                      !selected && 'opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100'
                    )}
                  >
                    <X size={12} strokeWidth={2} aria-hidden />
                  </button>
                </Tooltip>
              </div>
            )
          })}
        </div>
        <Tooltip label="New Terminal" shortcut={formatAccelerator('CmdOrCtrl+Shift+`')}>
          <Button size="small" aria-label="New terminal" disabled={!session} onClick={() => runCommand('terminal.new')}>
            <Plus size={15} strokeWidth={1.75} aria-hidden />
          </Button>
        </Tooltip>
        <div className="flex-1" />
        {!embedded && (
          <Tooltip label="Hide Terminal" shortcut={formatAccelerator('CmdOrCtrl+`')}>
            <Button size="small" aria-label="Hide terminal" onClick={() => runCommand('view.toggleTerminal')}>
              <ChevronDown size={15} strokeWidth={1.75} aria-hidden />
            </Button>
          </Tooltip>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {active ? (
          <div ref={host} id="terminal-screen" role="tabpanel" aria-label={labels[terminals.indexOf(active)]} className="absolute inset-0 pb-1 pl-3" />
        ) : !session ? (
          <EmptyState icon={<SquareTerminal size={32} strokeWidth={1.25} />} title="No Session Selected">
            A terminal opens in a session’s working folder.
          </EmptyState>
        ) : failed ? (
          <EmptyState icon={<TriangleAlert size={32} strokeWidth={1.25} />} title="Can’t Open a Terminal">
            <span className="flex flex-col items-center gap-3">
              <span>{failed}</span>
              <Button size="text" tone="secondary" onClick={() => void useTerminals.getState().open(session.id, session.cwd ?? '')}>
                Try Again
              </Button>
            </span>
          </EmptyState>
        ) : null}
      </div>
    </section>
  )
}
