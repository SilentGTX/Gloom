// Who's signed in, and the plan's use, as Claude Code's config has them: the
// foot of the concept's sidebar, before any session has started.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accountFrom, readAccount, usageFrom, usageFromRateLimits } from '../../src/main/claude/account'
import { accountName, planName } from '../../src/shared/live'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const later = (hours: number) => new Date(NOW + hours * 3600_000).toISOString()

/** The parts of a .claude.json Gloom reads, with made-up values. */
function config(account: Record<string, unknown> | null, utilization: Record<string, unknown> | null = null) {
  return {
    userID: 'not read',
    ...(account ? { oauthAccount: { accountUuid: 'x', emailAddress: 'sam@example.com', ...account } } : {}),
    ...(utilization ? { cachedUsageUtilization: { fetchedAtMs: NOW - 60_000, accountUuid: 'x', utilization } } : {})
  }
}

describe('the account', () => {
  it('is the organisation, and its plan', () => {
    expect(accountFrom(config({ organizationName: 'Synergy', organizationType: 'claude_max', displayName: 'Sam' }))).toEqual({ name: 'Synergy', plan: 'Max' })
    expect(accountFrom(config({ organizationName: 'Northwind', organizationType: 'claude_team' }))).toEqual({ name: 'Northwind', plan: 'Team' })
  })

  it('is you when the organisation is only you', () => {
    expect(accountFrom(config({ organizationName: "sam@example.com's Organization", displayName: 'Sam', organizationType: 'claude_pro' }))).toEqual({ name: 'Sam', plan: 'Pro' })
    expect(accountFrom(config({ organizationName: "sam@example.com's Organisation" }))).toEqual({ name: 'sam', plan: null })
  })

  it('is nothing when signed out, or for an API key', () => {
    expect(accountFrom(config(null))).toBeNull()
    expect(accountFrom('not a config')).toBeNull()
  })

  it('names plans as people say them', () => {
    expect(planName('claude_team')).toBe('Team')
    expect(planName('Claude Team')).toBe('Team')
    expect(planName('max')).toBe('Max')
    expect(planName('claude_enterprise')).toBe('Enterprise')
    expect(planName('')).toBeNull()
    expect(accountName(null, null, 'robin@example.com')).toBe('robin')
  })
})

describe('the plan’s use', () => {
  it('is what Claude Code last fetched, while its windows still run', () => {
    const usage = usageFrom(config({}, { five_hour: { utilization: 4, resets_at: later(2) }, seven_day: { utilization: 38, resets_at: later(60) } }), NOW)
    expect(usage).toEqual({
      fiveHour: { percent: 4, resetsAt: Date.parse(later(2)) },
      weekly: { percent: 38, resetsAt: Date.parse(later(60)) },
      // An answer without its own list: the two windows are the list.
      limits: [
        { label: '5-hour limit', percent: 4, resetsAt: Date.parse(later(2)), severity: 'normal' },
        { label: 'Weekly · all models', percent: 38, resetsAt: Date.parse(later(60)), severity: 'normal' }
      ],
      status: null,
      updated: NOW - 60_000
    })
  })

  it('lists the limits the service names, as Claude Code’s usage panel does', () => {
    const usage = usageFromRateLimits(
      {
        five_hour: { utilization: 44, resets_at: later(3) },
        seven_day: { utilization: 19, resets_at: later(100) },
        limits: [
          { kind: 'session', group: 'session', percent: 44, resets_at: later(3), severity: 'normal', scope: null },
          { kind: 'weekly_all', group: 'weekly', percent: 91, resets_at: later(100), severity: 'critical', scope: null },
          { kind: 'weekly_scoped', group: 'weekly', percent: 0, resets_at: later(100), severity: 'normal', scope: { model: { display_name: 'Fable', id: null }, surface: null } },
          { kind: 'weekly_scoped', percent: 50, resets_at: later(-1), scope: { model: { display_name: 'Gone' } } },
          { kind: 'monthly_spend', percent: 12 }
        ]
      },
      NOW,
      NOW
    )
    expect(usage?.limits?.map((l) => [l.label, l.percent, l.severity])).toEqual([
      ['5-hour limit', 44, 'normal'],
      ['Weekly · all models', 91, 'critical'],
      ['Weekly · Fable', 0, 'normal'],
      ['Monthly spend', 12, 'normal']
    ])
    expect(usage?.weekly?.percent).toBe(19)
  })

  it('leaves out a window that has reset since', () => {
    const usage = usageFrom(config({}, { five_hour: { utilization: 90, resets_at: later(-1) }, seven_day: { utilization: 38, resets_at: later(30) } }), NOW)
    expect(usage?.fiveHour).toBeNull()
    expect(usage?.weekly?.percent).toBe(38)
    expect(usageFrom(config({}, { five_hour: { utilization: 90, resets_at: later(-1) }, seven_day: { utilization: 33, resets_at: later(-5) } }), NOW)).toBeNull()
  })

  it('is nothing without a cache', () => {
    expect(usageFrom(config({}), NOW)).toBeNull()
    expect(usageFrom(config({}, { seven_day: null }), NOW)).toBeNull()
  })
})

describe('reading the config', () => {
  it('takes both from the file, and nothing from a file that isn’t there or isn’t JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gloom-account-'))
    const file = join(dir, '.claude.json')
    writeFileSync(file, JSON.stringify(config({ organizationName: 'Synergy', organizationType: 'claude_max' }, { seven_day: { utilization: 38, resets_at: later(10) } })))
    const read = readAccount(file, NOW)
    expect(read.account).toEqual({ name: 'Synergy', plan: 'Max' })
    expect(read.usage?.weekly?.percent).toBe(38)
    expect(readAccount(join(dir, 'missing.json'), NOW)).toEqual({ account: null, usage: null })
    writeFileSync(file, '{ half')
    expect(readAccount(file, NOW)).toEqual({ account: null, usage: null })
  })
})
