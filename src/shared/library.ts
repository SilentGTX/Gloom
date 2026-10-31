// The library: how you organise sessions (folders, placement, pins, archive,
// renames, filing rules, trusted folders), and what the indexer reads from
// Claude Code's transcripts. Gloom never writes into those transcripts.
// Pure functions, shared by main (which owns and saves the library) and the
// renderer (which derives the tree and the lists from it).
import { generateKeyBetween } from 'fractional-indexing'

export const LIBRARY_VERSION = 1
/** A missing transcript's entry is kept this long, in case the file comes back. */
export const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000
/** "Recent" is anything active in the last week. */
export const RECENT_MS = 7 * 24 * 60 * 60 * 1000
/** A transcript that grew this recently, while Gloom wasn't running it, is running elsewhere. */
export const ELSEWHERE_MS = 60 * 1000

/** What the indexer reads from one transcript. */
export interface SessionMeta {
  /** The file name without `.jsonl`: the session ID. */
  id: string
  /** Absolute path of the transcript. */
  file: string
  /** Its folder under ~/.claude/projects. */
  project: string
  /** The working folder it last ran in. */
  cwd: string | null
  /** Claude's title: the Claude app's (custom-title) over the CLI's (ai-title). */
  title: string | null
  firstPrompt: string | null
  lastPrompt: string | null
  /** Milliseconds since the epoch. */
  created: number
  /** The newest entry's time: its last activity. */
  updated: number
  size: number
  /** claude-desktop (the Claude app), sdk-ts (the Agent SDK, Gloom), sdk-cli (`claude -p`), cli… */
  entrypoint: string | null
  gitBranch: string | null
  /** The CLI version that last wrote it. */
  version: string | null
  /** The Claude app's copy of a session that ran on another machine (ssh-<uuid> folders). */
  remote: boolean
}

export interface FolderDefaults {
  cwd?: string
  model?: string
  mode?: string
}

export interface Folder {
  id: string
  name: string
  parentId: string | null
  /** Fractional index among its siblings, so a move rewrites one entry. */
  order: string
  expanded: boolean
  /** Prefill New Session inside it (Phase 4). */
  defaults?: FolderDefaults
  /** Working paths it claims: new Unfiled sessions under them file here. */
  fileFrom?: string[]
}

export interface SessionEntry {
  folderId?: string
  pinned?: boolean
  archived?: boolean
  /** Your rename. It wins over Claude's title and stays in Gloom. */
  title?: string
  /** When its transcript went missing; the entry is pruned 30 days later. */
  missingSince?: number
  /** Marked unread (the blue dot): by you, or by Claude. Opening it reads it. */
  unread?: boolean
  /** Folders besides its working folder it may use (Add Folder…), for every process it starts. */
  folders?: string[]
  /** The session that started it (a side session), and the short name its family calls it by. */
  startedBy?: string
  name?: string
}

export interface LibraryData {
  version: number
  folders: Folder[]
  /** Every session the library has seen, by session ID. */
  sessions: Record<string, SessionEntry>
  trustedFolders: string[]
}

export function emptyLibrary(): LibraryData {
  return { version: LIBRARY_VERSION, folders: [], sessions: {}, trustedFolders: [] }
}

export class LibraryError extends Error {}

// ─── Tree ────────────────────────────────────────────────────────────────────

/** Fractional-index keys compare byte by byte, never by locale. */
export function byOrder(a: Folder, b: Folder): number {
  return a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function childrenOf(folders: readonly Folder[], parentId: string | null): Folder[] {
  return folders.filter((f) => f.parentId === parentId).sort(byOrder)
}

/** A folder's ID and every ID below it. */
export function subtreeIds(folders: readonly Folder[], id: string): Set<string> {
  const ids = new Set([id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parentId !== null && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id)
        grew = true
      }
    }
  }
  return ids
}

