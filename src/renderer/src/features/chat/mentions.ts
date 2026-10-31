// `@` in the composer, as Claude Code does it (PLAN.md › 10): the `@` word the
// caret is in, the files and folders that match what's typed after it, best
// first, and the text a pick puts in its place. Claude Code reads what's
// mentioned when the message arrives; Gloom only writes the path. Pure, so it's
// tested away from the window.
import type { FileListing } from '@shared/live'

/** As many as Claude Code lists. */
export const MENTION_LIMIT = 15

export interface Mention {
  /** Where the `@` is. */
  start: number
  /** Where its word ends: a pick replaces all of it, past the caret too. */
  end: number
  /** What's typed between the `@` (or its opening quote) and the caret. */
  query: string
}

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c)

/**
 * The `@` word the caret is in: an `@` at the start or after a space, and no
 * space between it and the caret, unless the path is in quotes that are still
 * open (`@"my docs/no`). An `@` inside a word (an email address) isn't one.
 */
export function mentionAt(text: string, caret: number): Mention | null {
  const quoted = openQuote(text, caret)
  if (quoted) return quoted
  let start = caret
  while (start > 0 && !isSpace(text[start - 1])) start--
  if (text[start] !== '@') return null
  let end = caret
  while (end < text.length && !isSpace(text[end])) end++
  return { start, end, query: text.slice(start + 1, caret) }
}

function openQuote(text: string, caret: number): Mention | null {
  const at = caret >= 2 ? text.lastIndexOf('@"', caret - 2) : -1
  if (at < 0 || (at > 0 && !isSpace(text[at - 1]))) return null
  const query = text.slice(at + 2, caret)
  if (/["\n]/.test(query)) return null
  // A closing quote already there goes with the rest of the word.
  const rest = text.slice(caret).search(/["\n]/)
  const end = rest >= 0 && text[caret + rest] === '"' ? caret + rest + 1 : caret
  return { start: at, end, query }
}

/** How a path goes into a message: quoted when it has a space in it, as Claude Code writes it. */
export function mentionText(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`
}

/** The text with a pick in place of the `@` word, a space after it, and the caret after that space. */
export function insertMention(text: string, mention: Mention, path: string): { text: string; caret: number } {
  const token = mentionText(path)
  const after = text.slice(mention.end)
  return { text: text.slice(0, mention.start) + token + (after.startsWith(' ') ? '' : ' ') + after, caret: mention.start + token.length + 1 }
}

// ─── Ranking ─────────────────────────────────────────────────────────────────

/** A path made ready to match: lower case, and its name apart. */
export interface FileCandidate {
  path: string
  lower: string
  /** The last part of the path, without a folder's slash. */
  original: string
  /** The same, lower case. */
  name: string
}

export interface PreparedFiles {
  top: string[]
  candidates: FileCandidate[]
}

/** Done once per listing, which can be tens of thousands of paths: only what every keystroke needs. */
export function prepareFiles(listing: FileListing): PreparedFiles {
  return {
    top: listing.top,
    candidates: listing.all.map((path) => {
      const bare = path.endsWith('/') ? path.slice(0, -1) : path
      const original = bare.slice(bare.lastIndexOf('/') + 1)
      return { path, lower: path.toLowerCase(), original, name: original.toLowerCase() }
    })
  }
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

/** Whether a word of the name starts here: after `.`, `-`, `_` or a space, or at a capital ("Button" in "IconButton"). */
function wordStart(name: string, i: number): boolean {
  const c = name[i]
  const before = name[i - 1]
  return isWordChar(c) && (!isWordChar(before) || (/\p{Lu}/u.test(c) && /\p{Ll}/u.test(before)))
}

/** How well a path matched, best first; the letters-in-order kinds add how close together they were. */
const EXACT = 9_000 // the name, whole
const PREFIX = 8_000 // the start of the name
const WORD = 7_000 // the start of a word in the name ("conf" finds app.config.ts)
const INSIDE = 6_000 // inside the name
const PATH_START = 5_000 // the start of the path, or of a folder in it ("comp" finds src/components/Menu.tsx)
const IN_PATH = 4_000 // inside the path
const NAME_LETTERS = 3_000 // the name's letters in order ("btn" finds Button.tsx)
const PATH_LETTERS = 2_000 // letters in order across the path ("sbtn" finds src/components/Button.tsx)

/**
 * The query's letters in order in the text, or -1: up to 999, half of it for
 * starting where a word does ("btn" in Button.tsx, not unbuttoned.ts), half
 * for how close together they sat.
 */
function letters(query: string, text: string, startsWord: (i: number) => boolean): number {
  let at = -1
  let first = -1
  for (const c of query) {
    at = text.indexOf(c, at + 1)
    if (at < 0) return -1
    if (first < 0) first = at
  }
  return (startsWord(first) ? 500 : 0) + Math.max(0, 499 - (at - first + 1 - query.length) * 5)
}

function score(c: FileCandidate, q: string, inPath: boolean): number {
  // Every match below has the query's letters in the path, in order: most paths stop here.
  const spread = letters(q, c.lower, (i) => i === 0 || c.lower[i - 1] === '/')
  if (spread < 0) return -1
  if (!inPath) {
    if (c.name === q) return EXACT
    if (c.name.startsWith(q)) return PREFIX
    const at = c.name.indexOf(q)
    if (at > 0) {
      for (let i = at; i >= 0; i = c.name.indexOf(q, i + 1)) if (wordStart(c.original, i)) return WORD
      return INSIDE
    }
  }
  if (c.lower.startsWith(q) || c.lower.includes(`/${q}`)) return PATH_START
  if (c.lower.includes(q)) return IN_PATH
  if (!inPath) {
    const near = letters(q, c.name, (i) => wordStart(c.original, i))
    if (near >= 0) return NAME_LETTERS + near
  }
  return PATH_LETTERS + spread
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Better first: the stronger match, then the shorter path, then A–Z. */
function before(a: { c: FileCandidate; s: number }, b: { c: FileCandidate; s: number }): boolean {
  if (a.s !== b.s) return a.s > b.s
  if (a.c.path.length !== b.c.path.length) return a.c.path.length < b.c.path.length
  return collator.compare(a.c.path, b.c.path) < 0
}

/**
 * What `@` lists for what's typed after it. Nothing typed: the folder's top
 * level, as Claude Code shows it. Otherwise the paths with the typed letters
 * in them, in order, best first: a match in the name beats one in the folders
 * above it. A slash in the query (either way round) matches across folders.
 */
export function rankFiles(files: PreparedFiles, query: string, limit = MENTION_LIMIT): string[] {
  const q = query.toLowerCase().replace(/\\/g, '/')
  if (!q) return files.top.slice(0, limit)
  const inPath = q.includes('/')
  // The best few, kept in order as the list is read once: a big folder is tens of thousands of paths.
  const best: { c: FileCandidate; s: number }[] = []
  for (const c of files.candidates) {
    const s = score(c, q, inPath)
    if (s < 0) continue
    const hit = { c, s }
    if (best.length === limit && !before(hit, best[limit - 1])) continue
    let i = best.length
    while (i > 0 && before(hit, best[i - 1])) i--
    best.splice(i, 0, hit)
    if (best.length > limit) best.pop()
  }
  return best.map((b) => b.c.path)
}
