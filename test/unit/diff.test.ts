import { describe, expect, it } from 'vitest'
import { composeEdits, displayPath, editOpOf, hunksFromRows, parseGitDiff, unquoteGitPath, untrackedPaths, type EditOp, type Row } from '../../src/shared/diff'
import type { Hunk } from '../../src/shared/transcript'

/** A plain line diff (LCS), as rows with their numbers. */
function diffRows(a: string[], b: string[]): Row[] {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) rows.push({ t: ' ', text: a[i++], old: i, new: ++j })
    else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) rows.push({ t: '-', text: a[i++], old: i, new: j + 1 })
    else rows.push({ t: '+', text: b[j++], old: i + 1, new: j })
  }
  return rows
}

/** Hunks the way an edit reports them (three lines of context). */
const patch = (a: string[], b: string[]): Hunk[] => hunksFromRows(diffRows(a, b))

/** The changed lines, numbered as the pane numbers them: removed by their old line, added by their new one. */
function changes(hunks: Hunk[]): string[] {
  const out: string[] = []
  for (const h of hunks) {
    let oldLine = h.oldStart
    let newLine = h.newStart
    for (const l of h.lines) {
      if (l[0] === '-') out.push(`-${oldLine++}:${l.slice(1)}`)
      else if (l[0] === '+') out.push(`+${newLine++}:${l.slice(1)}`)
      else {
        oldLine++
        newLine++
      }
    }
  }
  return out.sort()
}

/** Every context line a hunk shows is the file's line at that number. */
function contextHolds(hunks: Hunk[], final: string[]): boolean {
  return hunks.every((h) => {
    let newLine = h.newStart
    return h.lines.every((l) => {
      if (l[0] === '-') return true
      const ok = final[newLine - 1] === l.slice(1)
      newLine++
      return ok
    })
  })
}

const edit = (file: string, hunks: Hunk[]): EditOp => ({ file, kind: 'edit', hunks })

/** A small deterministic generator, so a failure repeats. */
function random(seed: number) {
  let s = seed
  return (n: number) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s % n
  }
}

describe('session diff', () => {
  it('composes many edits into one diff, from before the first to after the last', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = random(seed)
      const original = Array.from({ length: 30 + rand(40) }, (_, i) => `line ${i + 1}`)
      let file = original
      const ops: EditOp[] = []
      let fresh = 0
      for (let k = 0; k < 1 + rand(6); k++) {
        const at = rand(file.length + 1)
        const cut = Math.min(rand(4), file.length - at)
        const add = Array.from({ length: rand(4) }, () => `new ${++fresh}`)
        if (!cut && !add.length) continue
        const next = [...file.slice(0, at), ...add, ...file.slice(at + cut)]
        ops.push(edit('C:\\repo\\a.ts', patch(file, next)))
        file = next
      }
      const files = composeEdits(ops, 'C:\\repo')
      const expected = changes(patch(original, file))
      if (!expected.length) {
        expect(files, `seed ${seed}`).toEqual([])
        continue
      }
      expect(files, `seed ${seed}`).toHaveLength(1)
      expect(files[0].note, `seed ${seed}`).toBeUndefined()
      expect(changes(files[0].hunks), `seed ${seed}`).toEqual(expected)
      expect(contextHolds(files[0].hunks, file), `seed ${seed}`).toBe(true)
    }
  })

  it('gives a diff that turns the original into the final file, even with repeated lines and edits put back', () => {
    /** Applies hunks to a file the way `patch` would, checking every line it expects. */
    const apply = (a: string[], hunks: Hunk[]): string[] | null => {
      const out: string[] = []
      let at = 0
      for (const h of hunks) {
        const start = Math.max(0, h.oldStart - 1)
        if (start < at) return null
        out.push(...a.slice(at, start))
        at = start
        for (const l of h.lines) {
          if (l[0] === '+') out.push(l.slice(1))
          else {
            if (a[at] !== l.slice(1)) return null
            if (l[0] === ' ') out.push(a[at])
            at++
          }
        }
      }
      return [...out, ...a.slice(at)]
    }
    const pool = ['x', 'y', '}', '', 'return null']
    for (let seed = 1; seed <= 300; seed++) {
      const rand = random(seed * 7)
      const original = Array.from({ length: 20 + rand(30) }, () => pool[rand(pool.length)])
      let file = original
      const ops: EditOp[] = []
      for (let k = 0; k < 1 + rand(7); k++) {
        const at = rand(file.length + 1)
        const cut = Math.min(rand(4), file.length - at)
        // Sometimes put back what an earlier edit took out.
        const add = rand(3) === 0 && k > 0 ? original.slice(at, at + rand(3)) : Array.from({ length: rand(4) }, () => pool[rand(pool.length)])
        const next = [...file.slice(0, at), ...add, ...file.slice(at + cut)]
        if (next.join('\n') === file.join('\n')) continue
        ops.push(edit('/r/f.ts', patch(file, next)))
        file = next
      }
      const files = composeEdits(ops, '/r')
      if (!files.length) {
        expect(file, `seed ${seed}`).toEqual(original)
        continue
      }
      expect(files[0].note, `seed ${seed}`).toBeUndefined()
      expect(apply(original, files[0].hunks), `seed ${seed}`).toEqual(file)
    }
  })

  it('shows a new file as added, edits to it included, and a reverted edit as nothing', () => {
    const create: EditOp = { file: 'C:\\repo\\new.ts', kind: 'create', hunks: [], content: 'one\ntwo\nthree\n' }
    const tweak = edit('C:\\repo\\new.ts', patch(['one', 'two', 'three'], ['one', '2', 'three']))
    const there = edit('C:\\repo\\old.ts', patch(['a', 'b', 'c'], ['a', 'B', 'c']))
    const back = edit('C:\\repo\\old.ts', patch(['a', 'B', 'c'], ['a', 'b', 'c']))
    const files = composeEdits([create, there, tweak, back], 'C:\\repo')
    expect(files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([['new.ts', 'added', 3, 0]])
    expect(files[0].hunks[0].lines).toEqual(['+one', '+2', '+three'])
  })

  it('learns a whole file from Write and keeps context it has seen', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const after = ['a', 'b', 'C', 'd', 'e', 'f', 'g', 'h', 'i']
    const write: EditOp = { file: '/repo/w.txt', kind: 'write', hunks: patch(before, after), content: after.join('\n') + '\n' }
    const [file] = composeEdits([write], '/repo')
    expect(changes(file.hunks)).toEqual(changes(patch(before, after)))
    expect(contextHolds(file.hunks, after)).toBe(true)
  })

  it('falls back to edit by edit when a patch can’t land', () => {
    const create: EditOp = { file: 'C:\\x\\f.ts', kind: 'create', hunks: [], content: 'a\nb\n' }
    const far: EditOp = edit('C:\\x\\f.ts', [{ oldStart: 40, oldLines: 1, newStart: 40, newLines: 1, lines: ['-x', '+y'] }])
    const [file] = composeEdits([create, far], 'C:\\x')
    expect(file.note).toMatch(/edit by edit/)
    expect(file.hunks).toHaveLength(1)
  })

  it('reads edits from transcript lines and ignores failed ones', () => {
    const line = (r: unknown, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: isError }] }, toolUseResult: r })
    expect(editOpOf(line({ filePath: 'C:\\a.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }], originalFile: null }))).toMatchObject({ kind: 'edit', file: 'C:\\a.ts' })
    expect(editOpOf(line({ type: 'create', filePath: 'C:\\b.ts', content: 'x', structuredPatch: [] }))).toMatchObject({ kind: 'create', content: 'x' })
    expect(editOpOf(line('Error: no', true))).toBeNull()
    expect(editOpOf(line({ filePath: 'C:\\a.ts', structuredPatch: [] }, true))).toBeNull()
  })

  it('shows paths inside the working folder relative to it', () => {
    expect(displayPath('C:\\Repo\\src\\a.ts', 'c:\\repo')).toBe('src/a.ts')
    expect(displayPath('D:\\other\\a.ts', 'C:\\repo')).toBe('D:/other/a.ts')
    expect(displayPath('/home/me/x/y.ts', '/home/me/x/')).toBe('y.ts')
  })
})

