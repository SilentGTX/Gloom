import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadLibrary, sanitize, saveLibrary } from '../../src/main/library/store'
import { applyOp, childrenOf, emptyLibrary, type LibraryData } from '../../src/shared/library'

const ctx = { sessions: new Map(), newId: (() => { let i = 0; return () => `f${++i}` })(), now: 0 }

function sample(): LibraryData {
  let lib = applyOp(emptyLibrary(), { type: 'createFolder', parentId: null, name: 'Work' }, ctx).library
  lib = applyOp(lib, { type: 'moveSessions', ids: ['s1'], folderId: lib.folders[0].id }, ctx).library
  return lib
}

describe('the library file', () => {
  it('round-trips, keeping the previous version as .bak', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gloom-store-')), 'library.json')
    const first = sample()
    saveLibrary(file, first)
    expect(existsSync(file + '.bak')).toBe(false)
    const second = applyOp(first, { type: 'renameFolder', id: first.folders[0].id, name: 'Renamed' }, ctx).library
    saveLibrary(file, second)
    expect(loadLibrary(file)).toEqual({ library: second, from: 'file' })
    expect(JSON.parse(readFileSync(file + '.bak', 'utf8')).folders[0].name).toBe('Work')
  })

  it('falls back to the .bak when the file is corrupt, then to an empty library', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'gloom-store-')), 'library.json')
    saveLibrary(file, sample())
    saveLibrary(file, sample())
    writeFileSync(file, '{"version":1,"folders":[{"id":')
    const loaded = loadLibrary(file)
    expect(loaded.from).toBe('backup')
    expect(loaded.library.folders[0].name).toBe('Work')
    writeFileSync(file + '.bak', 'not json')
    expect(loadLibrary(file)).toEqual({ library: emptyLibrary(), from: 'new' })
  })

  it('repairs what it reads: orphans and cycles go to the top, bad keys are redone', () => {
    const lib = sanitize({
      version: 1,
      folders: [
        { id: 'a', name: 'A', parentId: 'b', order: 'a0', expanded: true },
        { id: 'b', name: 'B', parentId: 'a', order: 'a0', expanded: false },
        { id: 'c', name: 'C', parentId: 'missing', order: '', expanded: false },
        { id: 'c', name: 'Duplicate', parentId: null, order: 'a1', expanded: false },
        { name: 'No id' }
      ],
      sessions: { s1: { folderId: 'gone', pinned: true, extra: 1 }, s2: 'junk' },
      trustedFolders: ['D:\\JS', 7]
    })
    expect(lib.folders.map((f) => [f.id, f.parentId])).toEqual([
      ['a', null],
      ['b', null],
      ['c', null]
    ])
    const keys = childrenOf(lib.folders, null).map((f) => f.order)
    expect(new Set(keys).size).toBe(3)
    expect(lib.sessions).toEqual({ s1: { pinned: true } })
    expect(lib.trustedFolders).toEqual(['D:\\JS'])
  })
})
