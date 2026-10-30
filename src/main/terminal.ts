// Resume in Terminal: opens a session in a new terminal window, running
// `claude --resume <id>` in its working folder, so you can carry on there until
// Gloom sends messages itself (Phase 4). Windows picks the terminal app it uses
// for console windows, so Windows Terminal opens if it's your default.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { ResumeResult } from '@shared/ipc'
import type { SessionMeta } from '@shared/library'

/** Claude Code's session IDs are UUIDs; nothing else goes on a command line. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Your claude.exe: the native installer's, else the first one on PATH. */
export function findClaude(): string | null {
  const local = join(homedir(), '.local', 'bin', 'claude.exe')
  if (existsSync(local)) return local
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const name of ['claude.exe', 'claude.cmd']) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

/** A PowerShell single-quoted string: nothing inside is expanded. */
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

/** Opens the session in a terminal window; with `check`, only says whether it could. */
export function resumeInTerminal(session: SessionMeta, { check = false } = {}): ResumeResult {
  if (session.remote) return { ok: false, reason: 'It ran on another machine.' }
  if (!SESSION_ID.test(session.id)) return { ok: false, reason: 'Claude Code can’t resume this session.' }
  const cwd = session.cwd
  if (!cwd || !existsSync(cwd)) return { ok: false, reason: 'Its working folder no longer exists.' }
  const claude = findClaude()
  if (!claude) return { ok: false, reason: 'Claude Code isn’t installed.' }
  const command = `& ${quote(claude)} --resume ${session.id}`
  if (check || process.env.GLOOM_RESUME_DRY_RUN === '1') return { ok: true, command }
  // A hidden PowerShell asks Windows for a new console window running another one.
  const launch = `Start-Process -FilePath powershell.exe -WorkingDirectory ${quote(cwd)} -ArgumentList '-NoExit', '-Command', ${quote(command)}`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', launch], { windowsHide: true, stdio: 'ignore', detached: true })
  child.on('error', (error) => console.error('Gloom: Resume in Terminal:', error))
  child.unref()
  return { ok: true, command }
}
