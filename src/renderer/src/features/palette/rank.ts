// What the command palette lists for what you've typed: commands, sessions and
// folders, each kind in its own group, best match first, and the group with
// the best match on top. Things you picked lately win ties. Before you type:
// the sessions you were in last (so Enter goes back to the one before), then
// every command in menu order. Pure, so the ranking can be tested away from
// the window.
import { projectName, type SessionMeta } from '@shared/library'

export interface PaletteCommand {
  id: string
  /** What it says now ("Hide Sidebar"). */
  label: string
  /** The submenu it's listed in ("Sort Sessions By"). */
  submenu?: string
  /** Other names it answers to, matched like its label: the registry's own ("Show or Hide Sidebar"). */
  names: string[]
  /** Words that find it too, matched like a session's prompts: its keywords and its menu ("View"). */
  keywords: string
  shortcut?: string
  disabled: boolean
  checked: boolean
}

export interface PaletteSession {
  id: string
  title: string
  meta: SessionMeta
  archived: boolean
}

export interface PaletteFolder {
  id: string
  name: string
  /** The folders it's inside, outermost first. */
  path: string[]
}

export interface PaletteInput {
  query: string
  /** In menu order. */
  commands: readonly PaletteCommand[]
  sessions: readonly PaletteSession[]
  folders: readonly PaletteFolder[]
  /** The session the chat shows. Recent leaves it out: it's where you are. */
  current: string | null
  /** When you last settled on each session, by its ID. */
  viewed: Readonly<Record<string, number>>
  /** When you last picked each result, by its key. */
  picked: Readonly<Record<string, number>>
}

export type PaletteItem =
  | { kind: 'command'; key: string; command: PaletteCommand }
  | { kind: 'session'; key: string; session: PaletteSession }
  | { kind: 'folder'; key: string; folder: PaletteFolder }

export type GroupKey = 'recent' | 'commands' | 'sessions' | 'folders'

export interface PaletteGroup {
  key: GroupKey
  label: string
  items: PaletteItem[]
}

const LABELS: Record<GroupKey, string> = { recent: 'Recent', commands: 'Commands', sessions: 'Sessions', folders: 'Folders' }

/** Recent lists this many sessions. */
export const RECENT_COUNT = 5
/** A search lists at most this many sessions and folders: the best ones, and typing more narrows them. */
export const SESSION_LIMIT = 30
export const FOLDER_LIMIT = 20

/** How well one word of what you typed matched, best first. */
const EXACT = 100 // the whole name
const PREFIX = 90 // the start of the name
const WORD = 80 // the start of a later word ("term": Show Terminal)
const INITIALS = 70 // the first letters of its words ("ns": New Session)
const INSIDE = 60 // inside a word
const SCATTERED = 30 // its letters in order, with others between ("trml": Terminal)
/** A word that only matched a session's prompts or project, a folder's path or a command's keywords counts for half. */
const SECONDARY = 0.5
/** Several words that match as one phrase, at the start of the name or of a word in it. */
const PHRASE_START = 20
const PHRASE_WORD = 10
/** A group whose best result can't be used (a command that isn't available) goes below the rest. */
const UNUSABLE = 1000

/** Lower case without accents, so "cafe" finds "Café". */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

const folds = new Map<string, string>()
/** Folded once per text: the same titles and prompts are matched on every keystroke. */
function folded(text: string): string {
  let f = folds.get(text)
  if (f === undefined) {
    if (folds.size > 4000) folds.clear()
    f = fold(text)
    folds.set(text, f)
  }
  return f
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c)
const atWordStart = (text: string, i: number) => isWordChar(text[i]) && !isWordChar(text[i - 1])

/** Whether the term's letters start words of the text, in order. */
function initials(term: string, text: string): boolean {
  let t = 0
  for (let i = 0; i < text.length && t < term.length; i++) if (text[i] === term[t] && atWordStart(text, i)) t++
  return t === term.length
}

/** The term's letters in order with others between, closer together scoring higher. */
function scattered(term: string, text: string): number {
  let at = -1
  let first = -1
  for (const c of term) {
    at = text.indexOf(c, at + 1)
    if (at < 0) return 0
    if (first < 0) first = at
  }
  return Math.max(SCATTERED - (at - first + 1 - term.length), 10)
}

/** How well one word of the query matches a folded text: 0 when it doesn't. */
function termScore(term: string, text: string, primary: boolean): number {
  let best = 0
  for (let at = text.indexOf(term); at >= 0 && best < WORD; at = text.indexOf(term, at + 1)) {
    best = Math.max(best, at === 0 ? (text.length === term.length ? EXACT : PREFIX) : atWordStart(text, at) ? WORD : INSIDE)
  }
  if (!primary) return best
  if (best < INITIALS && term.length >= 2 && initials(term, text)) best = INITIALS
  if (!best && term.length >= 3) best = scattered(term, text)
  return best
}

/**
 * How well the query matches a result: every word must match its name (or
 * another name it answers to) or, for half, its other text. 0 when one
 * doesn't.
 */
