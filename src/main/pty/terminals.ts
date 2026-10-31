// The terminal pane's shells: node-pty (Windows' ConPTY underneath), one per
// tab. Output is batched a few milliseconds at a time for the window, and kept
// (the last part of it) so a window that reloads catches up. A window busy
// drawing a flood of output says how far it got; past a high-water mark the
// shell is paused until it catches up, as VS Code's terminal does. Closing a
// tab, or quitting, ends the shell and everything it started.
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { delimiter, dirname, join } from 'node:path'
import type { IPty } from 'node-pty'
import { SHELL_IDS, type ShellId, type ShellInfo, type TerminalAttach, type TerminalData, type TerminalExit, type TerminalInfo } from '@shared/terminal'
import { killTree } from '../claude/runner'

/** Output waits this long for more before it goes to the window. */
const BATCH_MS = 5
/** Characters kept per terminal for a window that reloads. */
const KEEP = 256 * 1024
/** Unacknowledged output past this pauses the shell; below the low mark it resumes. */
const HIGH_WATER = 2 * 1024 * 1024
const LOW_WATER = 256 * 1024

export interface TerminalEvents {
  data(data: TerminalData): void
  exit(exit: TerminalExit): void
}

interface Term {
  info: TerminalInfo
  proc: IPty | null
  kept: string[]
  keptLength: number
  /** Every character written so far. */
  seq: number
  pending: string
  timer: ReturnType<typeof setTimeout> | null
  /** Written to the window and not yet drawn there. */
  unacked: number
  paused: boolean
  /** A window has caught up with it, so its acknowledgements count. */
  attached: boolean
}

let ptyModule: typeof import('node-pty') | null = null

/** Loaded on first use, so a broken native module fails a terminal, not Gloom. */
function nodePty(): typeof import('node-pty') {
  ptyModule ??= require('node-pty') as typeof import('node-pty')
  return ptyModule
}

function onPath(exe: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir.replace(/^"|"$/g, ''), exe)
    if (existsSync(candidate)) return candidate
  }
  return null
}

const first = (...paths: (string | null | undefined)[]) => paths.find((p): p is string => !!p && existsSync(p)) ?? null

