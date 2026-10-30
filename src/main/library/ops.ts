// Checks the shape of an operation sent by the window before it touches the
// library. The window is our own page, but a malformed op must never reach disk.
import { LibraryError, type Folder, type LibraryOp } from '@shared/library'

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function str(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.length > 4096) throw new LibraryError(`bad ${what}`)
  return v
}
function strOrNull(v: unknown, what: string): string | null {
  return v === null ? null : str(v, what)
}
function ids(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 100_000) throw new LibraryError('bad ids')
  return v.map((id) => str(id, 'id'))
}
function bool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') throw new LibraryError(`bad ${what}`)
  return v
}
function record<T>(v: unknown, value: (x: unknown) => T): Record<string, T> {
  if (!isRecord(v)) throw new LibraryError('bad record')
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x)]))
}
function folder(v: unknown): Folder {
  if (!isRecord(v)) throw new LibraryError('bad folder')
  const f: Folder = { id: str(v.id, 'id'), name: str(v.name, 'name'), parentId: strOrNull(v.parentId, 'parent'), order: str(v.order, 'order'), expanded: v.expanded === true }
  if (Array.isArray(v.fileFrom)) f.fileFrom = v.fileFrom.map((p) => str(p, 'path'))
  if (isRecord(v.defaults)) f.defaults = { cwd: typeof v.defaults.cwd === 'string' ? v.defaults.cwd : undefined }
  return f
}

export function parseOp(raw: unknown): LibraryOp {
  if (!isRecord(raw)) throw new LibraryError('bad op')
  switch (raw.type) {
    case 'createFolder':
      return { type: 'createFolder', parentId: strOrNull(raw.parentId, 'parent'), name: raw.name === undefined ? undefined : str(raw.name, 'name') }
    case 'renameFolder':
      return { type: 'renameFolder', id: str(raw.id, 'id'), name: str(raw.name, 'name') }
    case 'moveFolder':
      if (typeof raw.index !== 'number' || !Number.isFinite(raw.index)) throw new LibraryError('bad index')
      return { type: 'moveFolder', id: str(raw.id, 'id'), parentId: strOrNull(raw.parentId, 'parent'), index: raw.index }
    case 'deleteFolder':
      return { type: 'deleteFolder', id: str(raw.id, 'id') }
    case 'restoreFolders':
      if (!Array.isArray(raw.folders)) throw new LibraryError('bad folders')
      return { type: 'restoreFolders', folders: raw.folders.map(folder), placements: record(raw.placements, (x) => str(x, 'folder')) }
    case 'setExpanded':
      return { type: 'setExpanded', ids: ids(raw.ids), expanded: bool(raw.expanded, 'expanded') }
    case 'moveSessions':
      return { type: 'moveSessions', ids: ids(raw.ids), folderId: strOrNull(raw.folderId, 'folder') }
    case 'placeSessions':
      return { type: 'placeSessions', placements: record(raw.placements, (x) => strOrNull(x, 'folder')) }
    case 'setPinned':
      return { type: 'setPinned', ids: ids(raw.ids), pinned: bool(raw.pinned, 'pinned') }
    case 'setArchived':
      return { type: 'setArchived', ids: ids(raw.ids), archived: bool(raw.archived, 'archived') }
    case 'renameSession':
      return { type: 'renameSession', id: str(raw.id, 'id'), title: strOrNull(raw.title, 'title') }
    case 'setFilingRules':
      if (!Array.isArray(raw.paths)) throw new LibraryError('bad paths')
      return { type: 'setFilingRules', id: str(raw.id, 'id'), paths: raw.paths.map((p) => str(p, 'path')) }
    default:
      throw new LibraryError(`unknown op ${String(raw.type)}`)
  }
}
