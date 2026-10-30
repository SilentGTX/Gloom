// The transcript indexer's utility process: indexes ~/.claude/projects at start
// (reusing its cache), then watches it and reports what changed. It runs outside
// the main process, so reading a big transcript never stalls the window.
import { watch, type FSWatcher } from 'chokidar'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { WorkerReply, WorkerRequest } from '@shared/ipc'
import { collectSessions, INDEX_VERSION, indexAll, indexAppended, indexFile, isTranscript, type FileIndex, type IndexCache } from './indexer'

/** Changes are batched: a session streaming in the Claude app writes several lines a second. */
const BATCH_MS = 150
/** But a busy file still reports at least this often. */
const BATCH_MAX_MS = 600
const CACHE_SAVE_MS = 10_000
/** Claude Code's folder can appear later (first run); look for it this often. */
const APPEAR_POLL_MS = 15_000

const port = process.parentPort
let projectsDir = ''
let cacheFile = ''
let files: Record<string, FileIndex> = {}
let watcher: FSWatcher | null = null

function post(reply: WorkerReply): void {
  port.postMessage(reply)
}

function loadCache(): Record<string, FileIndex> {
  try {
    const cache = JSON.parse(readFileSync(cacheFile, 'utf8')) as IndexCache
    return cache.version === INDEX_VERSION && cache.files && typeof cache.files === 'object' ? cache.files : {}
  } catch {
    return {}
  }
}

let cacheTimer: ReturnType<typeof setTimeout> | null = null
function saveCacheSoon(): void {
  cacheTimer ??= setTimeout(saveCache, CACHE_SAVE_MS)
}
function saveCache(): void {
  if (cacheTimer) clearTimeout(cacheTimer)
  cacheTimer = null
  try {
    mkdirSync(dirname(cacheFile), { recursive: true })
    const cache: IndexCache = { version: INDEX_VERSION, files }
    writeFileSync(cacheFile + '.tmp', JSON.stringify(cache))
    renameSync(cacheFile + '.tmp', cacheFile)
  } catch {
    // Only a cache: the next start reads the files again.
  }
}

// ─── Changes ─────────────────────────────────────────────────────────────────

const dirty = new Set<string>()
let batchTimer: ReturnType<typeof setTimeout> | null = null
let batchStarted = 0

function queue(path: string): void {
  dirty.add(path)
  const now = Date.now()
  if (!batchTimer) batchStarted = now
  else clearTimeout(batchTimer)
  batchTimer = setTimeout(flush, now - batchStarted >= BATCH_MAX_MS ? 0 : BATCH_MS)
}

function flush(): void {
  batchTimer = null
  const ids = new Set<string>()
  for (const path of dirty) {
    ids.add(basename(path, '.jsonl'))
    try {
      if (!existsSync(path)) {
        delete files[path]
        continue
      }
      const prev = files[path]
      files[path] = prev ? indexAppended(path, prev) : indexFile(path)
    } catch {
      // Locked or half-gone: the next event retries.
    }
  }
  dirty.clear()
  // Each changed ID is re-collected from every file that holds it.
  const now = collectSessions(files, ids)
  const upsert = [...now.values()]
  const remove = [...ids].filter((id) => !now.has(id))
  if (upsert.length || remove.length) post({ type: 'changed', upsert, remove })
  saveCacheSoon()
}

function startWatching(): void {
  watcher = watch(projectsDir, {
    ignoreInitial: true,
    // <projects>/<project>/<id>.jsonl; subagent transcripts live deeper.
    depth: 1,
    ignored: (path, stats) => (stats?.isFile() ?? /\.\w+$/.test(path)) && !isTranscript(path, projectsDir)
  })
  watcher.on('add', queue).on('change', queue).on('unlink', queue)
  watcher.on('unlinkDir', (dir) => {
    for (const path of Object.keys(files)) if (dirname(path) === dir) queue(path)
  })
  watcher.on('error', (error) => post({ type: 'error', message: String(error) }))
}

function start(request: Extract<WorkerRequest, { type: 'start' }>): void {
  projectsDir = request.projectsDir
  cacheFile = request.cacheFile
  if (!existsSync(projectsDir)) {
    // No Claude Code sessions yet. Report an empty index, and look again later.
    post({ type: 'ready', sessions: [], stats: { files: 0, read: 0, ms: 0 } })
    const poll = setInterval(() => {
      if (!existsSync(projectsDir)) return
      clearInterval(poll)
      index()
    }, APPEAR_POLL_MS)
    return
  }
  index()
}

function index(): void {
  const result = indexAll(projectsDir, loadCache())
  files = result.files
  post({ type: 'ready', sessions: [...collectSessions(files).values()], stats: result.stats })
  if (result.stats.read > 0) saveCache()
  startWatching()
}

port.on('message', ({ data }: { data: WorkerRequest }) => {
  if (data.type === 'start') start(data)
  else if (data.type === 'stop') {
    void watcher?.close()
    saveCache()
    process.exit(0)
  }
})