/** The shells installed here, in the order Settings lists them. */
export function findShells(): ShellInfo[] {
  const system = process.env.SystemRoot ?? 'C:\\Windows'
  const programs = process.env.ProgramFiles ?? 'C:\\Program Files'
  const git = onPath('git.exe')
  const found: Record<ShellId, Omit<ShellInfo, 'id'> | null> = {
    powershell: pathOr(first(join(system, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')), 'Windows PowerShell', 'PowerShell'),
    pwsh: pathOr(first(onPath('pwsh.exe'), join(programs, 'PowerShell', '7', 'pwsh.exe')), 'PowerShell 7', 'pwsh'),
    cmd: pathOr(first(process.env.ComSpec, join(system, 'System32', 'cmd.exe')), 'Command Prompt', 'cmd'),
    gitbash: pathOr(
      first(
        join(programs, 'Git', 'bin', 'bash.exe'),
        process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)']!, 'Git', 'bin', 'bash.exe'),
        process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
        // git.exe lives in <Git>\cmd; its bash in <Git>\bin.
        git && join(dirname(dirname(git)), 'bin', 'bash.exe')
      ),
      'Git Bash',
      'bash'
    )
  }
  return SHELL_IDS.flatMap((id) => (found[id] ? [{ id, ...found[id] }] : []))
}

function pathOr(path: string | null, label: string, short: string): Omit<ShellInfo, 'id'> | null {
  return path ? { label, short, path } : null
}

const ARGS: Record<ShellId, string[]> = {
  powershell: ['-NoLogo'],
  pwsh: ['-NoLogo'],
  cmd: [],
  gitbash: ['--login', '-i']
}

export class Terminals {
  private readonly terms = new Map<string, Term>()
  private shellList: ShellInfo[] | null = null

  constructor(private readonly events: TerminalEvents) {}

  shells(): ShellInfo[] {
    this.shellList ??= findShells()
    return this.shellList
  }

  list(): TerminalInfo[] {
    return [...this.terms.values()].map((t) => t.info)
  }

  /** A new shell in `cwd`: the one asked for if it's installed, else the first that is. */
  create(cwd: string, want: ShellId, cols: number, rows: number): TerminalInfo {
    const shells = this.shells()
    const shell = shells.find((s) => s.id === want) ?? shells[0]
    if (!shell) throw new Error('No shell was found on this PC.')
    if (!existsSync(cwd)) throw new Error('That folder no longer exists.')
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('ELECTRON_')) env[k] = v
    env.TERM_PROGRAM = 'Gloom'
    env.COLORTERM = 'truecolor'
    const proc = nodePty().spawn(shell.path, ARGS[shell.id], { name: 'xterm-256color', cols, rows, cwd, env })
    const info: TerminalInfo = { id: randomUUID(), cwd, shell: shell.id, short: shell.short, created: Date.now(), exitCode: null }
    const term: Term = { info, proc, kept: [], keptLength: 0, seq: 0, pending: '', timer: null, unacked: 0, paused: false, attached: false }
    this.terms.set(info.id, term)
    proc.onData((data) => {
      term.pending += data
      term.timer ??= setTimeout(() => this.flush(term), BATCH_MS)
    })
    proc.onExit(({ exitCode }) => {
      this.flush(term)
      term.proc = null
      term.info = { ...term.info, exitCode }
      this.events.exit({ id: info.id, code: exitCode })
    })
    return info
  }

  /** A window catching up: the output kept so far; from here on, its acknowledgements count. */
  attach(id: string): TerminalAttach {
    const term = this.get(id)
    this.flush(term)
    term.attached = true
    term.unacked = 0
    this.resume(term)
    return { data: term.kept.join(''), seq: term.seq, exitCode: term.info.exitCode }
  }

  input(id: string, data: string): void {
    this.terms.get(id)?.proc?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const proc = this.terms.get(id)?.proc
    try {
      proc?.resize(cols, rows)
    } catch {
      // Ended a moment ago.
    }
  }

  /** The window drew this much of what it was sent. */
  ack(id: string, chars: number): void {
    const term = this.terms.get(id)
    if (!term) return
    term.unacked = Math.max(0, term.unacked - chars)
    if (term.unacked < LOW_WATER) this.resume(term)
  }

  /** Ends the shell and what it started (taskkill /T: ConPTY would end the shell alone), and forgets the terminal. */
  close(id: string): void {
    const term = this.terms.get(id)
    if (!term) return
    this.terms.delete(id)
    if (term.timer) clearTimeout(term.timer)
    if (term.proc) killTree(term.proc.pid)
  }

  /** Quitting: every shell's process tree, now. */
  closeAll(): void {
    for (const term of this.terms.values()) {
      if (term.timer) clearTimeout(term.timer)
      if (term.proc) killTree(term.proc.pid, true)
    }
    this.terms.clear()
  }

  private get(id: string): Term {
    const term = this.terms.get(id)
    if (!term) throw new Error('That terminal has closed.')
    return term
  }

  private flush(term: Term): void {
    if (term.timer) clearTimeout(term.timer)
    term.timer = null
    if (!term.pending || !this.terms.has(term.info.id)) return
    const data = term.pending
    term.pending = ''
    term.seq += data.length
    term.kept.push(data)
    term.keptLength += data.length
    while (term.keptLength > KEEP && term.kept.length > 1) term.keptLength -= term.kept.shift()!.length
    this.events.data({ id: term.info.id, data, seq: term.seq })
    if (!term.attached) return
    term.unacked += data.length
    if (term.unacked > HIGH_WATER && !term.paused && term.proc) {
      term.paused = true
      term.proc.pause()
    }
  }

  private resume(term: Term): void {
    if (!term.paused) return
    term.paused = false
    term.proc?.resume()
  }
}
