// The PRs of the sessions Gloom knows, kept fresh while it matters: when the
// PR pane asks, and every few minutes for a session whose monitor is on
// (Auto-fix, or archiving when the PR closes). Auto-fix sends the session a
// <ci-monitor-event> message when checks fail, the branch conflicts, or
// reviewers comment; a PR that merges or closes archives its session when
// you asked for that.
import type { LibraryOp, SessionEntry } from '@shared/library'
import { monitorNews, prFor, type PrStatus } from './pr'

/** How often a monitored PR is read again. */
const MONITOR_MS = 90_000
/** A PR read this recently is answered from what's known. */
const FRESH_MS = 20_000

export interface PrHost {
  cwd(id: string): string | null
  entry(id: string): SessionEntry | undefined
  /** Sessions whose monitor is on, or that have a PR Gloom has seen (for archiving on close). */
  watched(): string[]
  applyLibrary(op: LibraryOp): void
  send(id: string, text: string): void
  archiveOnClose(): boolean
  changed(id: string, status: PrStatus | null): void
}

export class PrService {
  private readonly known = new Map<string, { status: PrStatus | null; at: number }>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly host: PrHost) {}

  start(): void {
    this.timer ??= setInterval(() => void this.sweep(), MONITOR_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** The session's PR (null: none), read again when what's known is older than `maxAge`. */
  async status(id: string, maxAge = FRESH_MS): Promise<PrStatus | null> {
    const have = this.known.get(id)
    if (have && Date.now() - have.at < maxAge) return have.status
    const cwd = this.host.cwd(id)
    if (!cwd) return null
    const entry = this.host.entry(id)
    const status = await prFor(cwd, entry?.pr?.url ?? null)
    this.record(id, status)
    return status
  }

  /** What's known, without asking GitHub. */
  cached(id: string): PrStatus | null {
    return this.known.get(id)?.status ?? null
  }

  private record(id: string, status: PrStatus | null): void {
    const before = this.known.get(id)?.status ?? null
    this.known.set(id, { status, at: Date.now() })
    if (JSON.stringify(before) !== JSON.stringify(status)) this.host.changed(id, status)
    if (!status) return
    const entry = this.host.entry(id)
    // Auto-fix: what changed since the last look goes to the session.
    if (entry?.pr?.autoFix && before) {
      const news = monitorNews(before, status)
      if (news) this.host.send(id, news)
    }
    // Merged or closed: the session goes to Archived, when you asked for that.
    if (status.state !== 'OPEN' && before?.state === 'OPEN' && (entry?.pr?.autoArchive || this.host.archiveOnClose()) && !entry?.archived) {
      this.host.applyLibrary({ type: 'setArchived', ids: [id], archived: true })
    }
  }

  /** Reads every watched session's PR again. */
  private async sweep(): Promise<void> {
    for (const id of this.host.watched()) {
      try {
        await this.status(id, MONITOR_MS / 2)
      } catch {
        // gh signed out, offline: the next sweep tries again.
      }
    }
  }
}
