import { describe, expect, it } from 'vitest'
import type { SessionEntry, SessionMeta } from '../../src/shared/library'
import type { SshHost } from '../../src/shared/live'
import { envLabel, matchesEnv, recentEnvironments, repoRoot, sameEnv } from '../../src/renderer/src/features/sessions/environments'

const meta = (id: string, cwd: string, updated: number, remote = false): SessionMeta => ({
  id,
  file: `${id}.jsonl`,
  project: '',
  cwd,
  title: id,
  firstPrompt: null,
  lastPrompt: null,
  created: updated,
  updated,
  size: 1,
  entrypoint: 'cli',
  gitBranch: null,
  version: null,
  remote
})
const hosts: SshHost[] = [
  { id: 'mini', name: 'mac-mini', host: 'budinoff@ip.example.com', claude: null },
  { id: 'lab', name: 'home-lab', host: 'home-lab', claude: null }
]

describe('environments', () => {
  it('maps a worktree’s folder to its repository', () => {
    expect(repoRoot('D:\\ComfyUI\\.claude\\worktrees\\dusky-cloud')).toBe('D:\\ComfyUI')
    expect(repoRoot('/home/me/app/.claude/worktrees/fox/')).toBe('/home/me/app')
    expect(repoRoot('D:\\JS\\Gloom')).toBe('D:\\JS\\Gloom')
  })

  it('lists where you worked, newest first, each place once, then connections not used yet', () => {
    const sessions = [
      meta('a', 'D:\\JS', 100),
      meta('b', 'D:\\ComfyUI\\.claude\\worktrees\\dusky-cloud', 300),
      meta('c', 'D:\\ComfyUI', 200),
      meta('d', 'D:\\blissful-girls', 250),
      meta('e', '/srv/app', 400),
      meta('f', 'D:\\Other', 500, true)
    ]
    const entries: Record<string, SessionEntry> = { e: { ssh: { host: 'lab', cwd: '/srv/app' } } }
    const recent = recentEnvironments(sessions, entries, hosts)
    expect(recent).toEqual([
      { kind: 'ssh', host: 'lab', cwd: '/srv/app' },
      { kind: 'local', cwd: 'D:\\ComfyUI' },
      { kind: 'local', cwd: 'D:\\blissful-girls' },
      { kind: 'local', cwd: 'D:\\JS' },
      { kind: 'ssh', host: 'mini', cwd: '~' }
    ])
  })

  it('names each place, and finds it by any word', () => {
    expect(envLabel({ kind: 'local', cwd: 'D:\\JS\\blissful-girls' }, hosts)).toEqual({ name: 'blissful-girls', detail: 'D:\\JS\\blissful-girls' })
    expect(envLabel({ kind: 'ssh', host: 'mini', cwd: '~' }, hosts)).toEqual({ name: 'mac-mini', detail: 'budinoff@ip.example.com:~' })
    expect(envLabel({ kind: 'ssh', host: 'lab', cwd: '/srv/app' }, hosts).name).toBe('home-lab · app')
    expect(envLabel({ kind: 'cloud', cwd: 'D:\\JS\\Gloom' }, hosts).detail).toBe('From Gloom’s repository')
    expect(matchesEnv({ kind: 'local', cwd: 'D:\\JS\\blissful-girls' }, 'js bliss', hosts)).toBe(true)
    expect(matchesEnv({ kind: 'local', cwd: 'D:\\JS\\blissful-girls' }, 'comfy', hosts)).toBe(false)
    expect(sameEnv({ kind: 'local', cwd: 'd:/js/' }, { kind: 'local', cwd: 'D:\\JS' })).toBe(true)
  })
})
