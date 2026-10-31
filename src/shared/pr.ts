// A session's pull request, as Gloom reads it with gh (main/git/pr.ts) and the PR pane shows it.

export interface PrCheck {
  name: string
  /** passed, failed, pending, skipped, cancelled, neutral */
  state: string
  url: string | null
}

export interface PrStatus {
  number: number
  url: string
  title: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  draft: boolean
  base: string
  head: string
  /** MERGEABLE, CONFLICTING, UNKNOWN */
  mergeable: string
  /** clean, blocked, behind, dirty, unstable… (lowercased GitHub mergeStateStatus) */
  mergeState: string
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or null */
  review: string | null
  checks: PrCheck[]
  autoMerge: boolean
  /** Comments and reviews so far: the monitor notices new ones. */
  comments: number
  updatedAt: string
}
