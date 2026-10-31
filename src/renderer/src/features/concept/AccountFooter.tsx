import { useLive } from '../../stores/live'

/** "SG" for "Synergy Group", "SY" for "Synergy". */
function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}

/**
 * The foot of the concept's sidebar: who Claude Code is signed in as, the
 * plan, and how much of its weekly limit is used. Main reads them from Claude
 * Code's own config at launch, so they're here before any session starts; the
 * use updates as turns end. A week that has reset since Claude Code last
 * looked shows no figure until it's known again.
 */
export function AccountFooter() {
  const account = useLive((s) => s.account)
  const weekly = useLive((s) => s.usage?.weekly ?? null)
  const percent = weekly?.percent == null ? null : Math.round(weekly.percent)
  if (!account?.name && percent === null) return null
  const resets = weekly?.resetsAt ? new Date(weekly.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : null
  const detail = [account?.plan ? `${account.plan} plan` : null, percent === null ? null : `${percent}% of weekly limit`].filter(Boolean).join(' · ')
  return (
    <div className="mx-2.5 mb-3 flex items-center gap-[9px] border-t border-separator px-2 pt-2.5" title={resets ? `The weekly limit resets ${resets}` : undefined}>
      {account?.name && (
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--label-secondary)] text-[11px] font-semibold text-[var(--surface)]">
          {initials(account.name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-label">{account?.name ?? 'Your plan'}</p>
        {detail && <p className="truncate text-[11.5px] text-label-secondary tabular">{detail}</p>}
        {percent !== null && (
          <div className="mt-[5px] h-1 overflow-hidden rounded-[2px] bg-fill-strong" role="meter" aria-label="Weekly limit used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <div className="h-full rounded-[2px] bg-accent" style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}
