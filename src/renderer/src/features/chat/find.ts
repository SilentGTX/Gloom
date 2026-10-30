// Find in the transcript (Ctrl+F). The browser's own find can't see rows the
// list hasn't drawn, so matching runs over the loaded transcript's text, and
// the matches on screen are marked with the CSS Highlight API, which leaves the
// rendered markdown and code untouched.
import { create } from 'zustand'
import { countMatches, rowText, type Row } from './rows'

/** Past this many matches the count says "10,000+" and stops looking. */
export const MATCH_LIMIT = 10_000

export interface Match {
  rowIndex: number
  key: string
  /** Its place among the row's matches: what the row shows first, then what it hides. */
  inRow: number
  /** Inside folded details, which open to show it. */
  hidden: boolean
}

interface FindState {
  open: boolean
  query: string
  /** How many matches the open transcript has (the list counts them). */
  total: number
  /** The current match, or -1 before the first is chosen. */
  current: number
  /** Opened from the keyboard: the bar appears without animating. */
  instant: boolean
  /** The current match moved because you typed, not because you asked for the next: it doesn't pop. */
  typing: boolean
  /** Counts up whenever Find moves to a match, so the view follows it. */
  moves: number
  show(viaKeyboard: boolean): void
  hide(): void
  setQuery(query: string): void
  /** Moves to the next or previous match, wrapping around. */
  step(direction: 1 | -1): void
  setCurrent(current: number, typing?: boolean): void
}

export const useFind = create<FindState>()((set, get) => ({
  open: false,
  query: '',
  total: 0,
  current: -1,
  instant: false,
  typing: false,
  moves: 0,
  show: (viaKeyboard) => {
    set({ open: true, instant: viaKeyboard })
    // Focus (and select) the field even when it's already open, as Ctrl+F does everywhere.
    requestAnimationFrame(() => {
      const field = document.querySelector<HTMLInputElement>('input[data-find]')
      field?.focus()
      field?.select()
    })
  },
  hide: () => set({ open: false, current: -1 }),
  setQuery: (query) => set({ query, current: -1 }),
  step: (direction) => {
    const { current, total } = get()
    if (!total) return
    const next = current < 0 ? (direction === 1 ? 0 : total - 1) : (current + direction + total) % total
    set({ current: next, typing: false, moves: get().moves + 1 })
  },
  setCurrent: (current, typing = false) => set({ current, typing, moves: get().moves + 1 })
}))

/** Every match in the loaded rows, in order. */
export function findMatches(rows: readonly Row[], query: string): Match[] {
  const needle = query.trim()
  if (!needle) return []
  const matches: Match[] = []
  for (let rowIndex = 0; rowIndex < rows.length && matches.length < MATCH_LIMIT; rowIndex++) {
    const row = rows[rowIndex]
    const { shown, hidden } = rowText(row)
    const a = countMatches(shown, needle)
    const b = countMatches(hidden, needle)
    for (let i = 0; i < a + b && matches.length < MATCH_LIMIT; i++) matches.push({ rowIndex, key: row.key, inRow: i, hidden: i >= a })
  }
  return matches
}

// ─── Marking matches on screen ───────────────────────────────────────────────

/** Ranges for every occurrence of `needle` in an element's text, case-insensitively, across text nodes. */
export function rangesIn(root: Element, needle: string): Range[] {
  if (!needle) return []
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('[data-find-skip]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text)
    starts.push(text.length)
    text += (n as Text).data
  }
  const hay = text.toLowerCase()
  const lower = needle.toLowerCase()
  const ranges: Range[] = []
  // The node holding character `i`: a binary search over where each node starts.
  const locate = (i: number): [Text, number] => {
    let lo = 0
    let hi = nodes.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= i) lo = mid
      else hi = mid - 1
    }
    return [nodes[lo], i - starts[lo]]
  }
  for (let i = hay.indexOf(lower); i !== -1; i = hay.indexOf(lower, i + lower.length)) {
    const range = document.createRange()
    const [startNode, startOffset] = locate(i)
    const [endNode, endOffset] = locate(i + lower.length - 1)
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset + 1)
    ranges.push(range)
  }
  return ranges
}

const supported = typeof CSS !== 'undefined' && 'highlights' in CSS

/** Marks the matches drawn in `scroller`, and the current one apart; returns the current one's range. */
export function paintMatches(scroller: Element | null, needle: string, current: Match | undefined): Range | null {
  if (!supported) return null
  if (!scroller || !needle.trim()) {
    CSS.highlights.delete('find')
    CSS.highlights.delete('find-current')
    return null
  }
  const all: Range[] = []
  let currentRange: Range | null = null
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-row-key]')) {
    const ranges = rangesIn(el, needle.trim())
    if (current && el.dataset.rowKey === current.key && ranges.length) {
      currentRange = ranges[Math.min(current.inRow, ranges.length - 1)]
      all.push(...ranges.filter((r) => r !== currentRange))
    } else all.push(...ranges)
  }
  CSS.highlights.set('find', new Highlight(...all))
  if (currentRange) CSS.highlights.set('find-current', new Highlight(currentRange))
  else CSS.highlights.delete('find-current')
  return currentRange
}

export function clearMatches(): void {
  if (!supported) return
  CSS.highlights.delete('find')
  CSS.highlights.delete('find-current')
}

/** Safari's find indicator: the current match pops once, then lets go. */
export function popMatch(range: Range): void {
  const rect = range.getClientRects()[0]
  const host = range.startContainer.parentElement
  if (!rect || !host || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const pop = document.createElement('div')
  pop.className = 'find-pop'
  pop.textContent = range.toString()
  const style = getComputedStyle(host)
  Object.assign(pop.style, {
    left: `${rect.left - 2}px`,
    top: `${rect.top - 1}px`,
    height: `${rect.height + 2}px`,
    padding: '1px 2px',
    font: style.font,
    lineHeight: `${rect.height}px`,
    whiteSpace: 'pre',
    color: 'var(--find-current-text)'
  })
  document.body.appendChild(pop)
  pop.addEventListener('animationend', () => pop.remove())
  setTimeout(() => pop.remove(), 800)
}
