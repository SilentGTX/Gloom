// The terminal pane's shells, shared by main (node-pty) and the window (xterm).
// The pane shows the terminals opened in the open session's working folder, so
// sessions in the same folder share them.

export type ShellId = 'powershell' | 'pwsh' | 'cmd' | 'gitbash'

export const SHELL_IDS: readonly ShellId[] = ['powershell', 'pwsh', 'cmd', 'gitbash']

export const isShell = (v: unknown): v is ShellId => typeof v === 'string' && (SHELL_IDS as readonly string[]).includes(v)

/** A shell installed on this PC. */
export interface ShellInfo {
  id: ShellId
  /** "Windows PowerShell", "Git Bash". */
  label: string
  /** On a tab: "PowerShell", "bash". */
  short: string
  path: string
}

export interface TerminalInfo {
  id: string
  /** The folder it opened in. */
  cwd: string
  shell: ShellId
  short: string
  created: number
  /** Set once the shell has ended. */
  exitCode: number | null
}

/** main → window: what a shell wrote. `seq` counts every character it has written, this included. */
export interface TerminalData {
  id: string
  data: string
  seq: number
}

export interface TerminalExit {
  id: string
  code: number
}

/** What a window joining a terminal is caught up with: its recent output, up to `seq`. */
export interface TerminalAttach {
  data: string
  seq: number
  exitCode: number | null
}

/** The folder a terminal belongs to, as a key: Windows paths compare without case or a trailing slash. */
export function folderKey(path: string): string {
  const p = path.replace(/[\\/]+$/, '').replace(/\//g, '\\')
  return /^[a-z]:/i.test(p) ? p.toLowerCase() : p
}
