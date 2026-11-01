import { describe, expect, it } from 'vitest'
import { DEFAULT_MODELS, shownModels, type ModelChoice } from '@shared/live'

const model = (label: string, value = label.toLowerCase().replace(/ /g, '-')): ModelChoice => ({ value, label, description: '', efforts: [] })

describe('shownModels', () => {
  it('keeps Default and the 5.5 family with Fable 5.1, and drops every other version', () => {
    const reported = [
      model('Default', 'default'),
      model('Opus 5.5'),
      model('Fable 5.1'),
      model('Sonnet 5.5'),
      model('Haiku 5.5'),
      model('Haiku 4.5'),
      model('Sonnet 5'),
      model('Opus 5'),
      model('Fable 5'),
      model('Opus 4.8'),
      model('Opus 4.7'),
      model('Opus 4.6'),
      model('Sonnet 4.6')
    ]
    expect(shownModels(reported).map((m) => m.label)).toEqual(['Default', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 5.5'])
  })

  it('falls back to Claude Code’s aliases when no current model is reported', () => {
    expect(shownModels([model('Default', 'default'), model('Opus 4.8')])).toBe(DEFAULT_MODELS)
  })
})
