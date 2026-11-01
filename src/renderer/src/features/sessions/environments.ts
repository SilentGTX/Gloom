// Where a new session runs, as the Claude app's new-session screen lists it:
// a folder on this computer, a folder on one of Settings' SSH connections, or
// Claude in the cloud from a folder's repository. Pure, so it's tested
// without a window.
import { normalizePath, type SessionEntry, type SessionMeta } from '@shared/library'
import type { SshHost } from '@shared/live'

export type Environment = { kind: 'local'; cwd: string } | { kind: 'ssh'; host: string; cwd: string } | { kind: 'cloud'; cwd: string }

/** "D:\JS\Gloom" → "Gloom". */
export const lastPart = (path: string): string => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/**
 * A worktree's folder belongs to its repository: "D:\ComfyUI\.claude\worktrees\dusky-cloud"
 * is D:\ComfyUI, so a new session there gets a worktree of its own instead of
 * working in another session's.
 */
export function repoRoot(path: string): string {
  const m = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+[\\/]?$/.exec(path)
  return m ? m[1] : path
}

export function envKey(env: Environment): string {
  return env.kind === 'ssh' ? `ssh:${env.host}:${env.cwd}` : `${env.kind}:${normalizePath(env.cwd)}`
}

export function sameEnv(a: Environment | null | undefined, b: Environment | null | undefined): boolean {
  return !!a && !!b && envKey(a) === envKey(b)
}

/**
 * The places you've worked, newest first: each folder once (worktrees as their
 * repository), and each SSH connection's folders. Connections in Settings you
 * haven't run on yet come after, in their home folder.
 */
export function recentEnvironments(sessions: readonly SessionMeta[], entries: Readonly<Record<string, SessionEntry>>, hosts: readonly SshHost[]): Environment[] {
  const seen = new Map<string, { env: Environment; at: number }>()
  for (const s of sessions) {
    const ssh = entries[s.id]?.ssh
    let env: Environment | null = null
    if (ssh && hosts.some((h) => h.id === ssh.host)) env = { kind: 'ssh', host: ssh.host, cwd: ssh.cwd }
    else if (!ssh && s.cwd && !s.remote) env = { kind: 'local', cwd: repoRoot(s.cwd) }
    if (!env) continue
    const key = envKey(env)
    const known = seen.get(key)
    if (!known || s.updated > known.at) seen.set(key, { env, at: s.updated })
  }
  const recent = [...seen.values()].sort((a, b) => b.at - a.at).map((e) => e.env)
  for (const h of hosts) if (!recent.some((e) => e.kind === 'ssh' && e.host === h.id)) recent.push({ kind: 'ssh', host: h.id, cwd: '~' })
  return recent
}

/** What the picker says: the folder's name, and where it is. */
export function envLabel(env: Environment, hosts: readonly SshHost[]): { name: string; detail: string } {
  if (env.kind === 'local') return { name: lastPart(env.cwd), detail: env.cwd }
  if (env.kind === 'cloud') return { name: 'Claude in the Cloud', detail: `From ${lastPart(env.cwd)}’s repository` }
  const host = hosts.find((h) => h.id === env.host)
  const name = host?.name ?? env.host
  return { name: env.cwd === '~' ? name : `${name} · ${lastPart(env.cwd)}`, detail: `${host?.host ?? env.host}:${env.cwd}` }
}

/** Search: every word typed is somewhere in the name or where it is. */
export function matchesEnv(env: Environment, query: string, hosts: readonly SshHost[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const { name, detail } = envLabel(env, hosts)
  const hay = `${name} ${detail}`.toLowerCase()
  return words.every((w) => hay.includes(w))
}
