// Cloud sessions, through Claude Code's own `--cloud`: a session that runs on
// Anthropic's machines from the project's GitHub repository, so it keeps
// going when this computer sleeps. Claude Code can't stream one into another
// app, so Gloom starts it, keeps its link, and opens it on claude.ai.
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { findClaude } from './claude/binary'

const run = promisify(execFile)

export interface CloudSession {
  url: string
  title: string
  cwd: string
  created: number
}

let file = ''
let list: CloudSession[] = []

export function loadCloud(): void {
  file = join(app.getPath('userData'), 'cloud.json')
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { sessions?: unknown }
      list = (Array.isArray(raw.sessions) ? raw.sessions : []).filter(
        (s): s is CloudSession => !!s && typeof s === 'object' && typeof (s as CloudSession).url === 'string' && /^https:\/\/claude\.ai\//.test((s as CloudSession).url)
      )
    }
  } catch {
    list = []
  }
}

export function cloudSessions(): CloudSession[] {
  return list
}

function save(): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify({ version: 1, sessions: list }, null, 1))
  renameSync(file + '.tmp', file)
}

/** The claude.ai link `claude --cloud` printed. */
export function cloudUrl(output: string): string | null {
  return /https:\/\/claude\.ai\/code\/[\w/?=&.-]+/.exec(output)?.[0] ?? null
}

/** Starts a cloud session in `cwd`'s repository with this task; resolves to its claude.ai link. */
export async function startCloud(cwd: string, task: string): Promise<CloudSession> {
  const claude = findClaude()
  if (!claude || /\.(mjs|js)$/i.test(claude)) throw new Error('Claude Code isn’t installed.')
  let out = ''
  try {
    const { stdout, stderr } = await run(claude, ['--cloud', task, '-p', '--output-format', 'text'], { cwd, windowsHide: true, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 })
    out = `${stdout}\n${stderr}`
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string }
    out = `${e.stdout ?? ''}\n${e.stderr ?? ''}`
    if (!cloudUrl(out)) throw new Error((e.stderr || e.message || 'Claude Code couldn’t start the cloud session.').trim().split('\n')[0])
  }
  const url = cloudUrl(out)
  if (!url) throw new Error(out.trim().split('\n').find((l) => l.trim()) ?? 'Claude Code didn’t say where the cloud session is.')
  const session: CloudSession = { url, title: task.split('\n')[0].slice(0, 100), cwd, created: Date.now() }
  list = [session, ...list].slice(0, 200)
  save()
  return session
}
