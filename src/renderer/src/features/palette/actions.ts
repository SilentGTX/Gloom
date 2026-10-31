// What picking a session or a folder in the command palette does. A session
// opens in the chat with the keyboard in its composer. A folder opens, with
// every folder above it, and the sidebar shows it with the keyboard on it.
import { useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'

export function openSession(id: string, archived: boolean): void {
  const ui = useUi.getState()
  // The sidebar keeps a selection it can show: an archived session in Archived, any other in the library.
  if (ui.archive !== archived) {
    ui.setSearch('')
    ui.setArchive(archived)
  }
  ui.select([id])
  requestAnimationFrame(() => {
    const composer = document.querySelector<HTMLTextAreaElement>('textarea[data-composer]')
    const target = composer && !composer.disabled ? composer : document.querySelector<HTMLElement>('[aria-label="Transcript"]')
    target?.focus({ preventScroll: true })
  })
}

export function revealFolder(id: string, viaKeyboard: boolean): void {
  const { library, apply } = useLibrary.getState()
  const byId = new Map(library.folders.map((f) => [f.id, f]))
  const closed: string[] = []
  for (let f = byId.get(id), depth = 0; f && depth < 64; f = f.parentId ? byId.get(f.parentId) : undefined, depth++) if (!f.expanded) closed.push(f.id)
  if (closed.length) void apply({ type: 'setExpanded', ids: closed, expanded: true })
  const ui = useUi.getState()
  // Folders show in the library, not in search results or Archived.
  if (ui.search) ui.setSearch('')
  if (ui.archive) ui.setArchive(false)
  ui.showSidebar(viaKeyboard)
  ui.revealRow(`folder:${id}`)
}
