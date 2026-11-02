// A new PC, as the Claude app does it: Claude Code comes with Gloom, and you
// sign in from Gloom. Nothing to install by hand.
//
// Claude Code: when there's no claude.exe to use (yours, or one chosen in
// Settings), Gloom downloads the one its Agent SDK was made with: the SDK's
// own platform package on npm's public registry (no login), checked against
// the registry's SHA-512, unpacked into Gloom's folder (userData/claude-code/
// <sdk version>). The installer stays small and Gloom always runs the version
// it expects.
//
// Signing in: `claude auth login` with no terminal opens your browser itself,
// prints the page's address, and takes a code on stdin when the page shows one
// instead of handing back to Claude Code (CLI 2.1.316). Gloom runs it hidden,
// shows the address and a field for the code, and asks `claude auth status`
// when it ends. The login is Claude Code's own (~/.claude), so the terminal's
// `claude` is signed in too.
import { app } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SetupState } from '@shared/ipc'
import { findClaude, managedClaude, SDK_VERSION } from './binary'

const PACKAGE = `@anthropic-ai/claude-agent-sdk-win32-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const tarExe = () => join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

let state: SetupState = { claude: 'ok', received: 0, total: 0, error: null, signedIn: null, login: null }
let listener: (state: SetupState) => void = () => {}
const set = (patch: Partial<SetupState>) => {
  state = { ...state, ...patch }
  listener(state)
}

/** Where first-run setup stands; `onChange` hears every step. */
export function setupState(): SetupState {
  return state
}
export function onSetup(onChange: (state: SetupState) => void): void {
  listener = onChange
}

/** At launch and when you come back: is there a claude.exe, and are you signed in. */
export async function checkSetup(): Promise<SetupState> {
  if (state.claude === 'downloading') return state
  // Tests never download or ask Claude Code (unless one sets GLOOM_SETUP to try this screen).
  if (process.env.GLOOM_NO_CLAUDE_ASKS && !process.env.GLOOM_SETUP) return state
  if (!findClaude()) {
    set({ claude: 'missing', signedIn: null })
    return state
  }
  const known = await signedIn()
  set({ claude: 'ok', signedIn: known })
  return state
}

/** `claude auth status --json`: null when it can't say (an old CLI, a broken one). */
function signedIn(): Promise<boolean | null> {
  const exe = findClaude()
  if (!exe) return Promise.resolve(null)
  return new Promise((resolve) =>
    execFile(exe, ['auth', 'status', '--json'], { windowsHide: true, timeout: 20_000 }, (_error, stdout) => {
      try {
        const status = JSON.parse(String(stdout)) as { loggedIn?: unknown }
        resolve(typeof status.loggedIn === 'boolean' ? status.loggedIn : null)
      } catch {
        resolve(null)
      }
    })
  )
}

let installing: Promise<void> | null = null

/** Downloads Gloom's own Claude Code (once at a time), then checks the sign-in. */
export function installClaude(): Promise<void> {
  installing ??= install()
    // Still "downloading" until Claude Code says whether you're signed in, so the screen goes straight to that.
    .then(async () => set({ signedIn: await signedIn(), claude: 'ok' }))
    .catch((error: unknown) => set({ claude: 'failed', error: error instanceof Error ? error.message : String(error) }))
    .finally(() => (installing = null))
  return installing
}

async function install(): Promise<void> {
  set({ claude: 'downloading', received: 0, total: 0, error: null })
  const meta = await fetch(`https://registry.npmjs.org/${PACKAGE.replace('/', '%2f')}/${SDK_VERSION}`)
  if (!meta.ok) throw new Error(`npm said ${meta.status} for ${PACKAGE}@${SDK_VERSION}`)
  const { dist } = (await meta.json()) as { dist?: { tarball?: string; integrity?: string } }
  const integrity = dist?.integrity?.match(/^sha512-(.+)$/)?.[1]
  if (!dist?.tarball || !integrity) throw new Error('npm didn’t say where Claude Code is, or how to check it')

  const dir = join(app.getPath('userData'), 'claude-code')
  const work = join(dir, `.download-${process.pid}`)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(work, { recursive: true })
  try {
    const tgz = join(work, 'package.tgz')
    const response = await fetch(dist.tarball)
    if (!response.ok || !response.body) throw new Error(`Couldn’t download Claude Code (${response.status})`)
    const total = Number(response.headers.get('content-length')) || 0
    const hash = createHash('sha512')
    const file = createWriteStream(tgz)
    let received = 0
    let shown = 0
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      if (!file.write(value)) await new Promise<void>((resolve) => file.once('drain', () => resolve()))
      received += value.length
      // A step the screen can show, not every chunk.
      if (received - shown > 1_000_000 || received === total) {
        shown = received
        set({ received, total })
      }
    }
    await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => (error ? reject(error) : resolve())))
    if (hash.digest('base64') !== integrity) throw new Error('The download didn’t match npm’s checksum')

    await new Promise<void>((resolve, reject) =>
      execFile(tarExe(), ['-xzf', tgz, '-C', work, 'package/claude.exe'], { windowsHide: true, timeout: 120_000 }, (error) => (error ? reject(error) : resolve()))
    )
    const target = managedClaude()
    rmSync(join(target, '..'), { recursive: true, force: true })
    mkdirSync(join(target, '..'), { recursive: true })
    renameSync(join(work, 'package', 'claude.exe'), target)
    if (!existsSync(target)) throw new Error('Claude Code didn’t unpack')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

let login: ChildProcess | null = null

/** Starts Claude Code's sign-in: it opens your browser; the page's address shows here too. */
export function startLogin(): void {
  const exe = findClaude()
  if (!exe || login) return
  set({ login: { url: null, error: null } })
  const child = spawn(exe, ['auth', 'login'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  login = child
  let out = ''
  const read = (chunk: Buffer) => {
    out = (out + chunk.toString('utf8')).slice(-8_000)
    const url = /https:\/\/\S+/.exec(out)?.[0]
    if (url && state.login && state.login.url !== url) set({ login: { ...state.login, url } })
  }
  child.stdout?.on('data', read)
  child.stderr?.on('data', read)
  child.on('error', (error) => set({ login: { url: state.login?.url ?? null, error: error.message } }))
  child.on('exit', async (code) => {
    login = null
    const ok = await signedIn()
    if (ok) set({ signedIn: true, login: null })
    else if (state.login) set({ signedIn: ok, login: { url: state.login.url, error: code === 0 ? 'Claude Code says you’re still signed out.' : 'Signing in didn’t finish. Try again.' } })
  })
}

/** The code the sign-in page showed, for Claude Code waiting on it. */
export function submitLoginCode(code: string): void {
  const clean = code.trim()
  if (login?.stdin && clean && /^[\w#.-]+$/.test(clean)) login.stdin.write(`${clean}\n`)
}

/** Stops waiting for the browser. */
export function cancelLogin(): void {
  login?.kill()
  login = null
  set({ login: null })
}
