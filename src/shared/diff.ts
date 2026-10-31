// What the diff pane shows. Two sources:
// - This Session: Claude's edits, from the patches its Edit and Write calls
//   reported in the transcript. Claude Code no longer records the file as it
//   was before an edit (`originalFile` is null), so each file's diff is
//   composed from the patches alone: the file is modelled as the lines the
//   patches have shown, with gaps for the lines nobody has seen, and every
//   later patch lands on that model. What's known shows as context; a gap ends
//   a hunk. The result is the file from before the session's first edit to
//   after its last, not one entry per edit.
// - Working Tree: what git reports, tracked changes against HEAD plus
//   untracked files, for changes made by Bash, by you or by other sessions.
import type { Hunk } from './transcript'

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

export interface DiffFile {
  /** As shown: relative to the working folder (or the repository) when inside it, with forward slashes. */
  path: string
  /** Where a renamed file was. */
  from?: string
  /** Where it is on disk, for Reveal in File Explorer. */
  abs: string
  status: FileStatus
  added: number
  removed: number
  hunks: Hunk[]
  /** Why there are no lines to show: a binary file, or one too large. */
  note?: string
}

/** Claude's edits in one session, composed per file. */
export interface SessionDiff {
  files: DiffFile[]
}

/** What git sees in a session's working folder. */
export type TreeDiff =
  | {
      kind: 'ok'
      root: string
      /** The branch checked out; null when HEAD is detached. */
      branch: string | null
      files: DiffFile[]
      /** The patch was too big to read: files are listed with their counts only. */
      truncated?: boolean
    }
  | { kind: 'not-repo' | 'no-git' | 'missing-folder' | 'remote' }
  | { kind: 'error'; message: string }

// ─── One edit, as the transcript reports it ──────────────────────────────────

export interface EditOp {
  /** Absolute path of the file edited. */
  file: string
  /** create: Write made a new file; write: Write replaced one; edit: Edit (or MultiEdit) changed it. */
  kind: 'create' | 'write' | 'edit'
  hunks: Hunk[]
  /** Write's whole new content. */
  content?: string
  /** The file just before this edit, on the CLI versions that still record it. */
  before?: string
}

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function hunksOf(patch: unknown): Hunk[] {
  if (!Array.isArray(patch)) return []
  return patch.filter(isObj).map((h) => ({
    oldStart: num(h.oldStart),
    oldLines: num(h.oldLines),
    newStart: num(h.newStart),
    newLines: num(h.newLines),
    lines: Array.isArray(h.lines) ? h.lines.filter((l): l is string => typeof l === 'string') : []
  }))
}

/** The edit a transcript line reports, if it reports one that succeeded. */
export function editOpOf(e: Raw): EditOp | null {
  if (e.type !== 'user') return null
  const r = e.toolUseResult
  if (!isObj(r) || typeof r.filePath !== 'string' || !r.filePath) return null
  const message = isObj(e.message) ? e.message : null
  const blocks = Array.isArray(message?.content) ? message.content.filter((b) => isObj(b) && b.type === 'tool_result') : []
  if (blocks.length !== 1 || (blocks[0] as Raw).is_error === true) return null
  const before = typeof r.originalFile === 'string' ? r.originalFile : undefined
  if (r.type === 'create' && typeof r.content === 'string') return { file: r.filePath, kind: 'create', hunks: [], content: r.content }
  if (!Array.isArray(r.structuredPatch)) return null
  const hunks = hunksOf(r.structuredPatch)
  if (r.type === 'update' && typeof r.content === 'string') return { file: r.filePath, kind: 'write', hunks, content: r.content, ...(before !== undefined ? { before } : {}) }
  return { file: r.filePath, kind: 'edit', hunks, ...(before !== undefined ? { before } : {}) }
}

// ─── The model of one file ───────────────────────────────────────────────────

/**
 * The file now, line by line, in order:
 * - gap: original lines nobody has seen, unchanged (`n` is Infinity for the unknown tail);
 * - line: a line in the file now; `orig` is its number in the original, null if the session added it;
 *   `text` is null until a patch shows it;
 * - del: an original line the session removed; it takes no place in the file now.
 */
type Seg = { k: 'gap'; from: number; n: number } | { k: 'line'; text: string | null; orig: number | null } | { k: 'del'; text: string; orig: number }

