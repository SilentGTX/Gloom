// A version hands Gloom's window over to a newer one without the window going
// away. The running version starts the new one (unpacked beside it, see
// versions.ts) and keeps its window up on the update screen until the new
// one's window has painted in the same place, on top; then it quits. The new
// version shows only the screen until the old one has gone, since two
// versions can't use Gloom's storage at once, and then loads the app under it.
import { app } from 'electron'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { connect, createServer } from 'node:net'
import { dirname } from 'node:path'

/** How long a new version may take to show its window: a first start can wait on a virus scan. */
const SHOW_WITHIN_MS = 45_000
/** How long the old version may take to quit once the new one is up. */
const QUIT_WITHIN_MS = 10_000

const pipeName = (token: string) => `\\\\.\\pipe\\gloom-handover-${token}`
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The version this one takes over from, from `--handover=<pid>:<token>`. */
export interface Takeover {
  pid: number
  token: string
}

export function parseTakeover(argv: string[]): Takeover | null {
  const match = argv.find((arg) => arg.startsWith('--handover='))?.match(/^--handover=(\d+):([\w-]+)$/)
  return match ? { pid: Number(match[1]), token: match[2] } : null
}

/** The arguments the new version starts with: this one's, but not its handover's or a debugger's. */
function passOn(): string[] {
  return process.argv.slice(1).filter((arg) => !/^--(handover|inspect|remote-debugging)/.test(arg))
}

/**
 * Starts the new version at `exe` and waits for its window. Resolves true once
 * that's up, when this version should quit; false if it didn't come up, after
 * stopping it. Call it with the window's place saved, so the new one opens there.
 */
export async function handOver(exe: string): Promise<boolean> {
  const token = randomUUID()
  let settle!: (up: boolean) => void
  const up = new Promise<boolean>((resolve) => (settle = resolve))
  const server = createServer((socket) => {
    socket.on('data', (data) => data.toString().includes('shown') && settle(true))
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipeName(token), resolve)
  })
  // The new version needs the single-instance lock to start.
  app.releaseSingleInstanceLock()
  const child = spawn(exe, [...passOn(), `--handover=${process.pid}:${token}`], { cwd: dirname(exe), detached: true, stdio: 'ignore' })
  child.unref()
  child.once('error', () => settle(false))
  child.once('exit', () => settle(false))
  const timer = setTimeout(() => settle(false), SHOW_WITHIN_MS)
  const shown = await up
  clearTimeout(timer)
  server.close()
  if (shown) return true
  // Gloom stays this version. If the new one holds the lock, it came up after all, just slowly.
  if (!app.requestSingleInstanceLock()) return true
  child.kill()
  return false
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Tells the old version this one's window is up, then waits for it to quit. */
export async function takeOver({ pid, token }: Takeover): Promise<void> {
  await new Promise<void>((resolve) => {
    const socket = connect(pipeName(token), () => socket.end('shown\n'))
    socket.once('close', () => resolve())
    socket.once('error', () => resolve())
  })
  const until = Date.now() + QUIT_WITHIN_MS
  while (running(pid)) {
    if (Date.now() > until) {
      try {
        process.kill(pid)
      } catch {
        // Gone by now.
      }
      await pause(500)
      break
    }
    await pause(50)
  }
}
