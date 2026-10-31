// A session's pull request, as the Claude app's PR bar and pane show it: found
// from the branch the session works on (gh pr view), or linked by its URL;
// its checks, reviews and mergeability; Merge, auto-merge, and the monitor:
// Auto-fix wakes the session on failed checks, merge conflicts and new review
// comments, and a session can be archived once its PR merges or closes.
// Everything goes through GitHub's own CLI (gh), with your login.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PrCheck, PrStatus } from '@shared/pr'
import { onPath } from '../exec'

export type { PrCheck, PrStatus }

const run = promisify(execFile)

const FIELDS = 'number,url,title,state,isDraft,baseRefName,headRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,autoMergeRequest,comments,reviews,updatedAt'

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)

/** gh, found once on PATH. */
function gh(): string {
  const found = onPath('gh.exe')
  if (!found) throw new Error('GitHub’s CLI (gh) isn’t installed, or isn’t on PATH.')
  return found
}

/** A check's state, in one word, from gh's two shapes (CheckRun and StatusContext). */
export function checkState(c: Record<string, unknown>): string {
  const conclusion = str(c.conclusion).toLowerCase()
  const status = str(c.status).toLowerCase()
  const state = str(c.state).toLowerCase()
  if (conclusion === 'success' || state === 'success') return 'passed'
  if (['failure', 'timed_out', 'action_required', 'startup_failure'].includes(conclusion) || state === 'failure' || state === 'error') return 'failed'
  if (conclusion === 'cancelled') return 'cancelled'
  if (conclusion === 'skipped') return 'skipped'
  if (conclusion === 'neutral') return 'neutral'
  if (status === 'completed' && !conclusion) return 'neutral'
  return 'pending'
}

/** gh pr view's answer, as the PR pane shows it. */
export function parsePr(raw: unknown): PrStatus | null {
  if (!isObj(raw) || typeof raw.number !== 'number' || typeof raw.url !== 'string') return null
  const rollup = Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup.filter(isObj) : []
  const state = str(raw.state).toUpperCase()
  return {
    number: raw.number,
    url: raw.url,
    title: str(raw.title),
    state: state === 'MERGED' || state === 'CLOSED' ? state : 'OPEN',
    draft: raw.isDraft === true,
    base: str(raw.baseRefName),
    head: str(raw.headRefName),
    mergeable: str(raw.mergeable, 'UNKNOWN'),
    mergeState: str(raw.mergeStateStatus).toLowerCase(),
    review: typeof raw.reviewDecision === 'string' && raw.reviewDecision ? raw.reviewDecision : null,
    checks: rollup.map((c) => ({ name: str(c.name) || str(c.context) || 'check', state: checkState(c), url: str(c.detailsUrl) || str(c.targetUrl) || null })),
    autoMerge: isObj(raw.autoMergeRequest),
    comments: (Array.isArray(raw.comments) ? raw.comments.length : 0) + (Array.isArray(raw.reviews) ? raw.reviews.length : 0),
    updatedAt: str(raw.updatedAt)
  }
}

/** The session's PR: its linked URL's, else the one for the branch checked out in `cwd`; null when there's none. */
export async function prFor(cwd: string, url: string | null): Promise<PrStatus | null> {
  try {
    const { stdout } = await run(gh(), ['pr', 'view', ...(url ? [url] : []), '--json', FIELDS], { cwd, windowsHide: true, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
    return parsePr(JSON.parse(stdout))
  } catch (error) {
    const said = String((error as { stderr?: string }).stderr ?? (error as Error).message)
    if (/no pull requests found|could not find|not a git repository|no default remote/i.test(said)) return null
    throw new Error(said.trim().split('\n')[0] || 'gh couldn’t read the pull request.')
  }
}

/** Merges the PR now (squash, merge or rebase). */
export async function mergePr(cwd: string, url: string, method: 'squash' | 'merge' | 'rebase'): Promise<void> {
  await run(gh(), ['pr', 'merge', url, `--${method}`], { cwd, windowsHide: true, timeout: 60_000 })
}

/** Turns GitHub's auto-merge on (it merges once checks and reviews pass) or off. */
export async function setAutoMerge(cwd: string, url: string, enabled: boolean, method: 'squash' | 'merge' | 'rebase' = 'squash'): Promise<void> {
  await run(gh(), ['pr', 'merge', url, ...(enabled ? ['--auto', `--${method}`] : ['--disable-auto'])], { cwd, windowsHide: true, timeout: 60_000 })
}

/**
 * What the monitor tells a session with Auto-fix on, from what changed since
 * it last looked: checks that failed, a merge conflict, new review comments.
 * Null when there's nothing new.
 */
export function monitorNews(before: PrStatus | null, now: PrStatus): string | null {
  if (now.state !== 'OPEN') return null
  const lines: string[] = []
  const failedBefore = new Set(before?.checks.filter((c) => c.state === 'failed').map((c) => c.name) ?? [])
  const failed = now.checks.filter((c) => c.state === 'failed' && !failedBefore.has(c.name))
  if (failed.length) lines.push(`Checks failed: ${failed.map((c) => (c.url ? `${c.name} (${c.url})` : c.name)).join(', ')}. Read the logs (gh run view --log-failed, or gh pr checks), fix the cause, commit and push.`)
  if (now.mergeable === 'CONFLICTING' && before?.mergeable !== 'CONFLICTING') lines.push(`The branch conflicts with ${now.base}: merge ${now.base} into it, resolve the conflicts, commit and push.`)
  if (before && now.comments > before.comments) lines.push(`${now.comments - before.comments} new review comment${now.comments - before.comments === 1 ? '' : 's'}: read them (gh pr view ${now.number} --comments) and address them.`)
  if (!lines.length) return null
  return `<ci-monitor-event>\nPull request #${now.number} (${now.url}):\n${lines.map((l) => `- ${l}`).join('\n')}\n</ci-monitor-event>`
}
