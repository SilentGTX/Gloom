// Phase 6: rewind and edit, and worktree sessions. The fake claude answers
// Claude Code's checkpoint questions from the rewind-resume recording, so a
// rewind's code preview is the one the real CLI gave (one file, +1 −2).
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { demoSession, DEMO_TITLE } from '../support/demo'
import { fakeClaude, launch, openGroup, sessionRow, setWindowSize, tempDir, triggerShortcut } from './app'

const FAKE = join(__dirname, '..', '..', 'tools', 'fake-claude', 'fake-claude.mjs')
const screens = join(__dirname, '..', '..', 'test-screens')

let app: ElectronApplication
let page: Page
test.afterEach(async () => app?.close())

async function openDemo() {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = 'rewind-resume-b'
  process.env.FAKE_CLAUDE_SPEED = '0'
  const cwd = tempDir('gloom-project-')
  const claudeDir = fakeClaude([])
  demoSession(cwd).write(join(claudeDir, 'projects'))
  ;({ app, page } = await launch({ claudeDir }))
  await setWindowSize(app, 1280, 900)
  await openGroup(page, 'All Sessions')
  await sessionRow(page, DEMO_TITLE).click()
  const transcript = page.getByLabel('Transcript')
  await expect(transcript.getByText('Teams now get')).toBeInViewport()
  return { cwd, transcript }
}

const lastPrompt = 'Go on, but keep the docs short.'

test('Rewind to Here: the conversation goes back to before your message, which returns to the composer, and Undo brings it back', async () => {
  const { transcript } = await openDemo()
  const bubble = transcript.getByText(lastPrompt)
  await bubble.hover()
  await transcript.getByRole('button', { name: 'Rewind to before this message' }).last().click()

  const sheet = page.getByRole('dialog', { name: 'Rewind to before this message?' })
  await expect(sheet.getByText('Code: 1 file, +1 −2')).toBeVisible({ timeout: 20_000 })
  await expect(sheet.getByRole('radio', { name: /Conversation and Code/ })).toBeChecked()
  mkdirSync(screens, { recursive: true })
  await page.screenshot({ path: join(screens, 'rewind-sheet.png') })
  await sheet.getByRole('radio', { name: /Conversation Only/ }).check()
  await sheet.getByRole('button', { name: 'Rewind' }).click()

  await expect(sheet).toHaveCount(0)
  // The message and what came after it are gone from view; your words are back in the composer.
  await expect(transcript.getByText(lastPrompt)).toHaveCount(0)
  await expect(transcript.getByText('Teams now get')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(lastPrompt)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(transcript.getByText(lastPrompt)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('')
})

test('Edit puts your message in the composer with what sending will do; Esc gives the draft back', async () => {
  await openDemo()
  const composer = page.getByRole('textbox', { name: 'Message' })
  await composer.fill('something half written')
  const transcript = page.getByLabel('Transcript')
  await transcript.getByText(lastPrompt).hover()
  await transcript.getByRole('button', { name: 'Edit this message' }).last().click()

  await expect(composer).toHaveValue(lastPrompt)
  await expect(composer).toBeFocused()
  const banner = page.getByRole('status').filter({ hasText: 'Editing your message' })
  await expect(banner).toBeVisible()
  // Claude Code says what code could go back with it.
  await expect(banner.getByRole('checkbox', { name: /Also restore the code Claude changed after it \(1 file/ })).toBeChecked({ timeout: 20_000 })
  await page.screenshot({ path: join(screens, 'edit-banner.png') })

  await composer.press('Escape')
  await expect(banner).toHaveCount(0)
  await expect(composer).toHaveValue('something half written')
})

test('a new session in a git repository works in a worktree of its own, with its branch and Merge in the toolbar', async () => {
  process.env.GLOOM_CLAUDE_EXE = FAKE
  process.env.FAKE_CLAUDE_FIXTURE = 'two-turns'
  process.env.FAKE_CLAUDE_SPEED = '0'
  const repoDir = tempDir('gloom-repo-')
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=gloom@example.com', '-c', 'user.name=Gloom', ...args], { cwd: repoDir, windowsHide: true })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repoDir, 'README.md'), '# Repo\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  // An earlier session there makes the repository a recent (and trusted) working folder, which New Session starts with.
  const earlier = { id: 'abababab-0000-4000-8000-000000000001', cwd: repoDir, prompt: 'Look around', title: 'Earlier work' }
  ;({ app, page } = await launch({ claudeDir: fakeClaude([earlier]) }))
  await setWindowSize(app, 1280, 900)
  await expect(sessionRow(page, 'Earlier work')).toHaveCount(0)
  await triggerShortcut(app, 'CmdOrCtrl+N')
  // The repository is where it runs, and under the composer Worktree is on.
  await expect(page.getByRole('button', { name: /^Environment: / })).toContainText(repoDir.split(/[\\/]/).pop()!)
  await expect(page.getByRole('button', { name: 'Worktree', pressed: true })).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: join(screens, 'new-session-worktree.png') })
  // Nothing's made until the first message goes; then it runs on a branch of its own.
  const composer = page.getByRole('textbox', { name: 'Message' })
  await composer.fill('Reply with just: OK')
  await composer.press('Enter')

  const toolbar = page.locator('main header')
  await expect(toolbar.getByText(/^claude\/[a-z]+-[a-z]+$/)).toBeVisible({ timeout: 15_000 })
  await toolbar.getByRole('button', { name: 'Merge' }).click()
  const merge = page.getByRole('dialog', { name: /Merge claude\/.* into main\?/ })
  await expect(merge.getByText(/has nothing main doesn’t have yet/)).toBeVisible()
  await expect(merge.getByRole('button', { name: 'Merge' })).toBeDisabled()
  await page.screenshot({ path: join(screens, 'merge-sheet.png') })
})
