// The diff pane's Working Tree: what git sees in a session's working folder,
// tracked changes against HEAD (staged or not) and untracked files, so changes
// made by Bash, by you or by other sessions show too. git runs without taking
// its index lock (GIT_OPTIONAL_LOCKS), so it never gets in the way of yours.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'
import { promisify } from 'node:util'
import { addedFile, parseGitDiff, untrackedPaths, type DiffFile, type TreeDiff } from '@shared/diff'

const run = promisify(execFile)

/** git's empty tree: what a repository without commits is compared against. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** A patch bigger than this lists its files with their counts only. */
const PATCH_MAX = 24 * 1024 * 1024
const UNTRACKED_MAX_BYTES = 256 * 1024
const UNTRACKED_MAX_FILES = 300
const TOO_LARGE = 'Too large to show here.'

/** Runs git in `cwd`: English messages, paths unquoted, no colour, no lock. */
export async function git(cwd: string, args: string[], maxBuffer = 8 * 1024 * 1024): Promise<string> {
  const { stdout } = await run('git', ['-c', 'core.quotepath=false', '-c', 'color.ui=false', ...args], {
    cwd,
    windowsHide: true,
    maxBuffer,
    timeout: 30_000,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }
  })
  return stdout
}

const ok = (p: Promise<string>) => p.then(
  (out) => out,
  () => null
)

/** One read at a time per folder: a second ask while git runs gets the same answer. */
const running = new Map<string, Promise<TreeDiff>>()

export function workingTreeDiff(cwd: string): Promise<TreeDiff> {
  const key = normalize(cwd).toLowerCase()
  const existing = running.get(key)
  if (existing) return existing
  const reading = read(cwd).finally(() => running.delete(key))
  running.set(key, reading)
  return reading
}

async function read(cwd: string): Promise<TreeDiff> {
  if (!existsSync(cwd)) return { kind: 'missing-folder' }
  let root: string
  try {
    root = normalize((await git(cwd, ['rev-parse', '--show-toplevel'])).trim())
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { kind: 'no-git' } : { kind: 'not-repo' }
  }
  try {
    const [branch, head, status] = await Promise.all([
      ok(git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])),
      ok(git(root, ['rev-parse', '--verify', '-q', 'HEAD'])),
      git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], 32 * 1024 * 1024)
    ])
    const base = head?.trim() ? 'HEAD' : EMPTY_TREE
    let files: Omit<DiffFile, 'abs'>[]
    let truncated = false
    try {
      files = parseGitDiff(await git(root, ['diff', base, '-M', '--no-ext-diff', '--no-textconv', '--unified=3', '--'], PATCH_MAX))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw error
      truncated = true
      files = numstat(await git(root, ['diff', base, '-M', '--numstat', '-z', '--'], 32 * 1024 * 1024))
    }
    const untracked = untrackedPaths(status)
    for (const [i, path] of untracked.entries()) files.push(i < UNTRACKED_MAX_FILES ? await untrackedFile(root, path) : { path, status: 'untracked', added: 0, removed: 0, hunks: [], note: TOO_LARGE })
    const all = files.map((f) => ({ ...f, abs: join(root, f.path) })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return { kind: 'ok', root, branch: branch?.trim() || null, files: all, ...(truncated ? { truncated } : {}) }
  } catch (error) {
    return { kind: 'error', message: firstLine(error) }
  }
}

/** A file git doesn't track yet, as all added; too big or binary ones by name only. */
async function untrackedFile(root: string, path: string): Promise<Omit<DiffFile, 'abs'>> {
  const bare = { path, status: 'untracked' as const, added: 0, removed: 0, hunks: [] }
  try {
    const stats = await lstat(join(root, path))
    if (!stats.isFile()) return { ...bare, note: 'Not a regular file.' }
    if (stats.size > UNTRACKED_MAX_BYTES) return { ...bare, note: TOO_LARGE }
    const bytes = await readFile(join(root, path))
    if (bytes.subarray(0, 8000).includes(0)) return { ...bare, note: 'Binary file' }
    return addedFile(path, bytes.toString('utf8'))
  } catch {
    return { ...bare, note: 'Couldn’t be read.' }
  }
}

/** `git diff --numstat -z`: counts per file, for a patch too big to read. */
function numstat(out: string): Omit<DiffFile, 'abs'>[] {
  const fields = out.split('\0')
  const files: Omit<DiffFile, 'abs'>[] = []
  for (let i = 0; i < fields.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(fields[i])
    if (!m) continue
    let path = m[3]
    let from: string | undefined
    // A rename: the counts, then an empty path, then the old and new paths.
    if (!path) {
      from = fields[++i]
      path = fields[++i] ?? ''
    }
    const binary = m[1] === '-'
    files.push({
      path,
      ...(from ? { from } : {}),
      status: from ? 'renamed' : 'modified',
      added: binary ? 0 : +m[1],
      removed: binary ? 0 : +m[2],
      hunks: [],
      note: binary ? 'Binary file' : TOO_LARGE
    })
  }
  return files
}

function firstLine(error: unknown): string {
  const e = error as { stderr?: string; message?: string }
  const text = (e.stderr || e.message || String(error)).trim()
  return text.split('\n')[0].replace(/^(fatal|error): /, '').slice(0, 300) || 'git couldn’t read the changes.'
}
