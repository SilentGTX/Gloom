// The model list follows your Claude Code: kept from a CLI before an update, it's
// asked again at launch, from a process sent no message (no turn, no usage).
// Against your real claude.exe, so it only runs when asked:
//   GLOOM_REAL_CLI=1 npx playwright test test/e2e/models.spec.ts
import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, tempDir } from './app'

test.skip(!process.env.GLOOM_REAL_CLI, 'set GLOOM_REAL_CLI=1 to ask your real claude.exe')

test('a list kept from an older CLI is replaced at launch by what the installed one offers', async () => {
  delete process.env.GLOOM_CLAUDE_EXE
  // As Gloom 0.13.1 and earlier kept it: a list from the CLI before an update, and no version beside it.
  const userData = tempDir('gloom-models-profile-')
  const old = [
    { value: 'default', label: 'Default (recommended)', description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks', efforts: ['low', 'medium', 'high'] },
    { value: 'sonnet', label: 'Sonnet', description: 'Sonnet 4.6 · Efficient for routine tasks', efforts: ['low', 'medium', 'high'] }
  ]
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ settings: {}, models: old }))
  // Your own Claude Code folder, so the CLI answers for your account (Gloom only reads it).
  const claudeDir = join(process.env.USERPROFILE ?? '', '.claude')
  const { app, page } = await launch({ userData, claudeDir, askClaude: true })
  try {
    const described = () => page.evaluate(async () => (await window.gloom!.live.models()).map((m) => `${m.label}: ${m.description}`))
    await expect.poll(described, { timeout: 60_000 }).not.toContain(`Default (recommended): ${old[0].description}`)
    const now = await described()
    console.log(now.join('\n'))
    expect(now.some((m) => /5\.5/.test(m))).toBe(true)
  } finally {
    await app.close()
  }
})
