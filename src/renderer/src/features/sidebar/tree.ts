// What the sidebar shows: the library's groups and your folders, each opening
// to show its sessions nested inside, or search results, or Archived. Pure, so
// the tree can be worked out (and tested) away from the window.
import {
  byOrder,
  displayTitle,
  inSmartFolder,
  matchesSearch,
  searchTerms,
  type Folder,
  type LibraryData,
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

/** The library's groups, in the order the sidebar lists them. Archived sits apart, at the bottom. */
export const LIBRARY_GROUPS: SmartFolder[] = ['all', 'recent', 'pinned', 'unfiled', 'routines']

export const SMART_LABELS: Record<SmartFolder, string> = {
  all: 'All Sessions',
  recent: 'Recent',
  pinned: 'Pinned',
  unfiled: 'Unfiled',
  routines: 'Routines',
  archived: 'Archived'
}

interface RowBase {
  /** Unique per row. A session can show in several groups, so its rows are keyed by group too. */
  key: string
  /** 0 at the top of a section; a group's sessions and subfolders sit one deeper. */
  depth: number
  /** Position among its siblings (1-based) and their count, for the tree's accessibility. */
  posInSet: number
  setSize: number
}

export interface SmartRow extends RowBase {
  kind: 'smart'
  smart: SmartFolder
  count: number
  open: boolean
  hasChildren: boolean
}

export interface FolderRow extends RowBase {
  kind: 'folder'
  folder: Folder
  /** Its own sessions, the ones that show when it opens. */
  count: number
  open: boolean
  hasChildren: boolean
  /** The groups it sits inside, outermost first ('folder:<id>'), one per level. */
  trail: string[]
}

export interface SessionRow extends RowBase {
  kind: 'session'
  item: SessionItem
  /** The row it's nested under ('smart:all', 'folder:<id>'), or the list it's in. */
  group: string
  /** The folder it's nested in, which takes what's dropped on it. */
  folderId: string | null
  /** The groups it sits inside, outermost first ('smart:all', 'folder:<id>'), one per level. */
  trail: string[]
}

/** "Show More", after the sessions an open group shows so far. */
export interface MoreRow {
  kind: 'more'
  /** 'more:<group>'. */
  key: string
  /** The group it shows more of ('smart:all', 'folder:<id>'). */
  group: string
  /** The folder it's in, which takes what's dropped on it. */
  folderId: string | null
  depth: number
  trail: string[]
  /** Sessions not showing yet. */
  hidden: number
}

export type TreeRow = SmartRow | FolderRow | SessionRow | MoreRow
export type GroupRow = SmartRow | FolderRow

export interface Section {
  key: 'library' | 'folders' | 'results' | 'archived-results' | 'archive'
  label: string
  rows: TreeRow[]
  /** Shown beside the heading, in lists that aren't the library. */
  count?: number
}

export interface Tree {
  sections: Section[]
  /** Every row, in the order the keyboard walks them. */
  rows: TreeRow[]
}

export interface TreeInput {
  library: LibraryData
  sessions: Record<string, SessionMeta>
  openSmart: readonly SmartFolder[]
  search: string
  /** Showing Archived instead of the library. */
  archive: boolean
  sort: SortOrder
  now: number
  /** How many sessions an open group shows, by group ('smart:all', 'folder:<id>'); five until Show More. */
  shown: Readonly<Record<string, number>>
  /** Sessions that show wherever they are, however far down (the selection). */
  keep: ReadonlySet<string>
}

/** A group shows this many sessions at first, and Show More adds as many again. */
export const SHOWN_STEP = 5

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Pinned first, then in the order you chose. */
export function sortSessions(items: SessionItem[], sort: SortOrder): SessionItem[] {
  const compare =
    sort === 'name'
      ? (a: SessionItem, b: SessionItem) => collator.compare(a.title, b.title)
      : sort === 'created'
        ? (a: SessionItem, b: SessionItem) => b.meta.created - a.meta.created
        : (a: SessionItem, b: SessionItem) => b.meta.updated - a.meta.updated
  return [...items].sort((a, b) => Number(!!b.entry?.pinned) - Number(!!a.entry?.pinned) || compare(a, b) || (a.id < b.id ? -1 : 1))
}

function sessionRows(list: SessionItem[], group: string, trail: string[], folderId: string | null, before = 0, setSize = list.length): SessionRow[] {
  return list.map((item, i) => ({ kind: 'session', key: `${group}/${item.id}`, item, group, folderId, trail, depth: trail.length, posInSet: before + i + 1, setSize }))
}

/**
 * The sessions an open group shows: the first five (more after each Show
 * More), and as far down as any session that must show; then Show More, if
 * there are others.
 */
function shownRows(input: TreeInput, list: SessionItem[], group: string, trail: string[], folderId: string | null, before = 0, setSize = list.length): TreeRow[] {
  let count = input.shown[group] ?? SHOWN_STEP
  list.forEach((item, i) => {
    if (input.keep.has(item.id)) count = Math.max(count, i + 1)
  })
  const rows: TreeRow[] = sessionRows(list.slice(0, count), group, trail, folderId, before, setSize)
  if (list.length > count) rows.push({ kind: 'more', key: `more:${group}`, group, folderId, trail, depth: trail.length, hidden: list.length - count })
  return rows
}

export function buildTree(input: TreeInput): Tree {
  const { library, now } = input
  const exists = new Set(library.folders.map((f) => f.id))
  const folderExists = (id: string) => exists.has(id)
  const items = sortSessions(
    Object.values(input.sessions).map((meta) => {
      const entry = library.sessions[meta.id]
      return { id: meta.id, meta, entry, title: displayTitle(meta, entry) }
    }),
    input.sort
  )
  const sections: Section[] = []

  const terms = searchTerms(input.search)
  if (terms.length) {
    // Every folder at once; archived matches come last, under their own heading.
    const found = items.filter((i) => matchesSearch(terms, i.meta, i.title))
    const live = found.filter((i) => !i.entry?.archived)
    const archived = found.filter((i) => i.entry?.archived)
    sections.push({ key: 'results', label: 'Results', count: live.length, rows: sessionRows(live, 'results', [], null) })
    if (archived.length) sections.push({ key: 'archived-results', label: 'Archived', count: archived.length, rows: sessionRows(archived, 'archived-results', [], null) })
  } else if (input.archive) {
    const archived = items.filter((i) => i.entry?.archived)
    sections.push({ key: 'archive', label: 'Archived', count: archived.length, rows: sessionRows(archived, 'archive', [], null) })
  } else {
    const rows: TreeRow[] = []
    // Routines shows once a routine has made a session; the rest always show.
    const groups = LIBRARY_GROUPS.filter((smart) => smart !== 'routines' || items.some((item) => inSmartFolder('routines', item.meta, item.entry, folderExists, now)))
    groups.forEach((smart, i) => {
      const list = items.filter((item) => inSmartFolder(smart, item.meta, item.entry, folderExists, now))
      const open = input.openSmart.includes(smart)
      rows.push({ kind: 'smart', key: `smart:${smart}`, smart, count: list.length, open, hasChildren: list.length > 0, depth: 0, posInSet: i + 1, setSize: groups.length })
      if (open) rows.push(...shownRows(input, list, `smart:${smart}`, [`smart:${smart}`], null))
    })
    sections.push({ key: 'library', label: 'Library', rows })
    sections.push({ key: 'folders', label: 'Folders', rows: folderRows(input, items, folderExists) })
  }

  return { sections, rows: sections.flatMap((s) => s.rows) }
}

/** Your folders, depth first; an open folder shows its subfolders, then its own sessions. */
function folderRows(input: TreeInput, items: SessionItem[], folderExists: (id: string) => boolean): TreeRow[] {
  const folders = input.library.folders
  const kids = new Map<string | null, Folder[]>()
  for (const f of folders) {
    const list = kids.get(f.parentId)
    if (list) list.push(f)
    else kids.set(f.parentId, [f])
  }
  for (const list of kids.values()) list.sort(byOrder)
  // Each folder's own sessions, in the sidebar's order.
  const own = new Map<string, SessionItem[]>()
  for (const item of items) {
    const id = item.entry?.folderId
    if (item.entry?.archived || !id || !folderExists(id)) continue
    const list = own.get(id)
    if (list) list.push(item)
    else own.set(id, [item])
  }

  const rows: TreeRow[] = []
  // `after`: the parent's sessions, which share the set with these folders.
  const walk = (parentId: string | null, trail: string[], after: number) => {
    const list = kids.get(parentId) ?? []
    list.forEach((folder, i) => {
      const key = `folder:${folder.id}`
      const subfolders = kids.get(folder.id) ?? []
      const sessions = own.get(folder.id) ?? []
      rows.push({
        kind: 'folder',
        key,
        folder,
        trail,
        depth: trail.length,
        count: sessions.length,
        open: folder.expanded,
        hasChildren: subfolders.length + sessions.length > 0,
        posInSet: i + 1,
        setSize: list.length + after
      })
      if (!folder.expanded || trail.length >= 64) return
      const inside = [...trail, key]
      walk(folder.id, inside, sessions.length)
      rows.push(...shownRows(input, sessions, key, inside, folder.id, subfolders.length, subfolders.length + sessions.length))
    })
  }
  walk(null, [], 0)
  return rows
}

export interface TreeNode {
  row: TreeRow
  /** What shows inside it when it's open: subfolders, then sessions. */
  children: TreeNode[]
}

/** A section's rows as the nesting they stand for, so an open group's contents can move as one. */
export function nest(rows: readonly TreeRow[]): TreeNode[] {
  const roots: TreeNode[] = []
  const open: TreeNode[] = []
  for (const row of rows) {
    const node: TreeNode = { row, children: [] }
    while (open.length && open.at(-1)!.row.depth >= row.depth) open.pop()
    ;(open.at(-1)?.children ?? roots).push(node)
    open.push(node)
  }
  return roots
}