/** The folder and its ancestors, outermost first. */
export function folderPath(folders: readonly Folder[], id: string): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const path: Folder[] = []
  for (let f = byId.get(id); f && !path.includes(f); f = f.parentId ? byId.get(f.parentId) : undefined) path.unshift(f)
  return path
}

export interface TreeRow {
  folder: Folder
  depth: number
  hasChildren: boolean
  /** Position among its siblings (1-based) and their count, for the tree's accessibility. */
  posInSet: number
  setSize: number
}

/** The folders as they show in the outline: depth-first, children of collapsed folders left out. */
export function flattenTree(folders: readonly Folder[], { all = false }: { all?: boolean } = {}): TreeRow[] {
  const kids = new Map<string | null, Folder[]>()
  for (const f of folders) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f])
  for (const list of kids.values()) list.sort(byOrder)
  const rows: TreeRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    const list = kids.get(parentId) ?? []
    list.forEach((folder, i) => {
      const children = kids.get(folder.id) ?? []
      rows.push({ folder, depth, hasChildren: children.length > 0, posInSet: i + 1, setSize: list.length })
      if ((all || folder.expanded) && depth < 64) walk(folder.id, depth + 1)
    })
  }
  walk(null, 0)
  return rows
}

// ─── Paths and filing rules ──────────────────────────────────────────────────

/** Windows paths compare case-insensitively, whichever slash they use. */
export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function pathContains(parent: string, child: string): boolean {
  const p = normalizePath(parent)
  const c = normalizePath(child)
  return p !== '' && (c === p || c.startsWith(p + '/'))
}

/** The folder whose filing rule claims `cwd` most specifically: the deepest claimed path wins. */
export function claimingFolder(folders: readonly Folder[], cwd: string | null | undefined): string | undefined {
  if (!cwd) return undefined
  let best: { id: string; length: number } | undefined
  for (const f of folders) {
    for (const path of f.fileFrom ?? []) {
      const length = normalizePath(path).length
      if (pathContains(path, cwd) && (!best || length > best.length)) best = { id: f.id, length }
    }
  }
  return best?.id
}

/**
 * Records what the index found. Sessions seen for the first time are filed by
 * the rules (later changes never re-file them, so a session you moved stays
 * put); missing transcripts are marked, and pruned after 30 days.
 */
export function noticeSessions(lib: LibraryData, present: readonly SessionMeta[], missing: readonly string[], now: number): LibraryData {
  let sessions: Record<string, SessionEntry> | null = null
  const edit = () => (sessions ??= { ...lib.sessions })
  for (const meta of present) {
    const entry = lib.sessions[meta.id]
    if (!entry) {
      const folderId = claimingFolder(lib.folders, meta.cwd)
      edit()[meta.id] = folderId ? { folderId } : {}
    } else if (entry.missingSince !== undefined) {
      const { missingSince: _, ...rest } = entry
      edit()[meta.id] = rest
    }
  }
  for (const id of missing) {
    const entry = lib.sessions[id]
    if (!entry) continue
    if (entry.missingSince === undefined) edit()[id] = { ...entry, missingSince: now }
    else if (now - entry.missingSince > PRUNE_AFTER_MS) delete edit()[id]
  }
  return sessions ? { ...lib, sessions } : lib
}

// ─── Operations ──────────────────────────────────────────────────────────────