function score(terms: readonly string[], phrase: string, names: readonly string[], other: readonly string[]): number {
  const primary = names.map(folded)
  let secondary: string[] | undefined
  let total = 0
  for (const term of terms) {
    let best = 0
    for (const text of primary) best = Math.max(best, termScore(term, text, true))
    // Other text scores half at most, so it only matters where the names matched weakly or not at all.
    if (best < EXACT * SECONDARY) for (const text of (secondary ??= other.map(folded))) best = Math.max(best, termScore(term, text, false) * SECONDARY)
    if (!best) return 0
    total += best
  }
  if (terms.length > 1) {
    if (primary.some((text) => text.startsWith(phrase))) total += PHRASE_START
    else if (primary.some((text) => wordStartOf(text, phrase))) total += PHRASE_WORD
  }
  return total
}

function wordStartOf(text: string, phrase: string): boolean {
  for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + 1)) if (atWordStart(text, at)) return true
  return false
}

export function searchWords(query: string): { terms: string[]; phrase: string } {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  return { terms, phrase: terms.join(' ') }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

interface Scored {
  item: PaletteItem
  score: number
  /** Can't be used now (a command that isn't available): listed after the rest. */
  unusable: boolean
}

export function rankPalette(input: PaletteInput): PaletteGroup[] {
  const { terms, phrase } = searchWords(input.query)
  const picked = (key: string) => input.picked[key] ?? 0
  const visited = (id: string) => Math.max(input.viewed[id] ?? 0, picked(`session:${id}`))
  const commandItem = (command: PaletteCommand): PaletteItem => ({ kind: 'command', key: `command:${command.id}`, command })
  const sessionItem = (session: PaletteSession): PaletteItem => ({ kind: 'session', key: `session:${session.id}`, session })

  if (!terms.length) {
    // Where you've been, newest first (then the sessions most recently active), and every command.
    const recent = input.sessions
      .filter((s) => !s.archived && s.id !== input.current)
      .sort((a, b) => visited(b.id) - visited(a.id) || b.meta.updated - a.meta.updated)
      .slice(0, RECENT_COUNT)
    const groups: PaletteGroup[] = [
      { key: 'recent', label: LABELS.recent, items: recent.map(sessionItem) },
      { key: 'commands', label: LABELS.commands, items: input.commands.map(commandItem) }
    ]
    return groups.filter((g) => g.items.length)
  }

  const commands: (Scored & { index: number })[] = []
  input.commands.forEach((command, index) => {
    const s = score(terms, phrase, [command.label, ...command.names], [command.keywords])
    if (s) commands.push({ item: commandItem(command), score: s, unusable: command.disabled, index })
  })
  // Ones you can't use now go last; equal matches keep menu order.
  commands.sort((a, b) => Number(a.unusable) - Number(b.unusable) || b.score - a.score || picked(b.item.key) - picked(a.item.key) || a.index - b.index)

  const sessions: (Scored & { session: PaletteSession })[] = []
  for (const session of input.sessions) {
    const { meta } = session
    const other = [meta.title, meta.firstPrompt, meta.lastPrompt, projectName(meta)].filter((t): t is string => !!t && t !== session.title)
    const s = score(terms, phrase, [session.title], other)
    if (s) sessions.push({ item: sessionItem(session), session, score: s, unusable: false })
  }
  // Archived sessions open too (in Archived), after the rest.
  sessions.sort(
    (a, b) =>
      Number(a.session.archived) - Number(b.session.archived) ||
      b.score - a.score ||
      visited(b.session.id) - visited(a.session.id) ||
      b.session.meta.updated - a.session.meta.updated
  )

  const folders: (Scored & { folder: PaletteFolder })[] = []
  for (const folder of input.folders) {
    const s = score(terms, phrase, [folder.name], [folder.path.join(' ')])
    if (s) folders.push({ item: { kind: 'folder', key: `folder:${folder.id}`, folder }, folder, score: s, unusable: false })
  }
  folders.sort(
    (a, b) =>
      b.score - a.score ||
      picked(b.item.key) - picked(a.item.key) ||
      a.folder.path.length - b.folder.path.length ||
      collator.compare(a.folder.name, b.folder.name)
  )

  const found: [GroupKey, Scored[]][] = [
    ['commands', commands],
    ['sessions', sessions.slice(0, SESSION_LIMIT)],
    ['folders', folders.slice(0, FOLDER_LIMIT)]
  ]
  // The group holding the best match leads; equal ones keep the order above (the sort is stable).
  return found
    .filter(([, list]) => list.length)
    .map(([key, list]) => ({ group: { key, label: LABELS[key], items: list.map((s) => s.item) }, best: list[0].score - (list[0].unusable ? UNUSABLE : 0) }))
    .sort((a, b) => b.best - a.best)
    .map((g) => g.group)
}

/** Every result in the order the list shows them. */
export const flatten = (groups: readonly PaletteGroup[]): PaletteItem[] => groups.flatMap((g) => g.items)

/** Whether Enter or a click can use it. */
export const usable = (item: PaletteItem): boolean => item.kind !== 'command' || !item.command.disabled
