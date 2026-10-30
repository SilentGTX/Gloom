// The library in the main process: the transcript index (kept by a utility
// process), your folders and placements (the store), and what the window asks
// of them. Main owns the library; the window sends operations and gets every
// change broadcast back.
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { ApplyResult, LibrarySnapshot, SessionsChange, TranscriptChange, WorkerReply, WorkerRequest } from '@shared/ipc'
import { applyOp, LibraryError, noticeSessions, type LibraryData, type LibraryOp, type SessionMeta } from '@shared/library'
import type { Cursor, TranscriptPage } from '@shared/transcript'
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
  transcript(change: TranscriptChange): void
}

type Asked = Extract<WorkerRequest, { reqId: number }>
type Ask = Asked extends infer R ? (R extends Asked ? Omit<R, 'reqId'> : never) : never

export class LibraryService {
  private readonly store: LibraryStore
  private readonly index = new Map<string, SessionMeta>()
  private indexed = false
  private rev = 1
  private worker: UtilityProcess | null = null
  private restarts = 0
  private stopping = false
  private nextReq = 1
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  /** Entry types already logged as new, so each is logged once. */
  private readonly unknownLogged = new Set<string>()

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
      for (const { reject } of this.pending.values()) reject(new LibraryError('The transcript reader stopped. Try again.'))
      this.pending.clear()
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

  /** A page of a session's transcript; with `follow`, its changes are sent as `transcript` events. */
  readTranscript(id: string, cursor: Cursor | null, follow: boolean): Promise<TranscriptPage> {
    const meta = this.index.get(id)
    if (!meta) return Promise.reject(new LibraryError('That session’s transcript is gone.'))
    return this.ask({ type: 'page', file: meta.file, cursor, follow }) as Promise<TranscriptPage>
  }

  /** An image or a long text a page left in the file. */
  readBlob(id: string, ref: string): Promise<unknown> {
    const meta = this.index.get(id)
    if (!meta) return Promise.reject(new LibraryError('That session’s transcript is gone.'))
    return this.ask({ type: 'blob', file: meta.file, ref })
  }

  unfollow(): void {
    const request: WorkerRequest = { type: 'unfollow' }
    this.worker?.postMessage(request)
  }

  private ask(request: Ask): Promise<unknown> {
    const worker = this.worker
    if (!worker) return Promise.reject(new LibraryError('The transcript reader is starting. Try again.'))
    const reqId = this.nextReq++
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject })
      worker.postMessage({ ...request, reqId } as WorkerRequest)
    })
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
    switch (reply.type) {
      case 'error':
        console.error('Gloom: transcript watcher:', reply.message)
        return
      case 'answer':
      case 'failed': {
        const waiting = this.pending.get(reply.reqId)
        this.pending.delete(reply.reqId)
        if (reply.type === 'answer') waiting?.resolve(reply.value)
        else waiting?.reject(new LibraryError(reply.message))
        return
      }
      case 'transcript':
        this.events.transcript({ id: basename(reply.file, '.jsonl'), update: reply.update })
        return
      case 'unknown': {
        // The format is undocumented and the CLI updates itself: note what's new, with the CLI that wrote it.
        const fresh = reply.types.filter((t) => !this.unknownLogged.has(t))
        fresh.forEach((t) => this.unknownLogged.add(t))
        const version = this.index.get(basename(reply.file, '.jsonl'))?.version ?? 'unknown'
        if (fresh.length) console.warn(`Gloom: transcript entries new to Gloom: ${fresh.join(', ')} (CLI ${version})`)
        return
      }
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
