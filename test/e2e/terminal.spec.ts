import { expect, test } from '@playwright/test'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { launch, triggerShortcut } from './app'

// Update Claude Code…, Log In… and Resume in Terminal open a console window
// running claude (src/main/terminal.ts). Here the window stays hidden
// (GLOOM_TERMINAL_HIDDEN) and Windows' own whoami stands in for claude, so
// nothing shows and nothing updates. Until 0.12.1 the window never opened at
// all, and no test noticed: Resume in Terminal is a dry run everywhere else.
const powershell = (script: string) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })

/** The process IDs of PowerShell windows running `claude <args>`, as terminal.ts starts them. */
const terminals = (args: string): string[] =>
  // Not this PowerShell, whose own command line holds the pattern.
  powershell(`Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | ? { $_.CommandLine -like '*-NoExit -Command & $env:GLOOM_CLAUDE ${args}*' -and $_.ProcessId -ne $PID } | % { $_.ProcessId }`)
    .split(/\s+/)
    .filter(Boolean)

test('Update Claude Code… opens claude update in a terminal window', async () => {
  const saved = { exe: process.env.GLOOM_CLAUDE_EXE, hidden: process.env.GLOOM_TERMINAL_HIDDEN }
  process.env.GLOOM_CLAUDE_EXE = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'whoami.exe')
  process.env.GLOOM_TERMINAL_HIDDEN = '1'
  const before = new Set(terminals('update'))
  const { app, page } = await launch()
  try {
    await triggerShortcut(app, 'CmdOrCtrl+,')
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('radio', { name: 'Claude Code' }).click()
    await settings.getByRole('button', { name: 'Update Claude Code…' }).click()
    await expect.poll(() => terminals('update').filter((pid) => !before.has(pid)).length, { timeout: 15_000 }).toBe(1)
  } finally {
    for (const pid of terminals('update')) if (!before.has(pid)) spawnSync('taskkill', ['/pid', pid, '/T', '/F'], { windowsHide: true })
    process.env.GLOOM_CLAUDE_EXE = saved.exe
    process.env.GLOOM_TERMINAL_HIDDEN = saved.hidden
    if (saved.exe === undefined) delete process.env.GLOOM_CLAUDE_EXE
    if (saved.hidden === undefined) delete process.env.GLOOM_TERMINAL_HIDDEN
    await app.close()
  }
})
