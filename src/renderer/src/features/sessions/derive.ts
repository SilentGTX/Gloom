// What the session list shows for a place, and the counts beside each folder.
import {
  displayTitle,
  inSmartFolder,
  matchesSearch,
  searchTerms,
  subtreeIds,
  type LibraryData,
  type Place,
  type SessionEntry,
  type SessionMeta,
  type SmartFolder
} from '@shared/library'
import type { SortOrder } from '../../stores/ui'

export interface SessionItem {
  id: string
  meta: SessionMeta
  entry: SessionEntry | undefined
  title: string
}

export interface ListOptions {
  search: string
  sort: SortOrder
  includeSubfolders: boolean
  now: number
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * The sessions a place shows, pinned first. A search looks across every
 * folder, archived sessions excepted (unless Archived is where you are).
 */
export function listSessions(library: LibraryData, sessions: Record<string, SessionMeta>, place: Place, o: ListOptions): SessionItem[] {
  const exists = new Set(library.folders.map((f) => f.id))
  const terms = searchTerms(o.search)
  const inFolders = 'folder' in place ? (o.includeSubfolders ? subtreeIds(library.folders, place.folder) : new Set([place.folder])) : null
  const items: SessionItem[] = []
  for (const meta of Object.values(sessions)) {
    const entry = library.sessions[meta.id]
    const title = displayTitle(meta, entry)
    let shown: boolean
    if (terms.length) shown = (('smart' in place && place.smart === 'archived') === !!entry?.archived) && matchesSearch(terms, meta, title)
    else if (inFolders) shown = !entry?.archived && !!entry?.folderId && inFolders.has(entry.folderId)
    else shown = inSmartFolder((place as { smart: SmartFolder }).smart, meta, entry, (id) => exists.has(id), o.now)
    if (shown) items.push({ id: meta.id, meta, entry, title })
  }
  const compare =
    o.sort === 'name'
      ? (a: SessionItem, b: SessionItem) => collator.compare(a.title, b.title)
      : o.sort === 'created'
        ? (a: SessionItem, b: SessionItem) => b.meta.created - a.meta.created
        : (a: SessionItem, b: SessionItem) => b.meta.updated - a.meta.updated
  return items.sort((a, b) => Number(!!b.entry?.pinned) - Number(!!a.entry?.pinned) || compare(a, b) || (a.id < b.id ? -1 : 1))
}

export interface Counts {
  smart: Record<SmartFolder, number>
  /** Per folder: its own sessions, plus its subfolders' when they're included. */
  folders: Record<string, number>
}

export function countSessions(library: LibraryData, sessions: Record<string, SessionMeta>, includeSubfolders: boolean, now: number): Counts {
  const exists = new Set(library.folders.map((f) => f.id))
  const smart: Record<SmartFolder, number> = { all: 0, recent: 0, pinned: 0, unfiled: 0, archived: 0 }
  const direct: Record<string, number> = {}
  for (const meta of Object.values(sessions)) {
    const entry = library.sessions[meta.id]
    for (const key of Object.keys(smart) as SmartFolder[]) if (inSmartFolder(key, meta, entry, (id) => exists.has(id), now)) smart[key]++
    if (!entry?.archived && entry?.folderId && exists.has(entry.folderId)) direct[entry.folderId] = (direct[entry.folderId] ?? 0) + 1
  }
  if (!includeSubfolders) return { smart, folders: direct }
  const folders: Record<string, number> = {}
  for (const f of library.folders) {
    let total = 0
    for (const id of subtreeIds(library.folders, f.id)) total += direct[id] ?? 0
    folders[f.id] = total
  }
  return { smart, folders }
}
