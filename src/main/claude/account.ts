// Who Claude Code is signed in as, and your plan's use, as Claude Code keeps
// them in its own config (.claude.json): read at launch, so the concept's
// sidebar can say them before any session has started, and again as sessions
// end and as you come back to Gloom. Only the organisation, your name and the
// plan are taken, and the usage Claude Code last fetched; nothing else is read.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { accountName, planName, type AccountSummary, type UsageInfo, type UsageWindow } from '@shared/live'

/** Claude Code's config: in CLAUDE_CONFIG_DIR when it's set, as the CLI keeps it, else ~/.claude.json. */
export function configFile(): string {
  return process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(homedir(), '.claude.json')
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

/** The account in the config, or null without one (signed out, or an API key). */
export function accountFrom(config: unknown): AccountSummary | null {
  const a = isObj(config) && isObj(config.oauthAccount) ? config.oauthAccount : null
  if (!a) return null
  const name = accountName(str(a.organizationName), str(a.displayName), str(a.emailAddress))
  const plan = planName(str(a.organizationType))
  return name || plan ? { name, plan } : null
}

/**
 * The usage Claude Code last fetched. A window that has reset since says
 * nothing about the one running now, so it's left out (and with neither,
 * there's nothing to say).
 */
export function usageFrom(config: unknown, now = Date.now()): UsageInfo | null {
  const cached = isObj(config) && isObj(config.cachedUsageUtilization) ? config.cachedUsageUtilization : null
  if (!cached || !isObj(cached.utilization) || typeof cached.fetchedAtMs !== 'number') return null
  const window = (raw: unknown): UsageWindow | null => {
    if (!isObj(raw) || typeof raw.utilization !== 'number' || typeof raw.resets_at !== 'string') return null
    const resetsAt = Date.parse(raw.resets_at)
    return Number.isFinite(resetsAt) && resetsAt > now ? { percent: raw.utilization, resetsAt } : null
  }
  const fiveHour = window(cached.utilization.five_hour)
  const weekly = window(cached.utilization.seven_day)
  return fiveHour || weekly ? { fiveHour, weekly, status: null, updated: cached.fetchedAtMs } : null
}

/** Both, from the config file; nothing when it can't be read. */
export function readAccount(file = configFile(), now = Date.now()): { account: AccountSummary | null; usage: UsageInfo | null } {
  try {
    const config: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return { account: accountFrom(config), usage: usageFrom(config, now) }
  } catch {
    return { account: null, usage: null }
  }
}
