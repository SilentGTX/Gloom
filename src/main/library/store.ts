// The library on disk: one JSON file in userData. Writes go to a temporary file
// that replaces the current one, which is kept as `.bak` and read instead if the
// current file is ever corrupt.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { generateKeyBetween } from 'fractional-indexing'
import { byOrder, emptyLibrary, LIBRARY_VERSION, subtreeIds, type Folder, type LibraryData, type SessionEntry } from '@shared/library'

const SAVE_DELAY_MS = 400

export type LoadedFrom = 'file' | 'backup' | 'new'

/** Reads the library, falling back to the backup, then to an empty one. */
export function loadLibrary(file: string): { library: LibraryData; from: LoadedFrom } {
  for (const [path, from] of [
    [file, 'file'],
    [file + '.bak', 'backup']
  ] as const) {
    if (!existsSync(path)) continue
    try {
      return { library: sanitize(JSON.parse(readFileSync(path, 'utf8'))), from }
    } catch {
      // Corrupt: try the next one.
    }
  }
  return { library: emptyLibrary(), from: 'new' }
}

/** Writes atomically: temp file, current → .bak, temp → current. */
export function saveLibrary(file: string, library: LibraryData): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file + '.tmp', JSON.stringify(library, null, 1))
  if (existsSync(file)) renameSync(file, file + '.bak')
  renameSync(file + '.tmp', file)
}

/** Debounced saving for the main process; `flush()` on quit. */
export class LibraryStore {
  private timer: ReturnType<typeof setTimeout> | null = null
  library: LibraryData
  readonly from: LoadedFrom

  constructor(private readonly file: string) {
    const loaded = loadLibrary(file)
    this.library = loaded.library
    this.from = loaded.from
  }

  set(library: LibraryData): void {
    if (library === this.library) return
    this.library = library
    this.timer ??= setTimeout(() => this.flush(), SAVE_DELAY_MS)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      saveLibrary(this.file, this.library)
    } catch (error) {
      console.error('Gloom: could not save the library', error)
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'

/**
 * Takes whatever is on disk and returns a library the app can trust: unknown
 * fields dropped, orphaned folders lifted to the top, cycles broken, and every
 * sibling group keyed in order.
 */
export function sanitize(raw: unknown): LibraryData {
  if (!isRecord(raw) || !Array.isArray(raw.folders) || !isRecord(raw.sessions)) throw new Error('not a library')
  const seen = new Set<string>()
  let folders: Folder[] = []
  for (const f of raw.folders) {
    if (!isRecord(f) || !isString(f.id) || seen.has(f.id) || !isString(f.name)) continue
    seen.add(f.id)
    const folder: Folder = {
      id: f.id,
      name: f.name,
      parentId: isString(f.parentId) ? f.parentId : null,
      order: isString(f.order) ? f.order : '',
      expanded: f.expanded === true
    }
    if (isRecord(f.defaults)) {
      const d = f.defaults
      folder.defaults = { cwd: isString(d.cwd) ? d.cwd : undefined, model: isString(d.model) ? d.model : undefined, mode: isString(d.mode) ? d.mode : undefined }
    }
    if (Array.isArray(f.fileFrom)) {
      const paths = f.fileFrom.filter(isString)
      if (paths.length) folder.fileFrom = paths
    }
    folders.push(folder)
  }
  // Orphans go to the top; so does any folder caught in a cycle.
  folders = folders.map((f) => (f.parentId !== null && (!seen.has(f.parentId) || subtreeIds(folders, f.id).has(f.parentId)) ? { ...f, parentId: null } : f))
  folders = rekey(folders)

  const sessions: Record<string, SessionEntry> = {}
  for (const [id, e] of Object.entries(raw.sessions)) {
    if (!isRecord(e)) continue
    const entry: SessionEntry = {}
    if (isString(e.folderId) && seen.has(e.folderId)) entry.folderId = e.folderId
    if (e.pinned === true) entry.pinned = true
    if (e.archived === true) entry.archived = true
    if (isString(e.title) && e.title.trim()) entry.title = e.title
    if (typeof e.missingSince === 'number') entry.missingSince = e.missingSince
    if (e.unread === true) entry.unread = true
    if (isString(e.startedBy)) entry.startedBy = e.startedBy
    if (isString(e.name) && e.name.length <= 24) entry.name = e.name
    if (isString(e.routine)) entry.routine = e.routine
    if (isRecord(e.ssh) && isString(e.ssh.host) && isString(e.ssh.cwd)) entry.ssh = { host: e.ssh.host, cwd: e.ssh.cwd }
    if (isRecord(e.pr) && (e.pr.url === null || isString(e.pr.url))) entry.pr = { url: (e.pr.url as string | null) ?? null, ...(e.pr.autoFix === true ? { autoFix: true } : {}), ...(e.pr.autoArchive === true ? { autoArchive: true } : {}) }
    if (Array.isArray(e.folders) && e.folders.every(isString) && e.folders.length) entry.folders = e.folders.slice(0, 100)
    sessions[id] = entry
  }
  const trustedFolders = Array.isArray(raw.trustedFolders) ? raw.trustedFolders.filter(isString) : []
  return { version: LIBRARY_VERSION, folders, sessions, trustedFolders }
}

/** Gives any sibling group with missing, duplicate or invalid keys fresh ones, in its current order. */
function rekey(folders: Folder[]): Folder[] {
  const groups = new Map<string | null, Folder[]>()
  for (const f of folders) groups.set(f.parentId, [...(groups.get(f.parentId) ?? []), f])
  const fresh = new Map<string, string>()
  for (const group of groups.values()) {
    group.sort(byOrder)
    const valid = group.every((f, i) => f.order !== '' && (i === 0 || group[i - 1].order < f.order) && isKey(f.order))
    if (valid) continue
    let key: string | null = null
    for (const f of group) fresh.set(f.id, (key = generateKeyBetween(key, null)))
  }
  return fresh.size ? folders.map((f) => (fresh.has(f.id) ? { ...f, order: fresh.get(f.id)! } : f)) : folders
}

function isKey(order: string): boolean {
  try {
    generateKeyBetween(order, null)
    return true
  } catch {
    return false
  }
}
