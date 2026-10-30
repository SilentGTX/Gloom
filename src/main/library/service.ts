// The library in the main process: the transcript index (kept by a utility
// process), your folders and placements (the store), and what the window asks
// of them. Main owns the library; the window sends operations and gets every
// change broadcast back.
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ApplyResult, LibrarySnapshot, SessionsChange, WorkerReply, WorkerRequest } from '@shared/ipc'
import { applyOp, LibraryError, noticeSessions, type LibraryData, type LibraryOp, type SessionMeta } from '@shared/library'
import transcriptsWorker from '../../worker/transcripts?modulePath'
import { parseOp } from './ops'
import { LibraryStore } from './store'

/** Claude Code's folder: CLAUDE_CONFIG_DIR when set, as the CLI does, else ~/.claude. */
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

const RESTART_DELAYS_MS = [1_000, 5_000, 30_000]

export interface LibraryEvents {
  library(change: { rev: number; library: LibraryData }): void
  sessions(change: SessionsChange): void
}

export class LibraryService {
  private readonly store: LibraryStore
  private readonly index = new Map<string, SessionMeta>()
  private indexed = false
  private rev = 1
  private worker: UtilityProcess | null = null
  private restarts = 0
  private stopping = false

  constructor(private readonly events: LibraryEvents) {
    this.store = new LibraryStore(join(app.getPath('userData'), 'library.json'))
    if (this.store.from === 'backup') console.warn('Gloom: library.json was unreadable; restored from library.json.bak')
  }

  start(): void {
    const child = utilityProcess.fork(transcriptsWorker, [], { serviceName: 'Gloom Transcripts' })
    this.worker = child
    child.on('message', (reply: WorkerReply) => this.onWorker(reply))
    child.on('exit', (code) => {
      if (this.worker === child) this.worker = null
      if (this.stopping) return
      console.error(`Gloom: the transcript indexer exited (${code})`)
      const delay = RESTART_DELAYS_MS[this.restarts++]
      if (delay !== undefined) setTimeout(() => !this.stopping && this.start(), delay)
    })
    const request: WorkerRequest = {
      type: 'start',
      projectsDir: join(claudeDir(), 'projects'),
      cacheFile: join(app.getPath('userData'), 'transcript-index.json')
    }
    child.postMessage(request)
  }

  stop(): void {
    this.stopping = true
    this.store.flush()
    const stop: WorkerRequest = { type: 'stop' }
    this.worker?.postMessage(stop)
    const worker = this.worker
    setTimeout(() => worker?.kill(), 1500).unref()
  }

  snapshot(): LibrarySnapshot {
    return { rev: this.rev, library: this.store.library, sessions: [...this.index.values()], indexed: this.indexed }
  }

  session(id: string): SessionMeta | undefined {
    return this.index.get(id)
  }

  /** Runs an operation from the window. Throws a LibraryError the window can show. */
  apply(raw: unknown): ApplyResult {
    const op: LibraryOp = parseOp(raw)
    const result = applyOp(this.store.library, op, { sessions: this.index, newId, now: Date.now() })
    this.commit(result.library)
    return { rev: this.rev, library: this.store.library, undo: result.undo, folderId: result.folderId }
  }

  private commit(library: LibraryData): void {
    if (library === this.store.library) return
    this.store.set(library)
    this.rev++
    this.events.library({ rev: this.rev, library })
  }

  private onWorker(reply: WorkerReply): void {
    if (reply.type === 'error') {
      console.error('Gloom: transcript watcher:', reply.message)
      return
    }
    this.restarts = 0
    const now = Date.now()
    if (reply.type === 'ready') {
      const before = new Set(this.index.keys())
      this.index.clear()
      for (const s of reply.sessions) this.index.set(s.id, s)
      const missing = Object.keys(this.store.library.sessions).filter((id) => !this.index.has(id))
      this.commit(noticeSessions(this.store.library, reply.sessions, missing, now))
      this.indexed = true
      const remove = [...before].filter((id) => !this.index.has(id))
      this.events.sessions({ upsert: reply.sessions, remove, indexed: true })
      console.log(`Gloom: indexed ${reply.stats.files} transcripts in ${reply.stats.ms} ms (${reply.stats.read} read, the rest cached)`)
      return
    }
    for (const s of reply.upsert) this.index.set(s.id, s)
    for (const id of reply.remove) this.index.delete(id)
    this.commit(noticeSessions(this.store.library, reply.upsert, reply.remove, now))
    this.events.sessions({ upsert: reply.upsert, remove: reply.remove, indexed: this.indexed })
  }
}

function newId(): string {
  return 'f' + randomBytes(6).toString('base64url')
}

export { LibraryError }
