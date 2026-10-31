// A line cut short with an ellipsis shows the rest when the pointer rests on
// it, as macOS's expansion tooltips do for truncated titles in lists and
// menus. One listener for the whole window: it looks at the line under the
// pointer as the pointer arrives, so nothing is measured until then.

/** Lines that end in an ellipsis when they don't fit (Tailwind's `truncate`). */
const TRUNCATED = '.truncate'
/** Marks a title this added, so a title the component set itself is never touched. */
const MARK = 'data-overflow-title'

function update(line: HTMLElement): void {
  const own = line.hasAttribute('title') && !line.hasAttribute(MARK)
  if (own) return
  if (line.scrollWidth > line.clientWidth + 1) {
    line.title = line.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    line.setAttribute(MARK, '')
  } else if (line.hasAttribute(MARK)) {
    line.removeAttribute('title')
    line.removeAttribute(MARK)
  }
}

export function installOverflowTitles(root: Document = document): void {
  root.addEventListener('pointerover', (e) => {
    const line = e.target instanceof Element ? e.target.closest<HTMLElement>(TRUNCATED) : null
    if (line) update(line)
  })
}
