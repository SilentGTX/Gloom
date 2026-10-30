// Shared helpers for the Phase 0 SDK spike: locating claude.exe, a clean
// environment, sandbox folders, and a spawn hook that records the raw
// stream-json traffic so the fake claude can replay it later.
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  SpawnOptions,
  SpawnedProcess
} from '@anthropic-ai/claude-agent-sdk'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(here, '..', '..')
export const fixturesDir = join(repoRoot, 'tools', 'fake-claude', 'fixtures')
export const resultsDir = join(here, 'results')
export const sandboxRoot = join(tmpdir(), 'gloom-spike')

/** The user's own CLI, overridable for comparing against the SDK's bundled build. */
export const claudeExe =
  process.env.GLOOM_CLAUDE_EXE ?? join(homedir(), '.local', 'bin', 'claude.exe')

/** Suffix for fixture, result and sandbox names, so runs on another CLI build don't overwrite. */
export const tag = process.env.GLOOM_SPIKE_TAG ? `-${process.env.GLOOM_SPIKE_TAG}` : ''

/** Model used for every check unless one needs another: cheapest on plan usage. */
export const cheapModel = process.env.GLOOM_SPIKE_MODEL ?? 'haiku'

/**
 * Gloom is launched from Explorer, so it never sees the variables the Claude
 * app injects into this shell (CLAUDECODE, CLAUDE_CODE_*, MCP_*). The registry
 * holds none of them on this PC, so drop them all.
 */
export function cleanEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC_BASE_URL$|MCP_)/i.test(key)) continue
    env[key] = value
  }
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'gloom-spike/0.0.0'
  // The Claude app sets this for its sessions; newer CLIs leave AskUserQuestion out without it.
  if (process.env.GLOOM_SPIKE_ASK_TOOL === '1') env.CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL = 'true'
  return env
}

export function sandbox(name: string, opts: { fresh?: boolean } = {}): string {
  const dir = join(sandboxRoot, name + tag)
  if (opts.fresh && existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

const email = process.env.CLAUDE_CODE_USER_EMAIL
const secrets = [email, process.env.CLAUDE_CODE_ACCOUNT_UUID, process.env.CLAUDE_CODE_ORGANIZATION_UUID]
  .filter((s): s is string => !!s && s.length > 4)

/** Fixtures go into a private repo, but still keep account identifiers out. */
export function scrub(text: string): string {
  let out = text
  for (const secret of secrets) out = out.split(secret).join(secret.includes('@') ? 'user@example.com' : '00000000-0000-0000-0000-000000000000')
  return out
}

export type RecordedEvent =
  | { t: number; dir: 'spawn'; args: string[]; cwd?: string }
  | { t: number; dir: 'in' | 'out'; msg: unknown }
  | { t: number; dir: 'in-end' }
  | { t: number; dir: 'err'; text: string }
  | { t: number; dir: 'exit'; code: number | null; signal: string | null }

/**
 * A `spawnClaudeCodeProcess` that runs the real CLI and appends both directions
 * of the stream to `fixtures/<name>.jsonl`. Several spawns (resume checks) go
 * into the same file, one `spawn` event each.
 */
export function recordingSpawn(name: string, onSpawn?: (pid: number | undefined) => void) {
  mkdirSync(fixturesDir, { recursive: true })
  const file = fixtureFile(name)
  writeFileSync(file, '')
  const log = createWriteStream(file, { flags: 'a' })
  const write = (event: RecordedEvent) => log.write(scrub(JSON.stringify(event)) + '\n')

  return (options: SpawnOptions): SpawnedProcess => {
    const started = Date.now()
    const t = () => Date.now() - started
    write({ t: 0, dir: 'spawn', args: options.args, cwd: options.cwd })
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    onSpawn?.(child.pid)

    const stdin = new PassThrough()
    let inBuf = ''
    stdin.on('data', (chunk: Buffer) => {
      inBuf += chunk.toString('utf8')
      let nl: number
      while ((nl = inBuf.indexOf('\n')) >= 0) {
        const line = inBuf.slice(0, nl)
        inBuf = inBuf.slice(nl + 1)
        if (line.trim()) write({ t: t(), dir: 'in', msg: parse(line) })
      }
    })
    stdin.on('end', () => write({ t: t(), dir: 'in-end' }))
    stdin.pipe(child.stdin!)

    let outBuf = ''
    child.stdout!.on('data', (chunk: Buffer) => {
      outBuf += chunk.toString('utf8')
      let nl: number
      while ((nl = outBuf.indexOf('\n')) >= 0) {
        const line = outBuf.slice(0, nl)
        outBuf = outBuf.slice(nl + 1)
        if (line.trim()) write({ t: t(), dir: 'out', msg: parse(line) })
      }
    })
    child.stderr!.on('data', (chunk: Buffer) => write({ t: t(), dir: 'err', text: chunk.toString('utf8') }))
    child.on('exit', (code, signal) => write({ t: t(), dir: 'exit', code, signal }))
    options.signal.addEventListener('abort', () => {
      if (child.exitCode === null) child.kill()
    })

    const proc: SpawnedProcess = {
      stdin,
      stdout: child.stdout!,
      get killed() {
        return child.killed
      },
      get exitCode() {
        return child.exitCode
      },
      get signalCode() {
        return child.signalCode
      },
      kill: (signal) => child.kill(signal),
      on: (event: 'exit' | 'error', listener: (...args: any[]) => void) => void child.on(event, listener),
      once: (event: 'exit' | 'error', listener: (...args: any[]) => void) => void child.once(event, listener),
      off: (event: 'exit' | 'error', listener: (...args: any[]) => void) => void child.off(event, listener)
    } as SpawnedProcess
    return proc
  }
}

export function fixtureFile(name: string): string {
  return join(fixturesDir, `${name}${tag}.jsonl`)
}

function parse(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return line
  }
}

/** Options every check shares: the plan's Claude-Code-like setup plus recording. */
export function baseOptions(fixture: string, extra: Partial<Options> = {}): Options {
  return {
    pathToClaudeCodeExecutable: claudeExe,
    env: cleanEnv(),
    settingSources: ['user', 'project', 'local'],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    includePartialMessages: true,
    allowDangerouslySkipPermissions: true,
    model: cheapModel,
    // A check that passes its own spawn (or undefined, for the SDK's) records nothing.
    ...('spawnClaudeCodeProcess' in extra ? {} : { spawnClaudeCodeProcess: recordingSpawn(fixture) }),
    stderr: (data) => process.stderr.write(`[cli stderr] ${data}`),
    ...extra
  }
}

/** A push-driven prompt stream for streaming-input mode. */
export class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private closed = false

  send(text: string, extra: Partial<SDKUserMessage> = {}): SDKUserMessage {
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      uuid: crypto.randomUUID() as SDKUserMessage['uuid'],
      ...extra
    }
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w({ value: msg, done: false })
    } else this.queue.push(msg)
    return msg
  }

  close() {
    this.closed = true
    if (this.waiting) this.waiting({ value: undefined as never, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const next = this.queue.shift()
        if (next) return Promise.resolve({ value: next, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true })
        return new Promise((resolve) => (this.waiting = resolve))
      }
    }
  }
}

