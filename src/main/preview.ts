// Dev servers for the Browser pane, from the project's .claude/launch.json, as
// the Claude app reads it: { version, configurations: [{ name,
// runtimeExecutable, runtimeArgs, port, url? }] }. A server starts in the
// session's folder with its output kept for Claude to read; once its port
// answers, the Browser pane opens it. Quitting ends every one, with what it
// started.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { connect } from 'node:net'
import { extname, join } from 'node:path'
import { killTree } from './claude/runner'
import { onPath } from './exec'

export interface LaunchConfig {
  name: string
  runtimeExecutable: string
  runtimeArgs: string[]
  port: number | null
  url: string | null
  cwd: string | null
}

export interface PreviewServer {
  id: string
  name: string
  cwd: string
  url: string | null
  status: 'starting' | 'running' | 'exited' | 'failed'
  exitCode: number | null
  started: number
}

/** Output kept per server. */
const LOG_KEEP = 2000
/** How long a server may take to answer on its port. */
const READY_MS = 90_000

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The project's launch configurations, or why there are none. */
export function readLaunch(cwd: string): { configs: LaunchConfig[]; file: string; problem: string | null } {
  const file = join(cwd, '.claude', 'launch.json')
  if (!existsSync(file)) return { configs: [], file, problem: null }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
    const list = isObj(raw) && Array.isArray(raw.configurations) ? raw.configurations : []
    const configs = list.filter(isObj).flatMap((c): LaunchConfig[] => {
      const url = typeof c.url === 'string' && /^https?:\/\//i.test(c.url) ? c.url : null
      const executable = typeof c.runtimeExecutable === 'string' ? c.runtimeExecutable : ''
      if (typeof c.name !== 'string' || !c.name.trim() || (!executable && !url)) return []
      return [
        {
          name: c.name.trim(),
          runtimeExecutable: executable,
          runtimeArgs: Array.isArray(c.runtimeArgs) ? c.runtimeArgs.filter((a): a is string => typeof a === 'string') : [],
          port: typeof c.port === 'number' && Number.isInteger(c.port) && c.port > 0 && c.port < 65536 ? c.port : null,
          url,
          cwd: typeof c.cwd === 'string' ? c.cwd : null
        }
      ]
    })
    return { configs, file, problem: null }
  } catch (error) {
    return { configs: [], file, problem: `launch.json couldn’t be read: ${(error as Error).message}` }
  }
}

/** Whether something answers on localhost:port. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

/** A program to start: npm and friends are .cmd files on Windows, run through cmd. */
function command(executable: string, args: string[]): { file: string; args: string[] } {
  if (/[\\/]/.test(executable) && existsSync(executable)) {
    return /\.(cmd|bat)$/i.test(executable) ? { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', executable, ...args] } : { file: executable, args }
  }
  const exe = extname(executable) ? onPath(executable) : (onPath(`${executable}.exe`) ?? null)
  if (exe) return { file: exe, args }
  const script = onPath(`${executable}.cmd`) ?? onPath(`${executable}.bat`)
  if (script) return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', script, ...args] }
  throw new Error(`“${executable}” wasn’t found on PATH.`)
}

export class PreviewServers {
  private readonly servers = new Map<string, { info: PreviewServer; proc: ChildProcess | null; log: string[] }>()

  constructor(private readonly changed: (server: PreviewServer) => void) {}

  list(cwd?: string): PreviewServer[] {
    return [...this.servers.values()].map((s) => s.info).filter((s) => !cwd || s.cwd.toLowerCase() === cwd.toLowerCase())
  }

  /** Starts a configuration (or finds it running); resolves once its port answers, or it ends. */
  async start(cwd: string, name: string): Promise<PreviewServer> {
    const { configs, problem } = readLaunch(cwd)
    if (problem) throw new Error(problem)
    const config = configs.find((c) => c.name === name)
    if (!config) throw new Error(configs.length ? `No configuration named “${name}” in .claude/launch.json (${configs.map((c) => c.name).join(', ')}).` : 'This project has no .claude/launch.json.')
    const id = `${cwd.toLowerCase()}::${name}`
    const running = this.servers.get(id)
    if (running && (running.info.status === 'running' || running.info.status === 'starting')) return running.info
    const url = config.url ?? (config.port ? `http://localhost:${config.port}` : null)
    const info: PreviewServer = { id, name, cwd, url, status: 'starting', exitCode: null, started: Date.now() }
    const entry = { info, proc: null as ChildProcess | null, log: [] as string[] }
    this.servers.set(id, entry)
    if (!config.runtimeExecutable) {
      // A configuration that only names a URL: something else serves it.
      entry.info = { ...info, status: 'running' }
      this.changed(entry.info)
      return entry.info
    }
    const { file, args } = command(config.runtimeExecutable, config.runtimeArgs)
    const proc = spawn(file, args, { cwd: config.cwd ? join(cwd, config.cwd) : cwd, env: { ...process.env, FORCE_COLOR: '0', BROWSER: 'none' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    entry.proc = proc
    const keep = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) if (line) entry.log.push(line.slice(0, 2000))
      if (entry.log.length > LOG_KEEP) entry.log.splice(0, entry.log.length - LOG_KEEP)
    }
    proc.stdout?.on('data', keep)
    proc.stderr?.on('data', keep)
    proc.on('exit', (code) => {
      entry.info = { ...entry.info, status: code === 0 || entry.info.status === 'running' ? 'exited' : 'failed', exitCode: code }
      entry.proc = null
      this.changed(entry.info)
    })
    proc.on('error', (error) => {
      entry.log.push(String(error))
      entry.info = { ...entry.info, status: 'failed' }
      this.changed(entry.info)
    })
    this.changed(info)
    if (config.port) {
      const started = Date.now()
      while (Date.now() - started < READY_MS && entry.proc && !(await answers(config.port))) await new Promise((r) => setTimeout(r, 500))
    }
    if (entry.proc) {
      entry.info = { ...entry.info, status: 'running' }
      this.changed(entry.info)
    }
    return entry.info
  }

  stop(id: string): void {
    const entry = this.servers.get(id)
    if (!entry) return
    if (entry.proc?.pid) killTree(entry.proc.pid)
    entry.proc = null
    entry.info = { ...entry.info, status: 'exited' }
    this.changed(entry.info)
  }

  logs(id: string, lines: number, search?: string, errorsOnly = false): string {
    const entry = this.servers.get(id)
    if (!entry) throw new Error('No such server.')
    const picked = entry.log.filter((l) => (!search || l.includes(search)) && (!errorsOnly || /error|exception|failed|fatal/i.test(l)))
    return picked.slice(-lines).join('\n') || '(no output yet)'
  }

  stopAll(): void {
    for (const entry of this.servers.values()) if (entry.proc?.pid) killTree(entry.proc.pid, true)
  }
}