interface Model {
  segs: Seg[]
  /** The session made the file: there was no original. */
  created: boolean
}

const places = (s: Seg): number => (s.k === 'gap' ? s.n : s.k === 'line' ? 1 : 0)

/** Puts a segment boundary at line `p` (0-based). False when `p` is past the end of the file. */
function cut(segs: Seg[], p: number): boolean {
  let pos = 0
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (s.k === 'gap' && pos < p && p < pos + s.n) {
      const off = p - pos
      segs.splice(i, 1, { k: 'gap', from: s.from, n: off }, { k: 'gap', from: s.from + off, n: s.n - off })
      return true
    }
    pos += places(s)
    if (pos >= p) return true
  }
  return pos >= p
}

/** Opens lines [p, p + n) into single lines; returns the index of line p's segment (the end, for p at the end). */
function open(segs: Seg[], p: number, n: number): number | null {
  if (!cut(segs, p) || !cut(segs, p + n)) return null
  let pos = 0
  let at: number | null = null
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    if (s.k === 'del') continue
    if (pos >= p + n) {
      at ??= i
      break
    }
    if (pos === p) at ??= i
    if (s.k === 'gap' && pos >= p) {
      // Bounded by the cut at p + n, so finite.
      segs.splice(i, 1, ...Array.from({ length: s.n }, (_, j): Seg => ({ k: 'line', text: null, orig: s.from + j })))
      pos += s.n
      i += s.n - 1
      continue
    }
    pos += places(s)
  }
  if (at === null && pos === p) at = segs.length
  return at
}

/** Applies one patch: false if it doesn't fit the model (the file changed in ways the transcript doesn't show). */
function applyHunks(model: Model, hunks: Hunk[]): boolean {
  const segs = model.segs
  // Bottom up, so each hunk's line numbers still hold.
  for (const h of [...hunks].sort((a, b) => b.oldStart - a.oldStart)) {
    const p = Math.max(0, h.oldStart - 1)
    let c = open(segs, p, h.oldLines)
    if (c === null) return false
    for (const raw of h.lines) {
      const sign = raw[0]
      const text = raw.slice(1)
      if (sign === '+') {
        while (c < segs.length && segs[c].k === 'del') c++
        segs.splice(c, 0, { k: 'line', text, orig: null })
        c++
        continue
      }
      if (sign !== ' ' && sign !== '-') continue // "\ No newline at end of file"
      while (c < segs.length && segs[c].k === 'del') c++
      const s = segs[c]
      if (!s || s.k !== 'line') return false
      if (sign === '-') {
        if (s.orig !== null) segs[c++] = { k: 'del', text: s.text ?? text, orig: s.orig }
        else segs.splice(c, 1)
        continue
      }
      c = settle(segs, c, text)
    }
  }
  return true
}

/** The line at `c` reads `text` now: learn it, or note a change the transcript didn't show. Returns the index past it. */
function settle(segs: Seg[], c: number, text: string): number {
  const s = segs[c] as Extract<Seg, { k: 'line' }>
  if (s.text === null || s.text === text) {
    segs[c] = { ...s, text }
    return c + 1
  }
  if (s.orig === null) {
    segs[c] = { ...s, text }
    return c + 1
  }
  // An original line someone else changed: the diff shows it changed.
  segs.splice(c, 1, { k: 'del', text: s.text, orig: s.orig }, { k: 'line', text, orig: null })
  return c + 2
}