export type LibraryOp =
  | { type: 'createFolder'; parentId: string | null; name?: string }
  | { type: 'renameFolder'; id: string; name: string }
  /** `index` is its position among the new siblings, not counting itself. */
  | { type: 'moveFolder'; id: string; parentId: string | null; index: number }
  | { type: 'deleteFolder'; id: string }
  /** Undoes a delete: the folders, and the sessions that were in them. */
  | { type: 'restoreFolders'; folders: Folder[]; placements: Record<string, string> }
  | { type: 'setExpanded'; ids: string[]; expanded: boolean }
  /** `folderId: null` is Unfiled. */
  | { type: 'moveSessions'; ids: string[]; folderId: string | null }
  | { type: 'placeSessions'; placements: Record<string, string | null> }
  | { type: 'setPinned'; ids: string[]; pinned: boolean }
  | { type: 'setArchived'; ids: string[]; archived: boolean }
  | { type: 'setUnread'; ids: string[]; unread: boolean }
  /** Every folder besides its working folder the session may use. */
  | { type: 'setSessionFolders'; id: string; folders: string[] }
  /** A side session: who started it, its name, and the title it was started with (until Claude Code names it). */
  | { type: 'linkSession'; id: string; startedBy: string; name: string; title: string | null }
  /** `title: null` goes back to Claude's title. */
  | { type: 'renameSession'; id: string; title: string | null }
  | { type: 'setFilingRules'; id: string; paths: string[] }
  /** What New Session inside the folder starts with; null clears them. */
  | { type: 'setFolderDefaults'; id: string; defaults: FolderDefaults | null }
  /** You said Claude may run in this folder (its hooks and MCP servers included). */
  | { type: 'trustFolder'; path: string }

export interface OpContext {
  /** The index, for the working folders filing rules match against. */
  sessions: ReadonlyMap<string, SessionMeta>
  newId(): string
  now: number
}

export interface OpResult {
  library: LibraryData
  /** The op that puts things back, for Undo (Ctrl+Z, and the toasts' Undo buttons). */
  undo?: LibraryOp
  /** The folder createFolder made. */
  folderId?: string
}

const NAME_MAX = 120
const TITLE_MAX = 300

/** Collapses whitespace (pasted newlines included) and caps the length. */
export function cleanName(name: string, max = NAME_MAX): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, max)
}

/** A key after every sibling's. */
function lastOrder(folders: readonly Folder[], parentId: string | null): string {
  const siblings = childrenOf(folders, parentId)
  return generateKeyBetween(siblings.at(-1)?.order ?? null, null)
}

/** A key between two siblings; re-keys the group first if their keys are tangled. */
function orderBetween(siblings: Folder[], index: number): { order: string; rekeyed?: Map<string, string> } {
  const before = siblings[index - 1]?.order ?? null
  const after = siblings[index]?.order ?? null
  try {
    return { order: generateKeyBetween(before, after) }
  } catch {
    const rekeyed = new Map<string, string>()
    let key: string | null = null
    for (const s of siblings) rekeyed.set(s.id, (key = generateKeyBetween(key, null)))
    const prev = index > 0 ? rekeyed.get(siblings[index - 1].id)! : null
    const next = index < siblings.length ? rekeyed.get(siblings[index].id)! : null
    return { order: generateKeyBetween(prev, next), rekeyed }
  }
}

function setEntries(lib: LibraryData, ids: readonly string[], update: (entry: SessionEntry) => SessionEntry): LibraryData {
  const sessions = { ...lib.sessions }
  for (const id of ids) sessions[id] = update(sessions[id] ?? {})
  return { ...lib, sessions }
}

function withoutKey<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _, ...rest } = obj
  return rest
}

