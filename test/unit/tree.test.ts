import { describe, expect, it } from 'vitest'
import { applyOp, emptyLibrary, noticeSessions, type LibraryData, type LibraryOp, type SessionMeta } from '../../src/shared/library'
import { buildTree, nest, type TreeInput, type TreeRow } from '../../src/renderer/src/features/sidebar/tree'

const now = Date.parse('2026-10-30T12:00:00Z')
let n = 0
const ctx = { sessions: new Map<string, SessionMeta>(), newId: () => `f${++n}`, now }

function meta(id: string, cwd: string, extra: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    file: `C:\\projects\\x\\${id}.jsonl`,
    project: 'x',
    cwd,
    title: `Title ${id}`,
    firstPrompt: null,
    lastPrompt: null,
    created: Date.parse('2026-10-01T00:00:00Z'),
    updated: Date.parse('2026-10-29T00:00:00Z'),
    size: 1,
    entrypoint: 'cli',
    gitBranch: null,
    version: null,
    remote: false,
    ...extra
  }
}

const sessions = Object.fromEntries(
  [
    meta('old', 'C:\\A', { updated: Date.parse('2026-09-01T00:00:00Z'), title: 'Zebra' }),
    meta('new', 'C:\\A', { updated: Date.parse('2026-10-30T11:00:00Z'), title: 'Apple' }),
    meta('pin', 'C:\\B', { updated: Date.parse('2026-08-01T00:00:00Z'), title: 'Mango', lastPrompt: 'about the kiwi' }),
    meta('gone', 'C:\\B', { title: 'Archived one' })
  ].map((s) => [s.id, s])
)

/** Top › Inner, with "old" in Top, "new" in Inner, "pin" pinned and unfiled, "gone" archived. */
function library() {
  let lib: LibraryData = noticeSessions(emptyLibrary(), Object.values(sessions), [], 0)
  const run = (op: LibraryOp) => {
    const result = applyOp(lib, op, ctx)
    lib = result.library
    return result
  }
  const top = run({ type: 'createFolder', parentId: null, name: 'Top' }).folderId!
  const inner = run({ type: 'createFolder', parentId: top, name: 'Inner' }).folderId!
  run({ type: 'moveSessions', ids: ['old'], folderId: top })
  run({ type: 'moveSessions', ids: ['new'], folderId: inner })
  run({ type: 'setPinned', ids: ['pin'], pinned: true })
  run({ type: 'setArchived', ids: ['gone'], archived: true })
  const expand = (ids: string[], expanded: boolean) => run({ type: 'setExpanded', ids, expanded })
  return { lib: () => lib, top, inner, expand }
}

const input = (lib: LibraryData, extra: Partial<TreeInput> = {}): TreeInput => ({
  library: lib,
  sessions,
  openSmart: [],
  search: '',
  archive: false,
  sort: 'activity',
  now,
  shown: {},
  keep: new Set(),
  ...extra
})
/** A row as "name depth": sessions by ID, groups by name. */
const show = (r: TreeRow) => `${r.kind === 'session' ? r.item.id : r.kind === 'smart' ? r.smart : r.kind === 'more' ? 'more' : r.folder.name} ${r.depth}`
const sessionsIn = (rows: TreeRow[], group: string) => rows.flatMap((r) => (r.kind === 'session' && r.group === group ? [r.item.id] : []))

