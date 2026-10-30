import { describe, expect, it } from 'vitest'
import {
  applyOp,
  byOrder,
  childrenOf,
  claimingFolder,
  emptyLibrary,
  flattenTree,
  noticeSessions,
  PRUNE_AFTER_MS,
  type LibraryData,
  type LibraryOp,
  type SessionMeta
} from '../../src/shared/library'

let n = 0
const ctx = (sessions: SessionMeta[] = []) => ({ sessions: new Map(sessions.map((s) => [s.id, s])), newId: () => `f${++n}`, now: Date.parse('2026-10-30T12:00:00Z') })

function meta(id: string, cwd: string | null, extra: Partial<SessionMeta> = {}): SessionMeta {
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

/** Applies ops in turn, returning the library and the last result. */
function run(lib: LibraryData, ops: LibraryOp[], sessions: SessionMeta[] = []) {
  let result = { library: lib } as ReturnType<typeof applyOp>
  for (const op of ops) result = applyOp(result.library, op, ctx(sessions))
  return result
}

const names = (lib: LibraryData, parentId: string | null) => childrenOf(lib.folders, parentId).map((f) => f.name)

describe('folders', () => {
  it('nest, and a new subfolder opens its parent', () => {
    const a = run(emptyLibrary(), [{ type: 'createFolder', parentId: null, name: 'Work' }])
    const work = a.folderId!
    const b = run(a.library, [{ type: 'createFolder', parentId: work, name: 'Clients' }])
    expect(b.library.folders.find((f) => f.id === work)!.expanded).toBe(true)
    expect(names(b.library, work)).toEqual(['Clients'])
    expect(flattenTree(b.library.folders).map((r) => [r.folder.name, r.depth])).toEqual([
      ['Work', 0],
      ['Clients', 1]
    ])
  })

  it('reorder with fractional keys: a move rewrites one folder', () => {
    let lib = emptyLibrary()
    for (const name of ['A', 'B', 'C', 'D']) lib = run(lib, [{ type: 'createFolder', parentId: null, name }]).library
    const d = lib.folders.find((f) => f.name === 'D')!
    const moved = run(lib, [{ type: 'moveFolder', id: d.id, parentId: null, index: 1 }]).library
    expect(names(moved, null)).toEqual(['A', 'D', 'B', 'C'])
    const changed = moved.folders.filter((f) => lib.folders.find((g) => g.id === f.id)!.order !== f.order)
    expect(changed.map((f) => f.name)).toEqual(['D'])
    // Many inserts at the same spot keep a strict order.
    let crowd = moved
    for (let i = 0; i < 40; i++) {
      crowd = run(crowd, [{ type: 'createFolder', parentId: null, name: `N${i}` }]).library
      const id = crowd.folders.at(-1)!.id
      crowd = run(crowd, [{ type: 'moveFolder', id, parentId: null, index: 1 }]).library
    }
    const keys = childrenOf(crowd.folders, null).map((f) => f.order)
    expect(new Set(keys).size).toBe(keys.length)
    expect([...childrenOf(crowd.folders, null)].sort(byOrder).map((f) => f.name).slice(0, 2)).toEqual(['A', 'N39'])
  })

  it('refuse to move inside themselves', () => {
    const a = run(emptyLibrary(), [{ type: 'createFolder', parentId: null, name: 'Work' }])
    const b = run(a.library, [{ type: 'createFolder', parentId: a.folderId!, name: 'Clients' }])
    expect(() => applyOp(b.library, { type: 'moveFolder', id: a.folderId!, parentId: b.folderId!, index: 0 }, ctx())).toThrow(/inside itself/)
    expect(() => applyOp(b.library, { type: 'moveFolder', id: a.folderId!, parentId: a.folderId!, index: 0 }, ctx())).toThrow(/inside itself/)
  })

  it('delete their whole subtree, send its sessions to Unfiled, and Undo puts everything back', () => {
    const work = run(emptyLibrary(), [{ type: 'createFolder', parentId: null, name: 'Work' }])
    const clients = run(work.library, [{ type: 'createFolder', parentId: work.folderId!, name: 'Clients' }])
    let lib = run(clients.library, [
      { type: 'moveSessions', ids: ['s1'], folderId: work.folderId! },
      { type: 'moveSessions', ids: ['s2', 's3'], folderId: clients.folderId! }
    ]).library
    const deleted = applyOp(lib, { type: 'deleteFolder', id: work.folderId! }, ctx())
    expect(deleted.library.folders).toEqual([])
    expect(['s1', 's2', 's3'].map((id) => deleted.library.sessions[id].folderId)).toEqual([undefined, undefined, undefined])
    // You filed s3 somewhere else before pressing Undo: it stays there.
    lib = run(deleted.library, [{ type: 'createFolder', parentId: null, name: 'Elsewhere' }]).library
    const elsewhere = lib.folders.find((f) => f.name === 'Elsewhere')!.id
    lib = run(lib, [{ type: 'moveSessions', ids: ['s3'], folderId: elsewhere }]).library
    const restored = applyOp(lib, deleted.undo!, ctx()).library
    expect(names(restored, null)).toEqual(['Work', 'Elsewhere'])
    expect(names(restored, work.folderId!)).toEqual(['Clients'])
    expect(restored.sessions.s1.folderId).toBe(work.folderId)
    expect(restored.sessions.s2.folderId).toBe(clients.folderId)
    expect(restored.sessions.s3.folderId).toBe(elsewhere)
  })

  it('can each be undone: create, rename and move', () => {
    let lib = emptyLibrary()
    for (const name of ['A', 'B', 'C']) lib = run(lib, [{ type: 'createFolder', parentId: null, name }]).library
    const [a, b, c] = lib.folders.map((f) => f.id)
    // Move C inside A, then undo: back to the end of the top level.
    const moved = applyOp(lib, { type: 'moveFolder', id: c, parentId: a, index: 0 }, ctx())
    expect(names(moved.library, a)).toEqual(['C'])
    const back = applyOp(moved.library, moved.undo!, ctx()).library
    expect(names(back, null)).toEqual(['A', 'B', 'C'])
    // Move B to the front, then undo: back between A and C.
    const front = applyOp(lib, { type: 'moveFolder', id: b, parentId: null, index: 0 }, ctx())
    expect(names(applyOp(front.library, front.undo!, ctx()).library, null)).toEqual(['A', 'B', 'C'])
    const renamed = applyOp(lib, { type: 'renameFolder', id: a, name: 'Alpha' }, ctx())
    expect(applyOp(renamed.library, renamed.undo!, ctx()).library.folders.find((f) => f.id === a)!.name).toBe('A')
    const created = applyOp(lib, { type: 'createFolder', parentId: a, name: 'Child' }, ctx())
    expect(applyOp(created.library, created.undo!, ctx()).library.folders.map((f) => f.name)).toEqual(['A', 'B', 'C'])
    const titled = applyOp(lib, { type: 'renameSession', id: 's1', title: 'Mine' }, ctx())
    expect(applyOp(titled.library, titled.undo!, ctx()).library.sessions.s1.title).toBeUndefined()
  })

  it('keep a name when renamed to nothing', () => {
    const a = run(emptyLibrary(), [{ type: 'createFolder', parentId: null }])
    expect(a.library.folders[0].name).toBe('New Folder')
    const b = run(a.library, [{ type: 'renameFolder', id: a.folderId!, name: '   ' }])
    expect(b.library).toBe(a.library)
    expect(run(a.library, [{ type: 'renameFolder', id: a.folderId!, name: ' Side\nprojects ' }]).library.folders[0].name).toBe('Side projects')
  })
})

describe('sessions', () => {
  it('pin, archive and rename, each with a way back', () => {
    const pinned = applyOp(emptyLibrary(), { type: 'setPinned', ids: ['s1', 's2'], pinned: true }, ctx())
    expect(pinned.library.sessions.s1.pinned).toBe(true)
    expect(applyOp(pinned.library, pinned.undo!, ctx()).library.sessions.s1.pinned).toBeUndefined()
    const archived = applyOp(pinned.library, { type: 'setArchived', ids: ['s1'], archived: true }, ctx())
    expect(archived.undo).toEqual({ type: 'setArchived', ids: ['s1'], archived: false })
    const renamed = applyOp(archived.library, { type: 'renameSession', id: 's1', title: 'Mine' }, ctx())
    expect(renamed.library.sessions.s1).toEqual({ pinned: true, archived: true, title: 'Mine' })
    expect(applyOp(renamed.library, { type: 'renameSession', id: 's1', title: null }, ctx()).library.sessions.s1.title).toBeUndefined()
  })
})

describe('filing rules', () => {
  const folders = (lib: LibraryData) => Object.fromEntries(lib.folders.map((f) => [f.name, f.id]))

  function setup() {
    let lib = emptyLibrary()
    lib = run(lib, [{ type: 'createFolder', parentId: null, name: 'JS' }]).library
    lib = run(lib, [{ type: 'createFolder', parentId: null, name: 'Gloom' }]).library
    const id = folders(lib)
    lib = run(lib, [
      { type: 'setFilingRules', id: id.JS, paths: ['D:\\JS'] },
      { type: 'setFilingRules', id: id.Gloom, paths: ['d:/js/gloom/'] }
    ]).library
    return { lib, id }
  }

  it('file a new session into the folder claiming its working folder most deeply', () => {
    const { lib, id } = setup()
    expect(claimingFolder(lib.folders, 'D:\\JS\\Gloom\\src')).toBe(id.Gloom)
    expect(claimingFolder(lib.folders, 'D:\\JS\\Blissful')).toBe(id.JS)
    expect(claimingFolder(lib.folders, 'D:\\JSX')).toBeUndefined()
    expect(claimingFolder(lib.folders, 'C:\\Elsewhere')).toBeUndefined()
  })

  it("claim a worktree's sessions for the repo it belongs to", () => {
    const { lib, id } = setup()
    const next = noticeSessions(lib, [meta('w1', 'D:\\JS\\Gloom\\.claude\\worktrees\\brave-fox')], [], 0)
    expect(next.sessions.w1.folderId).toBe(id.Gloom)
  })

  it('run once, when a session first appears; a session you moved stays put', () => {
    const { lib, id } = setup()
    let next = noticeSessions(lib, [meta('s1', 'D:\\JS\\Gloom')], [], 0)
    expect(next.sessions.s1.folderId).toBe(id.Gloom)
    next = run(next, [{ type: 'moveSessions', ids: ['s1'], folderId: null }]).library
    // The transcript changes again: the index reports it again.
    next = noticeSessions(next, [meta('s1', 'D:\\JS\\Gloom')], [], 1)
    expect(next.sessions.s1.folderId).toBeUndefined()
  })

  it('file existing Unfiled sessions when a rule is added, and only those it covers', () => {
    const sessions = [meta('a', 'C:\\Work\\api'), meta('b', 'C:\\Work\\web'), meta('c', 'C:\\Home'), meta('d', 'C:\\Work\\old')]
    let lib = noticeSessions(emptyLibrary(), sessions, [], 0)
    lib = run(lib, [{ type: 'createFolder', parentId: null, name: 'Work' }, { type: 'createFolder', parentId: null, name: 'Kept' }]).library
    const id = folders(lib)
    lib = run(lib, [{ type: 'moveSessions', ids: ['d'], folderId: id.Kept }]).library
    lib = run(lib, [{ type: 'setFilingRules', id: id.Work, paths: ['C:\\Work'] }], sessions).library
    expect(['a', 'b', 'c', 'd'].map((s) => lib.sessions[s].folderId)).toEqual([id.Work, id.Work, undefined, id.Kept])
  })

  it('treat paths case-insensitively and drop duplicates', () => {
    const { lib, id } = setup()
    const next = run(lib, [{ type: 'setFilingRules', id: id.JS, paths: ['D:\\JS', 'd:/js', ' D:\\JS\\ '] }]).library
    expect(next.folders.find((f) => f.id === id.JS)!.fileFrom).toEqual(['D:\\JS'])
  })
})

describe('the index and the library', () => {
  it('mark missing transcripts, forget them after 30 days, and welcome them back', () => {
    let lib = noticeSessions(emptyLibrary(), [meta('s1', null)], [], 0)
    lib = run(lib, [{ type: 'setPinned', ids: ['s1'], pinned: true }]).library
    lib = noticeSessions(lib, [], ['s1'], 1000)
    expect(lib.sessions.s1).toEqual({ pinned: true, missingSince: 1000 })
    expect(noticeSessions(lib, [meta('s1', null)], [], 2000).sessions.s1).toEqual({ pinned: true })
    expect(noticeSessions(lib, [], ['s1'], 1000 + PRUNE_AFTER_MS + 1).sessions.s1).toBeUndefined()
  })

  it('return the same library when nothing changed', () => {
    const lib = noticeSessions(emptyLibrary(), [meta('s1', null)], [], 0)
    expect(noticeSessions(lib, [meta('s1', null)], [], 1)).toBe(lib)
  })
})
