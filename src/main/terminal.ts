// Opens Claude Code in a terminal window: Resume in Terminal (`claude --resume
// <id>` in the session's working folder), and the CLI's own login and update,
// which want a terminal to talk in. Windows picks the terminal app it uses for
// console windows, so Windows Terminal opens if it's your default.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { ResumeResult } from '@shared/ipc'
import type { SessionMeta } from '@shared/library'
import { findClaude } from './claude/binary'

/** Claude Code's session IDs are UUIDs; nothing else goes on a command line. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A PowerShell single-quoted string: nothing inside is expanded. */
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

/** Runs `claude <args>` in a new console window, in `cwd`. */
function openTerminal(cwd: string, command: string): void {
  // A hidden PowerShell asks Windows for a new console window running another one.
  const launch = `Start-Process -FilePath powershell.exe -WorkingDirectory ${quote(cwd)} -ArgumentList '-NoExit', '-Command', ${quote(command)}`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', launch], { windowsHide: true, stdio: 'ignore', detached: true })
  child.on('error', (error) => console.error('Gloom: opening a terminal:', error))
  child.unref()
}

/** Opens the session in a terminal window; with `check`, only says whether it could. */
export function resumeInTerminal(session: SessionMeta, { check = false } = {}): ResumeResult {
  if (session.remote) return { ok: false, reason: 'It ran on another machine.' }
  if (!SESSION_ID.test(session.id)) return { ok: false, reason: 'Claude Code can’t resume this session.' }
  const cwd = session.cwd
  if (!cwd || !existsSync(cwd)) return { ok: false, reason: 'Its working folder no longer exists.' }
  const claude = findClaude({ forTerminal: true })
  if (!claude) return { ok: false, reason: 'Claude Code isn’t installed.' }
  const command = `& ${quote(claude)} --resume ${session.id}`
  if (check || process.env.GLOOM_RESUME_DRY_RUN === '1') return { ok: true, command }
  openTerminal(cwd, command)
  return { ok: true, command }
}

/** `claude auth login` or `claude update`, in a terminal window, so you can see and answer it. */
export function claudeInTerminal(what: 'login' | 'update'): boolean {
  const claude = findClaude({ forTerminal: true })
  if (!claude) return false
  openTerminal(homedir(), `& ${quote(claude)} ${what === 'login' ? 'auth login' : 'update'}`)
  return true
}
