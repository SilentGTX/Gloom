// Packaging smoke test: start PowerShell through node-pty, so a broken native
// module or a helper exe stuck inside the asar shows up on day one.
import { homedir } from 'node:os'
import { killTree } from './claude/runner'

export interface SmokeResult {
  ok: boolean
  output: string
  error?: string
  ms: number
}

export async function runPtySmoke(timeoutMs = 15_000): Promise<SmokeResult> {
  const started = Date.now()
  const elapsed = () => Date.now() - started
  let pty: typeof import('node-pty')
  try {
    // Loaded on demand, so a broken native module fails this test instead of app start.
    pty = require('node-pty') as typeof import('node-pty')
  } catch (e) {
    return { ok: false, output: '', error: `node-pty failed to load: ${String(e)}`, ms: elapsed() }
  }
  return new Promise((resolve) => {
    let output = ''
    let term: import('node-pty').IPty
    try {
      term = pty.spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', 'Write-Output ("pty-ok " + $PSVersionTable.PSVersion)'], {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: homedir(),
        env: process.env as Record<string, string>
      })
    } catch (e) {
      resolve({ ok: false, output, error: `spawn failed: ${String(e)}`, ms: elapsed() })
      return
    }
    const timer = setTimeout(() => {
      // Not term.kill(): on Windows that forks a Node helper, which the RunAsNode fuse turns into a second Gloom.
      killTree(term.pid)
      resolve({ ok: false, output: clean(output), error: 'timed out', ms: elapsed() })
    }, timeoutMs)
    term.onData((data) => (output += data))
    term.onExit(({ exitCode }) => {
      clearTimeout(timer)
      const text = clean(output)
      resolve({ ok: exitCode === 0 && /pty-ok \d+\.\d+/.test(text), output: text, ms: elapsed() })
    })
  })
}

/** Drops terminal escape sequences so the result reads as plain text. */
function clean(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .trim()
}
