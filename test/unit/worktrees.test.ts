import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { worktreeName, worktreeOf } from '../../src/shared/git'
import { workingTreeDiff } from '../../src/main/git/diff'
import { createWorktree, mergeWorktree, recreateFolder, removeWorktree, repoInfo, worktreeInfo } from '../../src/main/git/worktrees'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' }).trim()

/** A repository on main with one commit, and an identity for the commits the tests make. */
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gloom-wt-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'gloom@example.com')
  git(dir, 'config', 'user.name', 'Gloom')
  git(dir, 'config', 'core.autocrlf', 'false')
  writeFileSync(join(dir, 'notes.md'), 'one\ntwo\nthree\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'first')
  return dir
}

describe('worktree names and paths', () => {
  it('finds the worktree a working folder is in', () => {
    expect(worktreeOf('D:\\JS\\Gloom\\.claude\\worktrees\\amber-brook\\src')).toEqual({ repo: 'D:\\JS\\Gloom', name: 'amber-brook', path: 'D:\\JS\\Gloom\\.claude\\worktrees\\amber-brook' })
    expect(worktreeOf('/home/me/app/.claude/worktrees/x')).toMatchObject({ repo: '/home/me/app', name: 'x' })
    expect(worktreeOf('D:\\JS\\Gloom')).toBeNull()
  })

  it('names a worktree with two words, numbered when taken', () => {
    const fixed = () => 0
    expect(worktreeName(() => false, fixed)).toBe('amber-brook')
    expect(worktreeName((n) => n === 'amber-brook', fixed)).toBe('amber-brook-2')
  })
})

describe('worktree sessions', () => {
  it('makes a worktree on a claude/ branch, kept out of the main checkout’s status', async () => {
    const dir = repo()
    const made = await createWorktree(dir)
    expect(made.branch).toMatch(/^claude\/[a-z]+-[a-z]+$/)
    expect(made.base).toBe('main')
    expect(made.cwd.toLowerCase()).toBe(join(dir, '.claude', 'worktrees', made.branch.slice('claude/'.length)).toLowerCase())
    expect(git(made.cwd, 'symbolic-ref', '--short', 'HEAD')).toBe(made.branch)
    expect(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')).toContain('.claude/worktrees/')
    expect(git(dir, 'status', '--porcelain')).toBe('')
    expect(await repoInfo(made.cwd)).toMatchObject({ branch: made.branch, worktree: true })
    expect(await repoInfo(dir)).toMatchObject({ branch: 'main', worktree: false })
  })

  it('merges the work back into the branch it came from, with a merge commit', async () => {
    const dir = repo()
    const { cwd, branch } = await createWorktree(dir)
    writeFileSync(join(cwd, 'limits.md'), '100 a minute\n')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'limits')
    writeFileSync(join(cwd, 'scratch.txt'), 'not committed\n')
    expect(await worktreeInfo(cwd)).toMatchObject({ branch, base: 'main', ahead: 1, behind: 0, dirty: 1 })

    const merged = await mergeWorktree(cwd)
    expect(merged).toEqual({ ok: true, branch, base: 'main', commits: 1 })
    expect(readFileSync(join(dir, 'limits.md'), 'utf8')).toBe('100 a minute\n')
    expect(git(dir, 'log', '-1', '--format=%P').split(' ')).toHaveLength(2)
    expect(existsSync(join(dir, 'scratch.txt'))).toBe(false)
  })

  it('shows a worktree’s changes since it left its branch, committed ones included, in Working Tree', async () => {
    const dir = repo()
    const { cwd } = await createWorktree(dir)
    writeFileSync(join(cwd, 'limits.md'), '100 a minute\n')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'limits')
    writeFileSync(join(cwd, 'notes.md'), 'one\ntwo\nthree\nfour\n')
    const tree = await workingTreeDiff(cwd)
    expect(tree.kind === 'ok' && tree.since).toBe('main')
    expect(tree.kind === 'ok' && tree.files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
      ['limits.md', 'added', 1, 0],
      ['notes.md', 'modified', 1, 0]
    ])
  })

  it('stops on conflicts, names the files, and leaves the base branch as it was', async () => {
    const dir = repo()
    const { cwd } = await createWorktree(dir)
    writeFileSync(join(cwd, 'notes.md'), 'one\nTWO (worktree)\nthree\n')
    git(cwd, 'commit', '-q', '-am', 'worktree edit')
    writeFileSync(join(dir, 'notes.md'), 'one\nTWO (main)\nthree\n')
    git(dir, 'commit', '-q', '-am', 'main edit')
    const head = git(dir, 'rev-parse', 'HEAD')

    const merged = await mergeWorktree(cwd)
    expect(merged.ok).toBe(false)
    expect(!merged.ok && merged.conflicts).toEqual(['notes.md'])
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(dir, 'status', '--porcelain')).toBe('')
  })

  it('won’t merge into a checkout that has moved to another branch', async () => {
    const dir = repo()
    const { cwd } = await createWorktree(dir)
    writeFileSync(join(cwd, 'a.md'), 'a\n')
    git(cwd, 'add', '.')
    git(cwd, 'commit', '-q', '-m', 'a')
    git(dir, 'switch', '-q', '-c', 'other')
    const merged = await mergeWorktree(cwd)
    expect(merged).toMatchObject({ ok: false, reason: expect.stringContaining('Switch it to main') })
  })

  it('removes a clean worktree, asks about a dirty one, and makes a removed one again from its branch', async () => {
    const dir = repo()
    const { cwd, branch } = await createWorktree(dir)
    writeFileSync(join(cwd, 'draft.md'), 'draft\n')
    expect(await removeWorktree(cwd, false)).toEqual({ removed: false, dirty: 1 })
    expect(await removeWorktree(cwd, true)).toEqual({ removed: true })
    expect(existsSync(cwd)).toBe(false)
    // The branch stays, so the session's folder can come back.
    expect(git(dir, 'branch', '--list', branch)).toContain(branch)
    await recreateFolder(cwd)
    expect(git(cwd, 'symbolic-ref', '--short', 'HEAD')).toBe(branch)
  })

  it('makes a plain missing folder again, empty', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'gloom-gone-')), 'project', 'src')
    await recreateFolder(dir)
    expect(existsSync(dir)).toBe(true)
  })
})