/**
 * Pumps a Query in the background, keeping every message, and lets a check
 * wait for the next message that matches a predicate.
 */
export class Pump {
  readonly messages: SDKMessage[] = []
  /** performance.now() at which each message arrived, parallel to `messages`. */
  readonly at: number[] = []
  private waiters: {
    pred: (m: SDKMessage) => boolean
    resolve: (m: SDKMessage) => void
    reject: (e: unknown) => void
    from: number
  }[] = []
  /** Settles when the stream ends; never rejects (a dead CLI is kept in `error`). */
  readonly done: Promise<void>
  /** Why the stream ended early, e.g. "Claude Code process exited with code 1". */
  error: unknown = null
  private ended = false
  private cursor = 0

  constructor(readonly q: Query, private log = false) {
    this.done = (async () => {
      try {
        for await (const m of q) {
          this.messages.push(m)
          this.at.push(performance.now())
          if (this.log) logMessage(m)
          const idx = this.messages.length - 1
          this.waiters = this.waiters.filter((w) => {
            if (idx >= w.from && w.pred(m)) {
              w.resolve(m)
              return false
            }
            return true
          })
        }
      } catch (e) {
        this.error = e
      } finally {
        this.ended = true
        const reason = this.error ?? new Error('the stream ended before a matching message')
        for (const w of this.waiters) w.reject(reason)
        this.waiters = []
      }
    })()
  }

  /** Resolves with the first message after the last `mark()` that matches. */
  waitFor<T extends SDKMessage>(pred: (m: SDKMessage) => boolean, timeoutMs = 180_000): Promise<T> {
    const from = this.cursor
    const hit = this.messages.slice(from).find(pred)
    if (hit) return Promise.resolve(hit as T)
    if (this.ended) return Promise.reject(this.error ?? new Error('the stream ended before a matching message'))
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting (${timeoutMs} ms)`)), timeoutMs)
      timer.unref()
      this.waiters.push({
        pred,
        from,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
    })
  }

  /** Later waits only look at messages that arrive after this point. */
  mark() {
    this.cursor = this.messages.length
  }

  result() {
    return this.waitFor<Extract<SDKMessage, { type: 'result' }>>((m) => m.type === 'result')
  }

  /** Arrival time of the first message matching `pred`, relative to `since`. */
  timeOf(pred: (m: SDKMessage) => boolean, since: number): number | null {
    const i = this.messages.findIndex(pred)
    return i < 0 ? null : Math.round(this.at[i] - since)
  }
}

export function logMessage(m: SDKMessage) {
  if (m.type === 'stream_event') return
  const brief = JSON.stringify(m).slice(0, 220)
  console.log(`  · ${m.type}${'subtype' in m && m.subtype ? '/' + m.subtype : ''} ${brief}`)
}

export function textOf(m: SDKMessage): string {
  if (m.type !== 'assistant') return ''
  return m.message.content
    .map((b: any) => (b.type === 'text' ? b.text : ''))
    .join('')
}

export function projectDirFor(cwd: string): string {
  // Claude Code's folder naming: every non-alphanumeric character becomes '-'.
  return join(homedir(), '.claude', 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'))
}