describe('git diff', () => {
  const text = [
    'diff --git a/src/app.ts b/src/app.ts',
    'index 1111111..2222222 100644',
    '--- a/src/app.ts',
    '+++ b/src/app.ts',
    '@@ -1,3 +1,4 @@',
    ' one',
    '-two',
    '+2',
    '+2.5',
    ' three',
    '\\ No newline at end of file',
    'diff --git a/new file.md b/new file.md',
    'new file mode 100644',
    'index 0000000..3333333',
    '--- /dev/null',
    '+++ b/new file.md',
    '@@ -0,0 +1 @@',
    '+hello',
    'diff --git a/gone.txt b/gone.txt',
    'deleted file mode 100644',
    'index 4444444..0000000',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-bye',
    '--- not a header, a removed line',
    'diff --git a/old.ts b/moved.ts',
    'similarity index 100%',
    'rename from old.ts',
    'rename to moved.ts',
    'diff --git a/logo.png b/logo.png',
    'index 5555555..6666666 100644',
    'Binary files a/logo.png and b/logo.png differ',
    'diff --git "a/caf\\303\\251 \\"x\\".txt" "b/caf\\303\\251 \\"x\\".txt"',
    'old mode 100644',
    'new mode 100755',
    ''
  ].join('\n')

  it('reads files, their status, counts and hunks', () => {
    const files = parseGitDiff(text)
    expect(files.map((f) => [f.path, f.status, f.added, f.removed])).toEqual([
      ['src/app.ts', 'modified', 2, 1],
      ['new file.md', 'added', 1, 0],
      ['gone.txt', 'deleted', 0, 2],
      ['moved.ts', 'renamed', 0, 0],
      ['logo.png', 'modified', 0, 0],
      ['café "x".txt', 'modified', 0, 0]
    ])
    expect(files[0].hunks[0].lines).toEqual([' one', '-two', '+2', '+2.5', ' three'])
    expect(files[2].hunks[0].lines).toEqual(['-bye', '--- not a header, a removed line'])
    expect(files[3].from).toBe('old.ts')
    expect(files[4].note).toBe('Binary file')
    expect(files[5].note).toMatch(/mode/)
  })

  it('unquotes git’s quoted paths and finds untracked files', () => {
    expect(unquoteGitPath('"tab\\there"')).toBe('tab\there')
    expect(unquoteGitPath('plain.txt')).toBe('plain.txt')
    expect(untrackedPaths(' M src/a.ts\0?? notes.md\0?? build/\0A  b.ts\0')).toEqual(['notes.md'])
  })
})
