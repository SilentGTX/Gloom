import { describe, expect, it } from 'vitest'
import { DEFAULT_MODELS, shownModels, type ModelChoice } from '@shared/live'

const model = (value: string, label: string): ModelChoice => ({ value, label, description: '', efforts: [] })

describe('shownModels', () => {
  it('keeps Default and the current generation (its aliases) and drops pinned older versions', () => {
    // As the CLI reports them: current models under short aliases, everything else as full IDs.
    const reported = [
      model('default', 'Default (recommended)'),
      model('opus', 'Opus 5.5'),
      model('fable', 'Fable 5.1'),
      model('sonnet', 'Sonnet 5.5'),
      model('haiku', 'Haiku 5.5'),
      model('claude-haiku-4-5-20251001', 'Haiku 4.5'),
      model('claude-sonnet-5', 'Sonnet 5'),
      model('claude-opus-5', 'Opus 5'),
      model('claude-fable-5', 'Fable 5'),
      model('claude-opus-4-8', 'Opus 4.8')
    ]
    expect(shownModels(reported).map((m) => m.label)).toEqual(['Default (recommended)', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 5.5'])
  })

  it('tracks the lineup without code changes: whatever versions the aliases resolve to', () => {
    const reported = [
      model('default', 'Default (recommended)'),
      model('opus', 'Opus 4.8'),
      model('sonnet', 'Sonnet 5'),
      model('haiku', 'Haiku 4.5'),
      model('fable', 'Fable 5'),
      model('claude-opus-4-7', 'Opus 4.7')
    ]
    expect(shownModels(reported).map((m) => m.label)).toEqual(['Default (recommended)', 'Opus 4.8', 'Sonnet 5', 'Haiku 4.5', 'Fable 5'])
  })

  it('falls back to Claude Code’s aliases when only pinned IDs are reported', () => {
    expect(shownModels([model('default', 'Default'), model('claude-opus-4-8', 'Opus 4.8')])).toBe(DEFAULT_MODELS)
  })
})
