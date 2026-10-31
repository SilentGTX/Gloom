import type { AccountSummary } from '@shared/live'
import { useLive } from '../../stores/live'

/** The name the footer shows: your organisation, unless it's only "<you>'s Organization"; then you. */
function accountName(account: AccountSummary): string | null {
  const org = account.organization?.trim()
  if (org && !/'s Organi[sz]ation$/i.test(org)) return org
  return account.email?.split('@')[0] ?? org ?? null
}

/** "SG" for "Synergy Group", "SY" for "Synergy". */
function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}

/**
 * The foot of the concept's sidebar: who Claude Code is signed in as, the
 * plan, and how much of its weekly limit is used. It shows once a session has
 * told Gloom (usage after each turn), and stays away until then.
 */
export function AccountFooter() {
  const account = useLive((s) => s.account)
  const weekly = useLive((s) => s.usage?.weekly?.percent ?? null)
  const name = account ? accountName(account) : null
  if (!name && weekly === null) return null
  const plan = account?.plan ? `${account.plan[0].toUpperCase()}${account.plan.slice(1)} plan` : null
  const percent = weekly === null ? null : Math.round(weekly)
  const detail = [plan, percent === null ? null : `${percent}% of weekly limit`].filter(Boolean).join(' · ')
  return (
    <div className="mx-2.5 mb-3 flex items-center gap-[9px] border-t border-separator px-2 pt-2.5">
      {name && (
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--label-secondary)] text-[11px] font-semibold text-[var(--surface)]">
          {initials(name)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-label">{name ?? 'Your plan'}</p>
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
