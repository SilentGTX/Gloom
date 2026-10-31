// Worktree sessions. In a git repository a new session gets a worktree of its
// own, as in the Claude app: <repo>/.claude/worktrees/<name>, on a claude/<name>
// branch from the checkout's HEAD. Nothing keeps that folder out of the main
// checkout's `git status`, so it goes in .git/info/exclude. The branch it came
// from is kept in the repository's own config (branch.<branch>.gloomBase), so
// Merge knows where to land it, whoever made the worktree and whenever.
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { basename, dirname, join, normalize, relative, resolve } from 'node:path'
import { worktreeName, worktreeOf, type MergeResult, type RemoveResult, type RepoInfo, type WorktreeInfo } from '@shared/git'
import { settings } from '../claude/settings'
import { git } from './diff'

const EXCLUDE = '.claude/worktrees/'

/** The worktree a session's folder is in, wherever Settings put worktrees. */
export function sessionWorktree(cwd: string): ReturnType<typeof worktreeOf> {
  return worktreeOf(cwd, settings().worktreeFolder)
}

const quiet = (p: Promise<string>) => p.then(
  (out) => out.trim(),
  () => null
)

/** The repository a folder is in, or null. */
export async function repoInfo(cwd: string): Promise<RepoInfo | null> {
  if (!existsSync(cwd)) return null
  const root = await quiet(git(cwd, ['rev-parse', '--show-toplevel']))
  if (!root) return null
  const branch = await quiet(git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']))
  return { root: normalize(root), branch: branch || null, worktree: !!worktreeOf(normalize(root)) }
}

/** The main checkout of the repository a folder is in (a worktree's main one). */
async function mainCheckout(cwd: string): Promise<string> {
  const common = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  return normalize(dirname(common))
}

/**
 * A worktree for a new session in `cwd`'s repository, from the checkout's
 * HEAD. Returns the folder the session works in: the worktree, or the same
 * subfolder inside it when `cwd` was one.
 */
export async function createWorktree(cwd: string): Promise<{ cwd: string; branch: string; base: string | null }> {
  const root = normalize((await git(cwd, ['rev-parse', '--show-toplevel'])).trim())
  const main = await mainCheckout(cwd)
  const base = (await quiet(git(root, ['symbolic-ref', '--short', '-q', 'HEAD']))) || null
  const { branchPrefix, worktreeFolder } = settings()
  // Inside the project (the Claude app's default), or <your folder>/<repository>.
  const folder = worktreeFolder ? join(worktreeFolder, basename(main)) : join(main, '.claude', 'worktrees')
  const branches = new Set((await git(main, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).split('\n').map((b) => b.trim()))
  const name = worktreeName((n) => existsSync(join(folder, n)) || branches.has(`${branchPrefix}/${n}`))
  const path = join(folder, name)
  const branch = `${branchPrefix}/${name}`
  mkdirSync(folder, { recursive: true })
  await git(root, ['worktree', 'add', '-b', branch, path, 'HEAD'])
  if (!worktreeFolder) await exclude(main)
  if (base) await git(main, ['config', `branch.${branch}.gloomBase`, base])
  const inside = relative(root, cwd)
  return { cwd: inside && !inside.startsWith('..') ? join(path, inside) : path, branch, base }
}

/** Keeps .claude/worktrees/ out of the main checkout's status. */
async function exclude(main: string): Promise<void> {
  const common = (await git(main, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  const file = join(common, 'info', 'exclude')
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.split(/\r?\n/).some((l) => l.trim() === EXCLUDE || l.trim() === `/${EXCLUDE}`)) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${current && !current.endsWith('\n') ? '\n' : ''}# Session worktrees (Gloom, the Claude app)\n${EXCLUDE}\n`)
}

const count = async (cwd: string, range: string) => Number(await quiet(git(cwd, ['rev-list', '--count', range]))) || 0

/** The worktree a session works in, with where it stands against the branch it came from. */
export async function worktreeInfo(cwd: string): Promise<WorktreeInfo | null> {
  const found = sessionWorktree(cwd)
  if (!found || !existsSync(found.path)) return null
  const branch = await quiet(git(found.path, ['symbolic-ref', '--short', '-q', 'HEAD']))
  if (!branch) return null
  const main = await mainCheckout(found.path).catch(() => null)
  if (!main) return null
  const base = (await quiet(git(main, ['config', `branch.${branch}.gloomBase`]))) || (await quiet(git(main, ['symbolic-ref', '--short', '-q', 'HEAD']))) || null
  const status = (await quiet(git(found.path, ['status', '--porcelain', '--untracked-files=all']))) ?? ''
  return {
    path: found.path,
    branch,
    base,
    main,
    ahead: base ? await count(found.path, `${base}..${branch}`) : 0,
    behind: base ? await count(found.path, `${branch}..${base}`) : 0,
    dirty: status ? status.split('\n').filter(Boolean).length : 0
  }
}

/**
 * Lands a worktree's branch on the branch it came from, with a merge commit,
 * in the main checkout. It must be on that branch. On conflicts it stops and
 * puts the checkout back as it was, naming the files.
 */
export async function mergeWorktree(cwd: string): Promise<MergeResult> {
  const info = await worktreeInfo(cwd)
  if (!info) return { ok: false, reason: 'This session isn’t working in a worktree.' }
  if (!info.base) return { ok: false, reason: 'Gloom doesn’t know which branch this worktree came from.' }
  const on = await quiet(git(info.main, ['symbolic-ref', '--short', '-q', 'HEAD']))
  if (on !== info.base) return { ok: false, reason: `The main checkout is on ${on ?? 'a detached HEAD'}, not ${info.base}. Switch it to ${info.base} to merge.` }
  if (!info.ahead) return { ok: false, reason: `${info.branch} has nothing ${info.base} doesn’t have yet.` }
  try {
    await git(info.main, ['merge', '--no-ff', '--no-edit', info.branch])
    return { ok: true, branch: info.branch, base: info.base, commits: info.ahead }
  } catch (error) {
    const conflicts = ((await quiet(git(info.main, ['diff', '--name-only', '--diff-filter=U']))) ?? '').split('\n').filter(Boolean)
    if (conflicts.length) {
      await quiet(git(info.main, ['merge', '--abort']))
      return { ok: false, reason: `Merging stopped: ${conflicts.length === 1 ? 'a file conflicts' : `${conflicts.length} files conflict`}. ${info.base} is as it was.`, conflicts }
    }
    const e = error as { stderr?: string; message?: string }
    const said = (e.stderr || e.message || '').trim().split('\n').find((l) => /error|fatal|overwritten|aborting/i.test(l)) ?? ''
    return { ok: false, reason: said.replace(/^(error|fatal): /, '') || 'git couldn’t merge it.' }
  }
}

/** Removes a session's worktree; one with uncommitted changes only when `force`. Its branch stays. */
export async function removeWorktree(cwd: string, force: boolean): Promise<RemoveResult> {
  const info = await worktreeInfo(cwd)
  if (!info) return { removed: false, reason: 'not a worktree' }
  if (info.dirty && !force) return { removed: false, dirty: info.dirty }
  try {
    await git(info.main, ['worktree', 'remove', ...(force ? ['--force'] : []), info.path])
    return { removed: true }
  } catch (error) {
    return { removed: false, reason: String((error as Error).message).split('\n')[0] }
  }
}

/**
 * A session's working folder, gone, made again so it can carry on: a worktree
 * from its branch, if it was one and the branch is still there; else an
 * empty folder (Claude Code only finds a session from its own folder).
 */
export async function recreateFolder(cwd: string): Promise<void> {
  const found = sessionWorktree(cwd)
  // Its branch under today's prefix, else the Claude app's default one.
  const prefixes = [...new Set([settings().branchPrefix, 'claude'])]
  if (found && existsSync(found.repo) && (await quiet(git(found.repo, ['rev-parse', '--git-dir'])))) {
    let branch = ''
    for (const prefix of prefixes) if (!branch && (await quiet(git(found.repo, ['rev-parse', '--verify', '-q', `refs/heads/${prefix}/${found.name}`])))) branch = `${prefix}/${found.name}`
    if (branch) {
      await quiet(git(found.repo, ['worktree', 'prune']))
      await git(found.repo, ['worktree', 'add', found.path, branch])
      mkdirSync(cwd, { recursive: true })
      return
    }
  }
  mkdirSync(resolve(cwd), { recursive: true })
}
