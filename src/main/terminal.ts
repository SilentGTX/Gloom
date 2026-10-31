// Opens Claude Code in a terminal window: Resume in Terminal (`claude --resume
// <id>` in the session's working folder), and the CLI's own login and update,
// which want a terminal to talk in. Windows picks the terminal app it uses for
// console windows, so Windows Terminal opens if it's your default.
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { ResumeResult } from '@shared/ipc'
import type { SessionMeta } from '@shared/library'
import { findClaude } from './claude/binary'
import { systemExe } from './exec'

/** Claude Code's session IDs are UUIDs; nothing else goes on a command line. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const POWERSHELL = systemExe('WindowsPowerShell\\v1.0\\powershell.exe')

/**
 * Runs `claude <args>` in a new console window, in `cwd`. The folder and
 * claude's path reach PowerShell through the environment, never through the
 * script's text: PowerShell ends a quoted string at curly quotes too, so a
 * folder named O’Brien would have closed it, and the rest run as a command.
 */
function openTerminal(cwd: string, args: string): void {
  // A hidden PowerShell asks Windows for a new console window running another one, which inherits these.
  const launch = `Start-Process -FilePath $env:GLOOM_POWERSHELL -WorkingDirectory $env:GLOOM_CWD -ArgumentList '-NoExit', '-Command', '& $env:GLOOM_CLAUDE ${args}'`
  const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', launch], {
    windowsHide: true,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, GLOOM_POWERSHELL: POWERSHELL, GLOOM_CWD: cwd, GLOOM_CLAUDE: findClaude({ forTerminal: true }) ?? '' }
  })
  child.on('error', (error) => console.error('Gloom: opening a terminal:', error))
  child.unref()
}

const isFolder = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Opens the session in a terminal window; with `check`, only says whether it could. */
export function resumeInTerminal(session: SessionMeta, { check = false } = {}): ResumeResult {
  if (session.remote) return { ok: false, reason: 'It ran on another machine.' }
  if (!SESSION_ID.test(session.id)) return { ok: false, reason: 'Claude Code can’t resume this session.' }
  const cwd = session.cwd
  if (!cwd || !isFolder(cwd)) return { ok: false, reason: 'Its working folder no longer exists.' }
  const claude = findClaude({ forTerminal: true })
  if (!claude) return { ok: false, reason: 'Claude Code isn’t installed.' }
  const args = `--resume ${session.id}`
  const command = `& '${claude}' ${args}`
  if (check || process.env.GLOOM_RESUME_DRY_RUN === '1') return { ok: true, command }
  openTerminal(cwd, args)
  return { ok: true, command }
}

/** `claude auth login` or `claude update`, in a terminal window, so you can see and answer it. */
export function claudeInTerminal(what: 'login' | 'update'): boolean {
  if (!findClaude({ forTerminal: true })) return false
  openTerminal(homedir(), what === 'login' ? 'auth login' : 'update')
  return true
}