describe('the sidebar tree', () => {
  it('lists the library groups closed, with counts, then your folders', () => {
    const { lib, top, expand } = library()
    expand([top], false)
    const tree = buildTree(input(lib()))
    expect(tree.sections.map((s) => s.label)).toEqual(['Library', 'Folders'])
    expect(tree.rows.map(show)).toEqual(['all 0', 'recent 0', 'pinned 0', 'unfiled 0', 'Top 0'])
    expect(tree.rows.flatMap((r) => (r.kind === 'smart' ? [r.count] : []))).toEqual([3, 1, 1, 1])
    expect(tree.rows.at(-1)).toMatchObject({ kind: 'folder', count: 1, open: false, hasChildren: true })
  })

  it('opens a library group to show its sessions, pinned first, in the order you chose', () => {
    const { lib } = library()
    expect(sessionsIn(buildTree(input(lib(), { openSmart: ['all'] })).rows, 'smart:all')).toEqual(['pin', 'new', 'old'])
    expect(sessionsIn(buildTree(input(lib(), { openSmart: ['all'], sort: 'name' })).rows, 'smart:all')).toEqual(['pin', 'new', 'old'])
    const rows = buildTree(input(lib(), { openSmart: ['recent', 'unfiled'] })).rows
    expect(sessionsIn(rows, 'smart:recent')).toEqual(['new'])
    expect(sessionsIn(rows, 'smart:unfiled')).toEqual(['pin'])
    expect(rows.find((r) => r.kind === 'session')).toMatchObject({ depth: 1, trail: ['smart:recent'], folderId: null })
  })

  it('nests a folder’s subfolders, then its own sessions, with a guide and a set for each level', () => {
    const { lib, top, inner, expand } = library()
    expand([top, inner], true)
    const rows = buildTree(input(lib())).rows.filter((r) => r.kind === 'folder' || (r.kind === 'session' && r.group.startsWith('folder:')))
    expect(rows.map(show)).toEqual(['Top 0', 'Inner 1', 'new 2', 'old 1'])
    expect(rows.map((r) => (r.kind === 'smart' ? [] : r.trail))).toEqual([[], [`folder:${top}`], [`folder:${top}`, `folder:${inner}`], [`folder:${top}`]])
    // Inner and "old" are Top's two children.
    expect(rows.map((r) => (r.kind === 'more' ? [] : [r.posInSet, r.setSize]))).toEqual([
      [1, 1],
      [1, 2],
      [1, 1],
      [2, 2]
    ])
    expect(rows[2]).toMatchObject({ folderId: inner })
    // Closing Top hides everything below it.
    expand([top], false)
    expect(buildTree(input(lib())).rows.filter((r) => r.kind === 'folder').map(show)).toEqual(['Top 0'])
  })

  it('nests the rows back into the groups they open from, so a group’s contents move as one', () => {
    const { lib, top, inner, expand } = library()
    expand([top, inner], true)
    const folders = buildTree(input(lib())).sections[1]
    const outline = (nodes: ReturnType<typeof nest>): unknown[] => nodes.map((n) => (n.children.length ? [show(n.row), outline(n.children)] : show(n.row)))
    expect(outline(nest(folders.rows))).toEqual([['Top 0', [['Inner 1', ['new 2']], 'old 1']]])
  })

  it('keys every row apart, even a session showing in several groups', () => {
    const { lib, top, inner, expand } = library()
    expand([top, inner], true)
    const keys = buildTree(input(lib(), { openSmart: ['all', 'recent'] })).rows.map((r) => r.key)
    expect(keys.filter((k) => k.endsWith('/new'))).toHaveLength(3)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('shows archived sessions only in Archived', () => {
    const { lib } = library()
    const tree = buildTree(input(lib(), { openSmart: ['all'], archive: true }))
    expect(tree.sections.map((s) => [s.label, s.count])).toEqual([['Archived', 1]])
    expect(tree.rows.map(show)).toEqual(['gone 0'])
    expect(sessionsIn(buildTree(input(lib(), { openSmart: ['all'] })).rows, 'smart:all')).not.toContain('gone')
  })

  it('shows five of a group’s sessions, then Show More, five more at a time, and always as far as the selection', () => {
    const many = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => meta(`s${String(i).padStart(2, '0')}`, 'C:\\A', { updated: now - (i + 1) * 60_000 })).map((s) => [s.id, s])
    )
    const lib = noticeSessions(emptyLibrary(), Object.values(many), [], 0)
    const tree = (extra: Partial<TreeInput> = {}) => buildTree({ ...input(lib, { openSmart: ['unfiled'], ...extra }), sessions: many })
    const showing = (t: ReturnType<typeof buildTree>) => t.rows.flatMap((r) => (r.kind === 'session' && r.group === 'smart:unfiled' ? [r.item.id] : []))
    const more = (t: ReturnType<typeof buildTree>) => t.rows.find((r) => r.kind === 'more')
    expect(showing(tree())).toEqual(['s00', 's01', 's02', 's03', 's04'])
    expect(more(tree())).toMatchObject({ key: 'more:smart:unfiled', group: 'smart:unfiled', hidden: 7, depth: 1, trail: ['smart:unfiled'] })
    expect(showing(tree({ shown: { 'smart:unfiled': 10 } }))).toHaveLength(10)
    expect(more(tree({ shown: { 'smart:unfiled': 15 } }))).toBeUndefined()
    // A selected session far down shows, and everything above it.
    expect(showing(tree({ keep: new Set(['s08']) }))).toHaveLength(9)
    // The set still counts every session in the group.
    expect(tree().rows.find((r) => r.kind === 'session')).toMatchObject({ posInSet: 1, setSize: 12 })
    // Search results and Archived show everything.
    expect(tree({ search: 'title' }).rows.filter((r) => r.kind === 'session')).toHaveLength(12)
  })

  it('searches every folder by title, prompt or project, with archived matches apart', () => {
    const { lib } = library()
    const results = (search: string) => buildTree(input(lib(), { search })).sections.map((s) => [s.label, s.rows.map((r) => (r.kind === 'session' ? r.item.id : ''))])
    expect(results('kiwi')).toEqual([['Results', ['pin']]])
    expect(results('apple')).toEqual([['Results', ['new']]])
    expect(results('archived')).toEqual([
      ['Results', []],
      ['Archived', ['gone']]
    ])
  })
})
