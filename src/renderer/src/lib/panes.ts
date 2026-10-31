// F6 and Shift+F6: the keyboard steps between the window's panes, in the
// window's order, as it does in Windows' own apps (and with Control-F6 on the
// Mac). Each pane says which of its parts takes the keyboard; a pane that isn't
// showing is skipped. From a toolbar between panes, F6 goes on to the next one.
// Tab still walks the controls inside a pane.

const PANES = ['sidebar', 'transcript', 'composer', 'diff', 'terminal', 'inspector'] as const
type Pane = (typeof PANES)[number]

const shown = (el: Element) => el.getClientRects().length > 0 && !el.closest('[inert]')

/** The pane's root that's showing (the sidebar can be both inline and, in a narrow window, a sheet). */
function paneRoot(pane: Pane): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(`[data-pane="${pane}"]`)].find(shown) ?? null
}

/** What takes the keyboard in a pane: where you were in the sidebar, the transcript itself, the card or box you'd answer in… */
function entry(pane: Pane, root: HTMLElement): HTMLElement | null {
  const first = (...selectors: string[]) => {
    for (const selector of selectors) {
      const el = root.querySelector<HTMLElement>(selector)
      if (el && shown(el)) return el
    }
    return null
  }
  switch (pane) {
    case 'sidebar':
      return first('[role="treeitem"][tabindex="0"]', 'input[data-search]')
    case 'transcript':
      return root
    case 'composer':
      return first('[role="region"] button[data-autofocus]', '[role="region"] button', 'textarea', 'button')
    case 'diff':
      return first('[aria-label="Changes"]', '[role="tab"][aria-selected="true"]')
    case 'terminal':
      return first('textarea', 'button')
    case 'inspector':
      return first('button:not([disabled])')
  }
}

const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0

export function focusPane(step: 1 | -1): void {
  // In the window's order, as Tab goes: the terminal under the chat comes before the diff beside it.
  const panes = PANES.flatMap((pane) => {
    const root = paneRoot(pane)
    const el = root && entry(pane, root)
    return root && el ? [{ root, el }] : []
  }).sort((a, b) => (follows(a.root, b.root) ? -1 : 1))
  if (!panes.length) return
  const n = panes.length
  const active = document.activeElement
  const at = panes.findIndex((p) => p.root.contains(active))
  let next: number
  if (at >= 0) next = (at + step + n) % n
  else if (active && active !== document.body) {
    // Between panes (a toolbar's button): the pane after it, or the one before.
    const after = panes.findIndex((p) => follows(active, p.root))
    next = step > 0 ? (after < 0 ? 0 : after) : (after < 0 ? n - 1 : (after - 1 + n) % n)
  } else next = step > 0 ? 0 : n - 1
  panes[next].el.focus()
}
