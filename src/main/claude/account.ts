// Who Claude Code is signed in as, and your plan's use, as Claude Code keeps
// them in its own config (.claude.json): read at launch, so the concept's
// sidebar can say them before any session has started, and again as sessions
// end and as you come back to Gloom. Only the organisation, your name and the
// plan are taken, and the usage Claude Code last fetched; nothing else is read.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { accountName, EFFORTS, planName, type AccountSummary, type ClaudeDefaults, type Effort, type UsageInfo, type UsageLimit, type UsageWindow } from '@shared/live'

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
 * nothing about the one running now, so it's left out (and with none,
 * there's nothing to say).
 */
export function usageFrom(config: unknown, now = Date.now()): UsageInfo | null {
  const cached = isObj(config) && isObj(config.cachedUsageUtilization) ? config.cachedUsageUtilization : null
  if (!cached || typeof cached.fetchedAtMs !== 'number') return null
  return usageFromRateLimits(cached.utilization, cached.fetchedAtMs, now)
}

/** The service's names for its limits, as Claude Code's usage panel says them. */
const LIMIT_LABELS: Record<string, string> = { session: '5-hour limit', weekly_all: 'Weekly · all models' }

/** How full a share is when the service doesn't say: past three quarters it warns, near the end it's critical. */
const severityOf = (percent: number | null) => (percent === null ? 'normal' : percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : 'normal')

/**
 * Your plan's limits from Claude Code's usage answer (`rate_limits`), or the
 * copy of it Claude Code keeps: its list of limits when it has one, else its
 * 5-hour and 7-day windows. Limits that have reset by `now` are left out.
 */
export function usageFromRateLimits(raw: unknown, updated: number, now = Date.now()): UsageInfo | null {
  if (!isObj(raw)) return null
  const resetAt = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : NaN)
  const window = (w: unknown): UsageWindow | null => {
    if (!isObj(w) || typeof w.utilization !== 'number') return null
    const resetsAt = resetAt(w.resets_at)
    return !Number.isFinite(resetsAt) || resetsAt > now ? { percent: w.utilization, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null } : null
  }
  const fiveHour = window(raw.five_hour)
  const weekly = window(raw.seven_day)
  const listed = (Array.isArray(raw.limits) ? raw.limits : []).flatMap((l): UsageLimit[] => {
    if (!isObj(l)) return []
    const resetsAt = resetAt(l.resets_at)
    if (Number.isFinite(resetsAt) && resetsAt <= now) return []
    const kind = str(l.kind) ?? ''
    const scope = isObj(l.scope) ? l.scope : {}
    const scoped = (isObj(scope.model) ? str(scope.model.display_name) : null) ?? (isObj(scope.surface) ? str(scope.surface.display_name) : null)
    const label = LIMIT_LABELS[kind] ?? (scoped ? `${kind.startsWith('weekly') ? 'Weekly' : 'Limit'} · ${scoped}` : kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()))
    const percent = typeof l.percent === 'number' ? l.percent : null
    return label ? [{ label, percent, resetsAt: Number.isFinite(resetsAt) ? resetsAt : null, severity: str(l.severity) ?? severityOf(percent) }] : []
  })
  // An older answer has only the two windows: they're the list.
  const limits = listed.length
    ? listed
    : [
        ...(fiveHour ? [{ label: LIMIT_LABELS.session, ...fiveHour, severity: severityOf(fiveHour.percent) }] : []),
        ...(weekly ? [{ label: LIMIT_LABELS.weekly_all, ...weekly, severity: severityOf(weekly.percent) }] : [])
      ]
  return fiveHour || weekly || limits.length ? { fiveHour, weekly, limits, status: null, updated } : null
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

/**
 * The effort Claude Code starts a model on when nothing picks one: /effort's
 * level for that model (modelSettings), else the one in its settings
 * (effortLevel). From settings.json in Claude Code's folder.
 */
export function claudeDefaults(): ClaudeDefaults {
  const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
    const isLevel = (v: unknown): v is Effort => typeof v === 'string' && (EFFORTS as readonly string[]).includes(v)
    const perModel: Record<string, Effort> = {}
    if (raw.modelSettings && typeof raw.modelSettings === 'object') {
      for (const [model, s] of Object.entries(raw.modelSettings as Record<string, unknown>)) {
        const level = (s as { effortLevel?: unknown } | null)?.effortLevel
        if (isLevel(level)) perModel[model] = level
      }
    }
    return { effort: isLevel(raw.effortLevel) ? raw.effortLevel : null, perModel }
  } catch {
    return { effort: null, perModel: {} }
  }
}

/**
 * Whether Claude Code compacts a long conversation left idle (Claude Code
 * 2.1.299, in the Claude app's Code tab since 2.1.314): on unless
 * `"idleCompaction": false` in its settings or DISABLE_AUTO_COMPACT. Its
 * minimum is 200K tokens, or CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS.
 */
export function idleCompaction(): { on: boolean; minTokens: number } {
  const env = Number(process.env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS)
  const minTokens = Number.isFinite(env) && env > 0 ? env : 200_000
  if (process.env.DISABLE_AUTO_COMPACT && process.env.DISABLE_AUTO_COMPACT !== '0') return { on: false, minTokens }
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
    const raw = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as Record<string, unknown>
    return { on: raw.idleCompaction !== false && raw.autoCompactEnabled !== false, minTokens }
  } catch {
    return { on: true, minTokens }
  }
}
