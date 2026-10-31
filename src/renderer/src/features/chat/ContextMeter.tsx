import { Popover } from '@base-ui/react/popover'
import type { LiveSummary, UsageWindow } from '@shared/live'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useLive } from '../../stores/live'

const popupClass = [
  'glass-strong w-[min(300px,calc(100vw-24px))] rounded-[var(--radius-popover)] p-4 text-label outline-none',
  'origin-[var(--transform-origin)] transition-[transform,opacity] duration-[var(--duration-menu)] ease-out',
  'data-[starting-style]:scale-[0.94] data-[starting-style]:opacity-0',
  'data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms]',
  'motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100'
].join(' ')

const tokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000).toLocaleString()}K` : n.toLocaleString())

/** "4:00 PM", or "Mon 5:00 AM" past a day. */
function resets(at: number | null): string | null {
  if (!at) return null
  const far = at - Date.now() > 20 * 60 * 60 * 1000
  return new Date(at).toLocaleString(undefined, { ...(far ? { weekday: 'short' } : {}), hour: 'numeric', minute: '2-digit' })
}

/** How full: past three quarters it warns, as Claude Code's meter does before it compacts. */
const level = (percent: number) => (percent >= 90 ? 'full' : percent >= 75 ? 'high' : 'ok')

/**
 * How full the session's context is, as a small capacity ring by Send. Its
 * card says it in numbers, offers Compact Now, and shows your plan's 5-hour
 * and weekly use when the CLI reports them.
 */
export function ContextMeter({ sessionId, summary }: { sessionId: string; summary: LiveSummary | undefined }) {
  const usage = useLive((s) => s.usage)
  const context = summary?.context ?? null
  // Nothing to measure yet (no turn has said how full it is, and no limit reported a percentage): no ring.
  if (!context && usage?.fiveHour?.percent == null && usage?.weekly?.percent == null) return null
  const percent = context?.percent ?? 0
  const r = 7
  const circumference = 2 * Math.PI * r
  const label = context ? `Context ${percent}% full` : 'Usage'
  return (
    <Popover.Root>
      <Tooltip label={label}>
        <Popover.Trigger
          render={
            <Button shape="round" aria-label={label}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden className={cn('context-ring', context && `is-${level(percent)}`)}>
                <circle cx="9" cy="9" r={r} className="context-ring-track" />
                {context && <circle cx="9" cy="9" r={r} className="context-ring-fill" strokeDasharray={`${(circumference * percent) / 100} ${circumference}`} transform="rotate(-90 9 9)" />}
              </svg>
            </Button>
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={10} collisionPadding={8} className="z-50 outline-none">
          <Popover.Popup aria-label="Context and Usage" className={popupClass}>
            <div className="relative z-[2] flex flex-col gap-3">
              {context && (
                <section>
                  <Meter title="Context" percent={percent} detail={`${tokens(context.used)} of ${tokens(context.max)} tokens`} />
                  <p className="mt-1.5 text-[11.5px] text-label-secondary">Near full, Claude Code compacts the conversation to make room.</p>
                  <Popover.Close
                    render={
                      <Button size="text" tone="secondary" className="mt-2" disabled={summary?.state === 'working' || summary?.state === 'starting'} onClick={() => void compact(sessionId)}>
                        Compact Now
                      </Button>
                    }
                  />
                </section>
              )}
              {(usage?.fiveHour || usage?.weekly) && (
                <section className={cn(context && 'border-t border-separator pt-3')}>
                  <h3 className="text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">Plan usage</h3>
                  <div className="mt-1.5 flex flex-col gap-2">
                    {usage.fiveHour && <Window title="5-hour limit" window={usage.fiveHour} />}
                    {usage.weekly && <Window title="Weekly limit" window={usage.weekly} />}
                  </div>
                </section>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Claude Code's own /compact, sent as a message; whatever you were writing stays. */
function compact(sessionId: string): Promise<boolean> {
  return useLive.getState().sendText(sessionId, '/compact')
}

function Window({ title, window }: { title: string; window: UsageWindow }) {
  const at = resets(window.resetsAt)
  return <Meter title={title} percent={window.percent} detail={at ? `Resets ${at}` : undefined} />
}

function Meter({ title, percent, detail }: { title: string; percent: number | null; detail?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="font-medium">{title}</span>
        <span className="tabular text-label-secondary">{percent === null ? '—' : `${Math.round(percent)}%`}</span>
      </div>
      {percent !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fill-strong" role="meter" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
          <div className={cn('context-bar h-full rounded-full', `is-${level(percent)}`)} style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
        </div>
      )}
      {detail && <p className="mt-1 text-[11.5px] text-label-secondary tabular">{detail}</p>}
    </div>
  )
}