export function applyOp(lib: LibraryData, op: LibraryOp, ctx: OpContext): OpResult {
  const find = (id: string) => lib.folders.find((f) => f.id === id)
  const need = (id: string) => {
    const f = find(id)
    if (!f) throw new LibraryError('That folder no longer exists.')
    return f
  }

  switch (op.type) {
    case 'createFolder': {
      if (op.parentId !== null) need(op.parentId)
      const folder: Folder = {
        id: ctx.newId(),
        name: cleanName(op.name ?? '') || 'New Folder',
        parentId: op.parentId,
        order: lastOrder(lib.folders, op.parentId),
        expanded: false
      }
      // Open the parent, so the new folder shows.
      const folders = lib.folders.map((f) => (f.id === op.parentId && !f.expanded ? { ...f, expanded: true } : f))
      return { library: { ...lib, folders: [...folders, folder] }, folderId: folder.id, undo: { type: 'deleteFolder', id: folder.id } }
    }

    case 'renameFolder': {
      const before = need(op.id).name
      const name = cleanName(op.name)
      if (!name || name === before) return { library: lib }
      return { library: { ...lib, folders: lib.folders.map((f) => (f.id === op.id ? { ...f, name } : f)) }, undo: { type: 'renameFolder', id: op.id, name: before } }
    }

    case 'moveFolder': {
      const folder = need(op.id)
      if (op.parentId !== null) {
        need(op.parentId)
        if (subtreeIds(lib.folders, op.id).has(op.parentId)) throw new LibraryError('A folder can’t move inside itself.')
      }
      // Where it was, for Undo: its old parent, and its place among the others there.
      const back: LibraryOp = { type: 'moveFolder', id: op.id, parentId: folder.parentId, index: childrenOf(lib.folders, folder.parentId).findIndex((f) => f.id === op.id) }
      const siblings = childrenOf(lib.folders, op.parentId).filter((f) => f.id !== op.id)
      const index = Math.max(0, Math.min(siblings.length, Math.floor(op.index)))
      const { order, rekeyed } = orderBetween(siblings, index)
      const folders = lib.folders.map((f) => {
        if (f.id === folder.id) return { ...f, parentId: op.parentId, order }
        const key = rekeyed?.get(f.id)
        return key ? { ...f, order: key } : f
      })
      return { library: { ...lib, folders }, undo: back }
    }

    case 'deleteFolder': {
      need(op.id)
      const ids = subtreeIds(lib.folders, op.id)
      const removed = lib.folders.filter((f) => ids.has(f.id))
      const placements: Record<string, string> = {}
      const sessions = { ...lib.sessions }
      for (const [sid, entry] of Object.entries(lib.sessions)) {
        if (entry.folderId && ids.has(entry.folderId)) {
          placements[sid] = entry.folderId
          sessions[sid] = withoutKey(entry, 'folderId')
        }
      }
      return {
        library: { ...lib, folders: lib.folders.filter((f) => !ids.has(f.id)), sessions },
        undo: { type: 'restoreFolders', folders: removed, placements }
      }
    }

    case 'restoreFolders': {
      const existing = new Set(lib.folders.map((f) => f.id))
      const incoming = op.folders.filter((f) => !existing.has(f.id))
      const known = new Set([...existing, ...incoming.map((f) => f.id)])
      const restored = incoming.map((f) => ({ ...f, parentId: f.parentId !== null && known.has(f.parentId) ? f.parentId : null }))
      const sessions = { ...lib.sessions }
      for (const [sid, folderId] of Object.entries(op.placements)) {
        const entry = sessions[sid]
        // Only sessions still where the delete left them; one you've filed since stays.
        if (entry && !entry.folderId && known.has(folderId)) sessions[sid] = { ...entry, folderId }
      }
      return { library: { ...lib, folders: [...lib.folders, ...restored], sessions } }
    }

    case 'setExpanded': {
      const ids = new Set(op.ids)
      return { library: { ...lib, folders: lib.folders.map((f) => (ids.has(f.id) && f.expanded !== op.expanded ? { ...f, expanded: op.expanded } : f)) } }
    }

    case 'moveSessions': {
      if (op.folderId !== null) need(op.folderId)
      const undo: Record<string, string | null> = {}
      for (const id of op.ids) undo[id] = lib.sessions[id]?.folderId ?? null
      const library = setEntries(lib, op.ids, (e) => (op.folderId === null ? withoutKey(e, 'folderId') : { ...e, folderId: op.folderId }))
      return { library, undo: { type: 'placeSessions', placements: undo } }
    }

    case 'placeSessions': {
      let library = lib
      for (const [id, folderId] of Object.entries(op.placements)) {
        const target = folderId !== null && find(folderId) ? folderId : null
        library = setEntries(library, [id], (e) => (target === null ? withoutKey(e, 'folderId') : { ...e, folderId: target }))
      }
      return { library }
    }

    case 'setPinned': {
      const changed = op.ids.filter((id) => !!lib.sessions[id]?.pinned !== op.pinned)
      const library = setEntries(lib, changed, (e) => (op.pinned ? { ...e, pinned: true } : withoutKey(e, 'pinned')))
      return { library, undo: { type: 'setPinned', ids: changed, pinned: !op.pinned } }
    }

    case 'setArchived': {
      const changed = op.ids.filter((id) => !!lib.sessions[id]?.archived !== op.archived)
      const library = setEntries(lib, changed, (e) => (op.archived ? { ...e, archived: true } : withoutKey(e, 'archived')))
      return { library, undo: { type: 'setArchived', ids: changed, archived: !op.archived } }
    }

    case 'setUnread': {
      const changed = op.ids.filter((id) => !!lib.sessions[id]?.unread !== op.unread)
      const library = setEntries(lib, changed, (e) => (op.unread ? { ...e, unread: true } : withoutKey(e, 'unread')))
      return { library, undo: { type: 'setUnread', ids: changed, unread: !op.unread } }
    }

    case 'setSessionFolders': {
      const seen = new Set<string>()
      const folders = op.folders.map((f) => f.trim()).filter((f) => f && !seen.has(normalizePath(f)) && seen.add(normalizePath(f)))
      const before = lib.sessions[op.id]?.folders ?? []
      const library = setEntries(lib, [op.id], (e) => (folders.length ? { ...e, folders } : withoutKey(e, 'folders')))
      return { library, undo: { type: 'setSessionFolders', id: op.id, folders: before } }
    }

    case 'linkSession': {
      const title = op.title ? cleanName(op.title, TITLE_MAX) : ''
      const library = setEntries(lib, [op.id], (e) => ({ ...e, startedBy: op.startedBy, name: op.name.slice(0, 24), ...(title && !e.title ? { title } : {}) }))
      return { library }
    }

    case 'renameSession': {
      const title = op.title === null ? '' : cleanName(op.title, TITLE_MAX)
      const before = lib.sessions[op.id]?.title ?? null
      if ((title || null) === before) return { library: lib }
      const library = setEntries(lib, [op.id], (e) => (title ? { ...e, title } : withoutKey(e, 'title')))
      return { library, undo: { type: 'renameSession', id: op.id, title: before } }
    }

    case 'setFilingRules': {
      const folder = need(op.id)
      const seen = new Set<string>()
      const paths = op.paths
        .map((p) => p.trim())
        .filter((p) => p && !seen.has(normalizePath(p)) && seen.add(normalizePath(p)))
      const before = new Set((folder.fileFrom ?? []).map(normalizePath))
      const added = paths.filter((p) => !before.has(normalizePath(p)))
      const folders = lib.folders.map((f) => (f.id === op.id ? (paths.length ? { ...f, fileFrom: paths } : withoutKey(f, 'fileFrom')) : f))
      // A new rule files the Unfiled sessions it covers; nothing else moves.
      const sessions = { ...lib.sessions }
      for (const [sid, entry] of Object.entries(lib.sessions)) {
        if (entry.folderId) continue
        const cwd = ctx.sessions.get(sid)?.cwd
        if (!cwd || !added.some((p) => pathContains(p, cwd))) continue
        const target = claimingFolder(folders, cwd)
        if (target) sessions[sid] = { ...entry, folderId: target }
      }
      return { library: { ...lib, folders, sessions } }
    }

    case 'setFolderDefaults': {
      need(op.id)
      const d = op.defaults
      const defaults: FolderDefaults = { ...(d?.cwd?.trim() ? { cwd: d.cwd.trim() } : {}), ...(d?.model ? { model: d.model } : {}), ...(d?.mode ? { mode: d.mode } : {}) }
      const keep = Object.keys(defaults).length > 0
      return { library: { ...lib, folders: lib.folders.map((f) => (f.id === op.id ? (keep ? { ...f, defaults } : withoutKey(f, 'defaults')) : f)) } }
    }

    case 'trustFolder': {
      const path = op.path.trim()
      if (!path || lib.trustedFolders.some((p) => normalizePath(p) === normalizePath(path))) return { library: lib }
      return { library: { ...lib, trustedFolders: [...lib.trustedFolders, path] } }
    }
  }
}

