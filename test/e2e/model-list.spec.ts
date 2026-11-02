import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, tempDir } from './app'

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

test('the picker lists Default and the 5.5 models with Fable 5.1, and drops older ones kept from a CLI', async () => {
  const userData = tempDir('gloom-models-')
  // As the CLI reports them: the current generation under short aliases, older or pinned ones as full IDs.
  const kept = [
    { value: 'default', label: 'Default', description: 'Opus 5.5 · Best for everyday, complex tasks', efforts: ['low', 'medium', 'high'] },
    { value: 'opus', label: 'Opus 5.5', description: '', efforts: ['low', 'medium', 'high'] },
    { value: 'fable', label: 'Fable 5.1', description: '', efforts: ['low', 'medium', 'high'] },
    { value: 'sonnet', label: 'Sonnet 5.5', description: '', efforts: ['low', 'medium', 'high'] },
    { value: 'haiku', label: 'Haiku 5.5', description: '', efforts: [] },
    { value: 'claude-opus-4-8', label: 'Opus 4.8', description: '', efforts: ['low', 'medium', 'high'] },
    { value: 'claude-fable-5', label: 'Fable 5', description: '', efforts: ['low', 'medium', 'high'] },
    { value: 'claude-haiku-4-5', label: 'Haiku 4.5', description: '', efforts: [] }
  ]
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ settings: {}, models: kept, modelsFrom: '2.0.0' }))
  ;({ app, page } = await launch({ userData }))
  const labels = await page.evaluate(async () => (await window.gloom!.live.models()).map((m) => m.label))
  expect(labels).toEqual(['Default', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 5.5'])
})
