import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { idleCompaction } from '../../src/main/claude/account'

const saved = { ...process.env }
afterEach(() => {
  for (const key of ['CLAUDE_CONFIG_DIR', 'DISABLE_AUTO_COMPACT', 'CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS']) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

/** A Claude Code folder with these settings. */
function claudeDir(settings: Record<string, unknown> | null): void {
  const dir = mkdtempSync(join(tmpdir(), 'gloom-idle-'))
  if (settings) writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings))
  process.env.CLAUDE_CONFIG_DIR = dir
}

describe('idle compaction', () => {
  it('is on unless Claude Code is told otherwise, from 200K tokens', () => {
    delete process.env.DISABLE_AUTO_COMPACT
    delete process.env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS
    claudeDir(null)
    expect(idleCompaction()).toEqual({ on: true, minTokens: 200_000 })
    claudeDir({ effortLevel: 'medium' })
    expect(idleCompaction().on).toBe(true)
  })

  it('is off with idleCompaction or autoCompactEnabled false, or DISABLE_AUTO_COMPACT', () => {
    delete process.env.DISABLE_AUTO_COMPACT
    claudeDir({ idleCompaction: false })
    expect(idleCompaction().on).toBe(false)
    claudeDir({ autoCompactEnabled: false })
    expect(idleCompaction().on).toBe(false)
    claudeDir({})
    process.env.DISABLE_AUTO_COMPACT = '1'
    expect(idleCompaction().on).toBe(false)
  })

  it('takes Claude Code’s own minimum when one is set', () => {
    delete process.env.DISABLE_AUTO_COMPACT
    claudeDir({})
    process.env.CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS = '150000'
    expect(idleCompaction().minTokens).toBe(150_000)
  })
})