/**
 * A folder Claude may run in without asking: one you trusted here, or one
 * Claude Code has already run sessions in (it asked about it then).
 */
export function folderTrusted(lib: LibraryData, sessions: Iterable<SessionMeta>, path: string): boolean {
  const p = normalizePath(path)
  if (lib.trustedFolders.some((t) => normalizePath(t) === p)) return true
  for (const s of sessions) if (s.cwd && s.file && normalizePath(s.cwd) === p) return true
  return false
}

/** The defaults New Session starts from in a folder: its own, else its nearest parent's that has them. */
export function folderDefaults(folders: readonly Folder[], id: string | null): FolderDefaults {
  if (!id) return {}
  const path = folderPath(folders, id)
  const merged: FolderDefaults = {}
  for (const f of path) Object.assign(merged, f.defaults ?? {})
  return merged
}

// ─── Reading the library ─────────────────────────────────────────────────────

export type SmartFolder = 'all' | 'recent' | 'pinned' | 'unfiled' | 'archived'

/** Where the session list is looking: a smart folder or one of yours. */
export type Place = { smart: SmartFolder } | { folder: string }

/** Your rename, else Claude's title, else what you first asked. */
export function displayTitle(meta: SessionMeta, entry: SessionEntry | undefined): string {
  return entry?.title || meta.title || meta.firstPrompt || meta.lastPrompt || 'Untitled Session'
}

