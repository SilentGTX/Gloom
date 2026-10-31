import { Popover } from '@base-ui/react/popover'
import { ArrowRight } from 'lucide-react'
import type { UsageLimit } from '@shared/live'
import { cn } from '../../lib/cn'
import { useNow } from '../../lib/now'
import { relativeTime } from '../../lib/time'
import { useLive } from '../../stores/live'

/** "SG" for "Synergy Group", "SY" for "Synergy". */
function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}

/** "Resets at 8:30 PM" today, "Resets Sat 7:00 AM" on another day, as Claude Code's usage panel says it. */
function resets(at: number | null, now: number): string | null {
  if (!at) return null
  const date = new Date(at)
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return date.toDateString() === new Date(now).toDateString() ? `Resets at ${time}` : `Resets ${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
}

/** A share's bar: the accent, amber when the service warns, red near the end. */
function Bar({ percent, severity, thin }: { percent: number; severity: string; thin?: boolean }) {
  return (
    <div className={cn('overflow-hidden rounded-full bg-fill-strong', thin ? 'h-1' : 'h-1.5')}>
      <div
        className={cn('h-full rounded-full', severity === 'critical' ? 'bg-[var(--removed-mark)]' : severity === 'warning' ? 'bg-[var(--warning-mark)]' : 'bg-accent')}
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      />
    </div>
  )
}

const popupClass = [
  'glass-strong w-[min(320px,calc(100vw-24px))] rounded-[var(--radius-popover)] p-4 text-label outline-none',
  'origin-[var(--transform-origin)] transition-[transform,opacity] duration-[var(--duration-menu)] ease-out',
  'data-[starting-style]:scale-[0.94] data-[starting-style]:opacity-0',
  'data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms]',
  'motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100'
].join(' ')

/**
 * The foot of the concept's sidebar: who Claude Code is signed in as, the
 * plan, and how much of its weekly limit is used. A click opens the usage
 * panel, as Claude Code's app has it: each limit (5-hour, weekly, a model's
 * own) with when it resets, asked for afresh as it opens. Main reads the
 * account from Claude Code's config at launch and the usage then, when you
 * come back to Gloom and as turns end.
 */
export function AccountFooter() {
  const account = useLive((s) => s.account)
  const usage = useLive((s) => s.usage)
  const weekly = usage?.weekly ?? null
  const percent = weekly?.percent == null ? null : Math.round(weekly.percent)
  if (!account?.name && percent === null) return null
  const severity = usage?.limits?.find((l) => l.label.startsWith('Weekly · all'))?.severity ?? 'normal'
  const detail = [account?.plan ? `${account.plan} plan` : null, percent === null ? null : `${percent}% of weekly limit`].filter(Boolean).join(' · ')
  return (
    <div className="mx-2.5 mb-2 border-t border-separator pt-1.5">
    <Popover.Root onOpenChange={(open) => open && void window.gloom?.live.refreshUsage(60_000)}>
      <Popover.Trigger
        render={
          <button type="button" className="concept-account no-drag">
            {account?.name && (
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--label-secondary)] text-[11px] font-semibold text-[var(--surface)]">
                {initials(account.name)}
              </span>
            )}
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] font-medium text-label">{account?.name ?? 'Your plan'}</span>
              {detail && <span className="block truncate text-[11.5px] text-label-secondary tabular">{detail}</span>}
              {percent !== null && (
                <span className="mt-[5px] block">
                  <Bar percent={percent} severity={severity} thin />
                </span>
              )}
            </span>
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} collisionPadding={8} className="z-50 outline-none">
          <Popover.Popup aria-label="Usage limits" className={popupClass}>
            <UsageDetails plan={account?.plan ?? null} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
    </div>
  )
}

/** Each of your plan's limits: how much is used and when it resets; See All opens claude.ai's own page. */
function UsageDetails({ plan }: { plan: string | null }) {
  const usage = useLive((s) => s.usage)
  const now = useNow(30_000)
  const limits: UsageLimit[] = usage?.limits ?? []
  const age = usage ? relativeTime(usage.updated, now) : null
  return (
    <div className="relative z-[2] flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12.5px] text-label-secondary">
          Your usage limits
          {plan && ` · ${plan}`}
        </h3>
        <button type="button" onClick={() => window.open('https://claude.ai/settings/usage', '_blank')} className="concept-see-all no-drag">
          See All
          <ArrowRight size={13} strokeWidth={2} aria-hidden />
        </button>
      </div>
      {limits.length ? (
        limits.map((l) => {
          const percent = l.percent === null ? null : Math.round(l.percent)
          return (
            <div key={l.label}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate font-medium text-label">{l.label}</span>
                <span className="shrink-0 text-[12px] text-label-secondary tabular">
                  {resets(l.resetsAt, now)}
                  <span className="ml-2.5 text-label">{percent === null ? '—' : `${percent}%`}</span>
                </span>
              </div>
              {percent !== null && (
                <div className="mt-1.5" role="meter" aria-label={l.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                  <Bar percent={percent} severity={l.severity} />
                </div>
              )}
            </div>
          )
        })
      ) : (
        <p className="text-[12.5px] text-label-secondary">Your plan’s limits show here once Claude Code reports them.</p>
      )}
      {age && <p className="text-[11px] text-label-secondary">Updated {age === 'Now' ? 'just now' : `${age} ago`}</p>}
    </div>
  )
}