/** A file's lines as the model counts them: a final newline doesn't start another line. */
function linesOf(content: string): string[] {
  if (!content) return []
  const lines = content.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** The whole file is known (Write's content, or the file before an edit): every line settles against it. */
function reconcile(model: Model, content: string): boolean {
  const lines = linesOf(content)
  const segs = model.segs
  if (open(segs, 0, lines.length) === null) {
    // The model already ends before that many lines: it can't be this file.
    return false
  }
  let c = 0
  for (const text of lines) {
    while (c < segs.length && segs[c].k === 'del') c++
    c = settle(segs, c, text)
  }
  // Whatever the model still has past the end isn't in the file.
  for (let i = c; i < segs.length; i++) {
    const s = segs[i]
    if (s.k === 'gap') segs.splice(i--, 1)
    else if (s.k === 'line') {
      if (s.orig !== null && s.text !== null) segs[i] = { k: 'del', text: s.text, orig: s.orig }
      else segs.splice(i--, 1)
    }
  }
  return true
}

function fresh(content: string | null): Model {
  if (content === null) return { segs: [{ k: 'gap', from: 1, n: Infinity }], created: false }
  return { segs: linesOf(content).map((text, i): Seg => ({ k: 'line', text, orig: i + 1 })), created: false }
}

function created(content: string): Model {
  return { segs: linesOf(content).map((text): Seg => ({ k: 'line', text, orig: null })), created: true }
}

// ─── From the model to hunks ─────────────────────────────────────────────────

const CONTEXT = 3
/** Runs of changes longer than this aren't re-diffed (the cost grows with the square). */
const RUN_MAX = 400

/**
 * An edit put back, wholly or in part, leaves an original line removed and the
 * same text added in its place. Within each run of changes, lines that came
 * back (the longest common run of removed and added text) are unchanged again.
 */
function normalize(segs: Seg[]): void {
  const changed = (s: Seg) => s.k === 'del' || (s.k === 'line' && s.orig === null)
  for (let start = 0; start < segs.length; start++) {
    if (!changed(segs[start])) continue
    let end = start
    while (end < segs.length && changed(segs[end])) end++
    const run = segs.slice(start, end)
    const dels = run.filter((s): s is Extract<Seg, { k: 'del' }> => s.k === 'del')
    const adds = run.filter((s): s is Extract<Seg, { k: 'line' }> => s.k === 'line')
    if (!dels.length || !adds.length || dels.length * adds.length > RUN_MAX * RUN_MAX) {
      start = end - 1
      continue
    }
    const n = dels.length
    const m = adds.length
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = dels[i].text === adds[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    if (!dp[0][0]) {
      start = end - 1
      continue
    }
    const out: Seg[] = []
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && dels[i].text === adds[j].text && dp[i][j] === dp[i + 1][j + 1] + 1) {
        out.push({ k: 'line', text: dels[i].text, orig: dels[i].orig })
        i++
        j++
      } else if (j >= m || (i < n && dp[i + 1][j] >= dp[i][j + 1])) out.push(dels[i++])
      else out.push(adds[j++])
    }
    segs.splice(start, run.length, ...out)
    start += out.length - 1
  }
}

/** A line with its number in the original and now (a removed line: where it would be now); null: lines nobody has seen. */
export type Row = { t: ' ' | '+' | '-'; text: string; old: number; new: number } | null

/** The model as rows: known lines with their numbers in the original and now; null where lines are unknown. */
function rows(model: Model): Row[] {
  const out: Row[] = []
  let oldNext = 1
  let newNext = 1
  for (const s of model.segs) {
    if (s.k === 'gap') {
      if (out[out.length - 1] !== null) out.push(null)
      if (!Number.isFinite(s.n)) break
      oldNext = s.from + s.n
      newNext += s.n
    } else if (s.k === 'del') {
      out.push({ t: '-', text: s.text, old: s.orig, new: newNext })
      oldNext = s.orig + 1
    } else if (s.text === null) {
      if (out[out.length - 1] !== null) out.push(null)
      if (s.orig !== null) oldNext = s.orig + 1
      newNext++
    } else if (s.orig === null) {
      out.push({ t: '+', text: s.text, old: oldNext, new: newNext++ })
    } else {
      out.push({ t: ' ', text: s.text, old: s.orig, new: newNext++ })
      oldNext = s.orig + 1
    }
  }
  return out
}

/** Changes with up to three known lines around them; an unknown line ends a hunk. */
export function hunksFromRows(all: Row[]): Hunk[] {
  const hunks: Hunk[] = []
  let i = 0
  while (i < all.length) {
    const r = all[i]
    if (!r || r.t === ' ') {
      i++
      continue
    }
    // A change: reach back for context, then forward until three unchanged lines (or an unknown one) pass.
    let start = i
    while (start > 0 && i - start < CONTEXT && all[start - 1]?.t === ' ') start--
    let end = i
    let quiet = 0
    for (let j = i; j < all.length; j++) {
      const row = all[j]
      if (!row) break
      if (row.t === ' ') {
        quiet++
        if (quiet > CONTEXT * 2) break
      } else {
        quiet = 0
        end = j
      }
    }
    let stop = end + 1
    while (stop < all.length && stop - end <= CONTEXT && all[stop]?.t === ' ') stop++
    const slice = all.slice(start, stop) as Exclude<Row, null>[]
    const first = slice[0]
    hunks.push({
      oldStart: first.old,
      oldLines: slice.filter((x) => x.t !== '+').length,
      newStart: first.new,
      newLines: slice.filter((x) => x.t !== '-').length,
      lines: slice.map((x) => x.t + x.text)
    })
    i = stop
  }
  return hunks
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const slashes = (p: string) => p.replace(/\\/g, '/')

/** A path as shown: relative to `base` when inside it (Windows paths compare without case), with forward slashes. */
export function displayPath(abs: string, base: string | null): string {
  const path = slashes(abs)
  if (!base) return path
  const root = slashes(base).replace(/\/+$/, '')
  const windows = /^[a-z]:\//i.test(root)
  const inside = windows ? path.toLowerCase().startsWith(root.toLowerCase() + '/') : path.startsWith(root + '/')
  return inside ? path.slice(root.length + 1) : path
}

const pathKey = (p: string) => (/^[a-z]:[\\/]/i.test(p) ? slashes(p).toLowerCase() : slashes(p))

const byPath = (a: DiffFile, b: DiffFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * Every file the session's edits touched, from before its first edit to after
 * its last, in path order (so files hold still while Claude works). Files whose
 * edits cancel out drop away.
 */
export function composeEdits(ops: EditOp[], cwd: string | null): DiffFile[] {
  const models = new Map<string, { abs: string; model: Model; ops: EditOp[]; broken: boolean }>()
  for (const op of ops) {
    const key = pathKey(op.file)
    let entry = models.get(key)
    if (op.kind === 'create') {
      // A new file, or one deleted and made again: it starts over from nothing.
      models.set(key, { abs: op.file, model: created(op.content ?? ''), ops: [op], broken: false })
      continue
    }
    if (!entry) {
      entry = { abs: op.file, model: fresh(op.before ?? null), ops: [], broken: false }
      models.set(key, entry)
    } else if (op.before !== undefined && !entry.broken) {
      entry.broken = !reconcile(entry.model, op.before)
    }
    entry.ops.push(op)
    if (entry.broken) continue
    let ok = applyHunks(entry.model, op.hunks)
    if (ok && op.kind === 'write' && op.content !== undefined) ok = reconcile(entry.model, op.content)
    entry.broken = !ok
  }

  const files: DiffFile[] = []
  for (const { abs, model, ops: fileOps, broken } of models.values()) {
    if (!broken) normalize(model.segs)
    const hunks = broken ? fileOps.flatMap((op) => (op.kind === 'create' ? [] : op.hunks)) : hunksFromRows(rows(model))
    let added = 0
    let removed = 0
    for (const h of hunks) for (const l of h.lines) {
      if (l[0] === '+') added++
      else if (l[0] === '-') removed++
    }
    if (!broken && !added && !removed && !model.created) continue
    files.push({
      path: displayPath(abs, cwd),
      abs,
      status: model.created && !broken ? 'added' : 'modified',
      added,
      removed,
      hunks,
      ...(broken ? { note: 'Shown edit by edit: the file changed in ways the transcript doesn’t show.' } : {})
    })
  }
  return files.sort(byPath)
}

// ─── git ─────────────────────────────────────────────────────────────────────

/** A path git quoted ("a/caf\303\251"), unquoted; anything else as it is. */
export function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw
  const bytes: number[] = []
  const body = raw.slice(1, -1)
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch !== '\\') {
      for (const b of new TextEncoder().encode(ch)) bytes.push(b)
      continue
    }
    const next = body[++i]
    if (/[0-7]/.test(next)) {
      const oct = body.slice(i, i + 3)
      bytes.push(parseInt(oct, 8))
      i += 2
      continue
    }
    const map: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 }
    bytes.push(map[next] ?? next.charCodeAt(0))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** "a/src/x.ts" → "src/x.ts"; /dev/null → null. */
function sidePath(raw: string): string | null {
  const path = unquoteGitPath(raw.trim())
  if (path === '/dev/null') return null
  return path.replace(/^[ab]\//, '')
}

/** The two paths in "diff --git a/x b/x", when nothing else names them. */
function headerPaths(header: string): [string, string] {
  const rest = header.slice('diff --git '.length)
  const quoted = /^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(rest)
  if (quoted && (rest.startsWith('"') || rest.endsWith('"'))) return [sidePath(quoted[1]) ?? '', sidePath(quoted[2]) ?? '']
  // Unquoted, possibly with spaces: both sides are the same path unless it's a rename (which says so in its own lines).
  const half = (rest.length - 1) / 2
  if (Number.isInteger(half) && rest.slice(0, half).slice(2) === rest.slice(half + 1).slice(2)) {
    const p = rest.slice(2, half)
    return [p, p]
  }
  const parts = rest.split(' b/')
  return [parts[0].replace(/^a\//, ''), parts.slice(1).join(' b/')]
}

/** `git diff` output (unified, with git's headers) as files with their hunks. Paths stay relative to the repository. */
export function parseGitDiff(text: string): Omit<DiffFile, 'abs'>[] {
  const files: Omit<DiffFile, 'abs'>[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const header = lines[i]
    if (!header.startsWith('diff --git ')) {
      i++
      continue
    }
    let [fromPath, toPath] = headerPaths(header)
    let status: FileStatus = 'modified'
    let note: string | undefined
    let modeChanged = false
    const hunks: Hunk[] = []
    i++
    // Extended headers, up to the first hunk or the next file.
    for (; i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('@@'); i++) {
      const l = lines[i]
      if (l.startsWith('old mode')) modeChanged = true
      else if (l.startsWith('new file mode')) status = 'added'
      else if (l.startsWith('deleted file mode')) status = 'deleted'
      else if (l.startsWith('rename from ')) {
        status = 'renamed'
        fromPath = unquoteGitPath(l.slice('rename from '.length))
      } else if (l.startsWith('rename to ')) toPath = unquoteGitPath(l.slice('rename to '.length))
      else if (l.startsWith('--- ')) fromPath = sidePath(l.slice(4)) ?? fromPath
      else if (l.startsWith('+++ ')) toPath = sidePath(l.slice(4)) ?? toPath
      else if (l.startsWith('Binary files ') || l === 'GIT binary patch') note = 'Binary file'
    }
    // Hunks, each as long as its header says.
    while (i < lines.length && lines[i].startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[i])
      i++
      if (!m) continue
      const hunk: Hunk = { oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], lines: [] }
      let oldLeft = hunk.oldLines
      let newLeft = hunk.newLines
      while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i].startsWith('\\'))) {
        const l = lines[i]
        const sign = l[0]
        if (sign === '\\') {
          i++
          continue
        }
        if (sign === '+') newLeft--
        else if (sign === '-') oldLeft--
        else if (sign === ' ' || l === '') {
          oldLeft--
          newLeft--
        } else break
        hunk.lines.push(l === '' ? ' ' : l)
        i++
      }
      hunks.push(hunk)
    }
    let added = 0
    let removed = 0
    for (const h of hunks) for (const l of h.lines) {
      if (l[0] === '+') added++
      else if (l[0] === '-') removed++
    }
    if (!hunks.length && !note) note = status === 'renamed' ? 'Moved, with no changes inside.' : modeChanged ? 'Only its file mode changed.' : status === 'added' ? 'An empty file.' : undefined
    const path = status === 'deleted' ? fromPath : toPath
    files.push({ path, ...(status === 'renamed' ? { from: fromPath } : {}), status, added, removed, hunks, ...(note ? { note } : {}) })
  }
  return files
}

/** An untracked file's lines as one all-added hunk. */
export function addedFile(path: string, content: string): Omit<DiffFile, 'abs'> {
  const lines = linesOf(content)
  return {
    path,
    status: 'untracked',
    added: lines.length,
    removed: 0,
    hunks: lines.length ? [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: lines.map((l) => '+' + l) }] : []
  }
}

/** git status --porcelain -z: the untracked paths. */
export function untrackedPaths(status: string): string[] {
  return status
    .split('\0')
    .filter((entry) => entry.startsWith('?? '))
    .map((entry) => entry.slice(3))
    .filter((p) => p && !p.endsWith('/'))
}

/** Lines added and removed across files. */
export function totals(files: DiffFile[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const f of files) {
    added += f.added
    removed += f.removed
  }
  return { added, removed }
}