/** The working folder's last segment, or the project folder's name. */
export function projectName(meta: SessionMeta): string {
  const cwd = meta.cwd?.replace(/[\\/]+$/, '')
  return (cwd && cwd.split(/[\\/]/).pop()) || meta.project
}

/** Whether a session belongs in a smart folder. Archived sessions show only in Archived. */
export function inSmartFolder(smart: SmartFolder, meta: SessionMeta, entry: SessionEntry | undefined, folderExists: (id: string) => boolean, now: number): boolean {
  if (smart === 'archived') return !!entry?.archived
  if (entry?.archived) return false
  switch (smart) {
    case 'all':
      return true
    case 'recent':
      return now - meta.updated < RECENT_MS
    case 'pinned':
      return !!entry?.pinned
    case 'unfiled':
      return !entry?.folderId || !folderExists(entry.folderId)
  }
}

/** Every search term appears in the title, a prompt or the project's name. */
export function matchesSearch(terms: readonly string[], meta: SessionMeta, title: string): boolean {
  if (terms.length === 0) return true
  const haystack = [title, meta.title, meta.lastPrompt, meta.firstPrompt, projectName(meta)].filter(Boolean).join('\n').toLowerCase()
  return terms.every((t) => haystack.includes(t))
}

export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Sessions to archive under Settings' "Archive inactive sessions": no activity
 * for `days`, not pinned, not marked unread, not already archived, and not
 * running here (a process alive, a turn or a card, background work).
 */
export function inactiveSessions(sessions: readonly SessionMeta[], entries: Record<string, SessionEntry>, days: number, now: number, running: (id: string) => boolean): string[] {
  if (days <= 0) return []
  const before = now - days * DAY_MS
  return sessions
    .filter((m) => {
      const e = entries[m.id]
      return !!m.file && m.updated < before && !e?.archived && !e?.pinned && !e?.unread && !running(m.id)
    })
    .map((m) => m.id)
}
