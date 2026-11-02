// Which claude.exe Gloom runs, and its version. Your own CLI, the one your
// terminal uses (same login, same version); Settings can point elsewhere. The
// Agent SDK was made with a newer CLI than many installs have, so Gloom checks
// the version once and offers Claude Code's own `claude update` when it's behind.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { compareVersions, type ClaudeInfo } from '@shared/live'
import sdk from '../../../node_modules/@anthropic-ai/claude-agent-sdk/package.json'
import { settings } from './settings'

/** The CLI version this build of the Agent SDK was made with. */
export const EXPECTED_VERSION: string = (sdk as { claudeCodeVersion?: string }).claudeCodeVersion ?? '0.0.0'

/**
 * Your claude.exe: the one Settings names, else the native installer's, else
 * the first on PATH. An npm `claude.cmd` can't be started without a shell, but
 * it only runs the package's own native claude.exe, so that one counts; the
 * shim itself only counts for opening a terminal. GLOOM_CLAUDE_EXE overrides
 * all of it (the end-to-end tests point it at the fake claude).
 */
export function findClaude({ forTerminal = false } = {}): string | null {
  const forced = process.env.GLOOM_CLAUDE_EXE
  if (forced) return existsSync(forced) ? forced : null
  const chosen = settings().claudePath
  if (chosen && existsSync(chosen)) return chosen
  const local = join(homedir(), '.local', 'bin', 'claude.exe')
  if (existsSync(local)) return local
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const exe = join(dir, 'claude.exe')
    if (existsSync(exe)) return exe
    if (!existsSync(join(dir, 'claude.cmd'))) continue
    const npmExe = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    if (existsSync(npmExe)) return npmExe
    if (forTerminal) return join(dir, 'claude.cmd')
  }
  return null
}

let cached: { path: string; version: string | null } | null = null

/** Asks the CLI its version ("2.1.186 (Claude Code)"). */
function readVersion(path: string): Promise<string | null> {
  if (/\.(mjs|js)$/i.test(path)) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(path, ['--version'], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      const m = /(\d+\.\d+\.\d+)/.exec(String(stdout))
      resolve(error || !m ? null : m[1])
    })
  })
}

/** Where claude.exe is and which version it is, read once per path. */
export async function claudeInfo({ fresh = false } = {}): Promise<ClaudeInfo> {
  const path = findClaude()
  if (!path) return { path: null, version: null, expected: EXPECTED_VERSION, outdated: false }
  if (fresh || cached?.path !== path) cached = { path, version: await readVersion(path) }
  const version = cached.version
  return { path, version, expected: EXPECTED_VERSION, outdated: !!version && compareVersions(version, EXPECTED_VERSION) < 0 }
}

/** The SDK passes flags newer CLIs know; these need at least this version. */
export function cliAtLeast(version: string): boolean {
  return !!cached?.version && compareVersions(cached.version, version) >= 0
}
