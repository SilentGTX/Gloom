// Worktree sessions, as the window sees them. As in the Claude app, a session's
// worktree lives in <repo>/.claude/worktrees/<name> on a claude/<name> branch;
// Merge lands the branch on the one it came from.

/** The git repository a folder is in. */
export interface RepoInfo {
  /** The checkout the folder is in. */
  root: string
  /** Its branch; null when HEAD is detached. */
  branch: string | null
  /** The folder is itself a session's worktree. */
  worktree: boolean
}

/** A session's worktree, for the chat toolbar and Merge. */
export interface WorktreeInfo {
  path: string
  branch: string
  /** The branch it came from, where Merge lands it; null if unknown. */
  base: string | null
  /** The main checkout, where the merge happens. */
  main: string
  /** Commits on the branch that the base doesn't have. */
  ahead: number
  /** Commits on the base since (the branch doesn't have them). */
  behind: number
  /** Files changed in the worktree and not committed: Merge leaves them out. */
  dirty: number
}

export type MergeResult = { ok: true; branch: string; base: string; commits: number } | { ok: false; reason: string; conflicts?: string[] }

export type RemoveResult = { removed: true } | { removed: false; dirty?: number; reason?: string }

/**
 * The worktree folder a session's working folder is in, if it's one:
 * `<repo>/.claude/worktrees/<name>`, or `<folder>/<repository>/<name>` when
 * Settings put worktrees in a folder of your own (`repo` is then the folder
 * holding that repository's worktrees).
 */
export function worktreeOf(cwd: string, folder?: string | null): { repo: string; name: string; path: string } | null {
  const sep = cwd.includes('\\') ? '\\' : '/'
  const m = /^(.*?)[\\/]\.claude[\\/]worktrees[\\/]([^\\/]+)/.exec(cwd)
  if (m && m[1]) return { repo: m[1], name: m[2], path: [m[1], '.claude', 'worktrees', m[2]].join(sep) }
  const root = folder?.replace(/[\\/]+$/, '')
  if (!root || cwd.length <= root.length + 1 || cwd.slice(0, root.length).toLowerCase() !== root.toLowerCase() || !/[\\/]/.test(cwd[root.length])) return null
  const [repoName, name] = cwd.slice(root.length + 1).split(/[\\/]/)
  if (!repoName || !name) return null
  // Spelled as the session's folder spells it, so it compares with paths made from that.
  const base = cwd.slice(0, root.length)
  return { repo: [base, repoName].join(sep), name, path: [base, repoName, name].join(sep) }
}

const ADJECTIVES = ['amber', 'brisk', 'calm', 'dusky', 'early', 'faint', 'gentle', 'hazy', 'ivory', 'jade', 'keen', 'late', 'misty', 'nimble', 'opal', 'pale', 'quiet', 'rosy', 'soft', 'tidy', 'umber', 'violet', 'warm', 'young']
const NOUNS = ['brook', 'cedar', 'cloud', 'dune', 'ember', 'fern', 'grove', 'harbor', 'isle', 'lake', 'meadow', 'moon', 'orchard', 'pine', 'reef', 'ridge', 'river', 'shore', 'sparrow', 'star', 'tide', 'valley', 'willow', 'wren']

/** A worktree's name: two words, then a number if those are taken. */
export function worktreeName(taken: (name: string) => boolean, random: () => number = Math.random): string {
  const pick = (list: string[]) => list[Math.floor(random() * list.length) % list.length]
  const base = `${pick(ADJECTIVES)}-${pick(NOUNS)}`
  if (!taken(base)) return base
  for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`
}
