import { useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { Archive, FolderPlus, Search, SearchX, SquarePen, X } from 'lucide-react'
import { subtreeIds } from '@shared/library'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ContextMenuRoot, ContextMenuTrigger } from '../../components/ui/Menu'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useNow } from '../../lib/now'
import { useLibrary } from '../../stores/library'
import { useUi } from '../../stores/ui'
import { FilingRules } from '../folders/FilingRules'
import { deleteFolder, newFolder } from '../folders/folders'
import { FolderMenu } from '../folders/FolderMenu'
import { useDrag, type DropData } from '../library/drag'
import { archiveSessions, SessionMenu } from '../sessions/SessionMenu'
import { AppMenu } from '../shell/AppMenu'
import { ArchiveRow, GroupContents, GroupRow, MoreRow, RowMotion, SectionHeading, SessionRow } from './rows'
import {
  buildTree,
  nest,
  type GroupRow as GroupRowData,
  type MoreRow as MoreRowData,
  type Section,
  type SessionRow as SessionRowData,
  type TreeNode,
  type TreeRow
} from './tree'

/** The Archived row at the foot of the sidebar, last in the keyboard's order. */
const ARCHIVE = 'archive'
/** Past this many rows they stop springing to new places: measuring every one would cost frames. */
const LAYOUT_LIMIT = 300
/** Library groups that take sessions dropped on them. */
const DROPS = { unfiled: 'unfiled', pinned: 'pinned' } as const

type MenuTarget = { kind: 'folder'; id: string } | { kind: 'sessions'; ids: string[]; ring: string | null }

/**
 * The sidebar as one floating object: Gloom's dusk sky inside it, the glass
 * over the sky. The same panel sits inline and slides in as the narrow-window
 * sheet, so it looks the same wherever it appears.
 */
export function SidebarPanel({ width, inSheet }: { width: number; inSheet?: boolean }) {
  return (
    <div className="relative h-full shrink-0" style={{ width }}>
      <div className="sky rounded-[var(--radius-panel)]" aria-hidden />
      <Sidebar width={width} inSheet={inSheet} />
    </div>
  )
}

/**
 * Your library and your folders in one tree, in Liquid Glass over the dusk.
 * Groups open to show their sessions nested inside; the selected session is
 * the one the chat shows. Archived waits at the foot.
 */
function Sidebar({ width, inSheet }: { width: number; inSheet?: boolean }) {
  const search = useUi((s) => s.search)
  const sort = useUi((s) => s.sort)
  const openSmart = useUi((s) => s.openSmart)
  const archive = useUi((s) => s.archive)
  const selection = useUi((s) => s.selection)
  const shown = useUi((s) => s.shown)
  const renaming = useUi((s) => s.renaming)
  const select = useUi((s) => s.select)
  const library = useLibrary((s) => s.library)
  const sessions = useLibrary((s) => s.sessions)
  const indexed = useLibrary((s) => s.indexed)
  const apply = useLibrary((s) => s.apply)
  const now = useNow(15_000)
  const selected = useMemo(() => new Set(selection), [selection])
  // The selected sessions always show: a group shows as far down as they are.
  const tree = useMemo(
    () => buildTree({ library, sessions, openSmart, search, archive, sort, now, shown, keep: selected }),
    [library, sessions, openSmart, search, archive, sort, now, shown, selected]
  )

  const root = useRef<HTMLElement>(null)
  /** The row the keyboard is on: the sidebar's one tab stop. */
  const [cursor, setCursor] = useState<string | null>(null)
  /** The row Shift extends a selection from. */
  const anchor = useRef<string | null>(null)
  /** A press on a row that's already selected may start dragging the whole selection; a plain click then narrows it. */
  const narrowOnClick = useRef<string | null>(null)
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [rulesFor, setRulesFor] = useState<string | null>(null)
  // Rows spring to their new places after a click or a drop, but not after a key.
  const [viaKeyboard, setViaKeyboard] = useState(false)
  const typed = useRef({ text: '', at: 0 })
  /** When a context menu was opened from the keyboard, so the browser's own copy of it is ignored. */
  const keyMenuAt = useRef(-Infinity)
  // Rows that come with the first index appear as they are; after that, rows arriving slide in.
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!indexed || settled) return
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [indexed, settled])

  const searching = search.trim() !== ''
  const order = useMemo(() => [...tree.rows.map((r) => r.key), ARCHIVE], [tree])
  const byKey = useMemo(() => new Map<string, TreeRow>(tree.rows.map((r) => [r.key, r])), [tree])
  // The selection in sidebar order, each session once; any that aren't showing come last.
  const selectedInOrder = useMemo(() => {
    const shown = tree.rows.flatMap((r) => (r.kind === 'session' && selected.has(r.item.id) ? [r.item.id] : []))
    return [...new Set([...shown, ...selection])]
  }, [tree, selected, selection])

  // A selection that has left the sidebar (archived, its transcript gone) is let go.
  useEffect(() => {
    if (!indexed) return
    const kept = selection.filter((id) => sessions[id] && (archive || searching || !library.sessions[id]?.archived))
    if (kept.length !== selection.length) select(kept)
  }, [indexed, selection, sessions, library, archive, searching, select])

  const firstSelected = tree.rows.find((r) => r.kind === 'session' && selected.has(r.item.id))?.key
  const tabKey = cursor && order.includes(cursor) ? cursor : (firstSelected ?? order[0])
  // A session being renamed shows its field once: on the row you're on, else its first row.
  const renameKey =
    renaming?.kind === 'folder'
      ? `folder:${renaming.id}`
      : renaming?.kind === 'session'
        ? cursor && (byKey.get(cursor) as SessionRowData | undefined)?.item?.id === renaming.id
          ? cursor
          : tree.rows.find((r) => r.kind === 'session' && r.item.id === renaming.id)?.key
        : undefined

  const focusRow = (key: string) => root.current?.querySelector<HTMLElement>(`[data-nav="${CSS.escape(key)}"]`)?.focus()

  const selectRange = (from: string, to: string) => {
    const a = order.indexOf(from)
    const b = order.indexOf(to)
    const ids = new Set<string>()
    for (const key of a < 0 || b < 0 ? [to] : order.slice(Math.min(a, b), Math.max(a, b) + 1)) {
      const row = byKey.get(key)
      if (row?.kind === 'session') ids.add(row.item.id)
    }
    select([...ids])
  }

  /** Moves the keyboard to a row. Landing on a session selects it, as arrows do in Mail; Shift extends, Ctrl only moves. */
  const moveTo = (index: number, how: 'select' | 'extend' | 'focus' = 'select') => {
    const key = order[Math.max(0, Math.min(order.length - 1, index))]
    if (!key) return
    setCursor(key)
    focusRow(key)
    const row = byKey.get(key)
    if (row?.kind !== 'session' || how === 'focus') return
    if (how === 'extend') {
      anchor.current ??= cursor && byKey.get(cursor)?.kind === 'session' ? cursor : key
      return selectRange(anchor.current, key)
    }
    select([row.item.id])
    anchor.current = key
  }

  const toggleGroup = (row: GroupRowData, all = false, open = !row.open) => {
    if (!row.hasChildren) return
    if (row.kind === 'smart') {
      // A group that closes starts over at five when it opens again.
      if (!open) useUi.getState().resetShown([row.key])
      return useUi.getState().toggleSmart(row.smart, open)
    }
    const ids = all ? [...subtreeIds(library.folders, row.folder.id)] : [row.folder.id]
    if (!open) useUi.getState().resetShown(ids.map((id) => `folder:${id}`))
    void apply({ type: 'setExpanded', ids, expanded: open })
  }

  /** Shows the next five of a group's sessions, and takes the keyboard on to the first of them. */
  const showMoreFrom = (row: MoreRowData) => {
    const showing = tree.rows.filter((r) => r.kind === 'session' && r.group === row.group).length
    useUi.getState().showMore(row.group, showing)
    requestAnimationFrame(() => root.current?.querySelectorAll<HTMLElement>(`[data-nav^="${CSS.escape(row.group)}/"]`)[showing]?.focus())
  }

  const toggleArchive = () => {
    useUi.getState().setSearch('')
    useUi.getState().setArchive(!archive)
  }

  // Selection follows the press, as in Finder and Mail. Pressing a row that's
  // already selected keeps the selection, so it can be dragged; a plain click
  // without a drag then narrows it to that row.
  const press = (row: SessionRowData, e: PointerEvent) => {
    if (e.button !== 0) return
    const id = row.item.id
    setCursor(row.key)
    narrowOnClick.current = null
    if (e.shiftKey && anchor.current) selectRange(anchor.current, row.key)
    else if (e.ctrlKey || e.metaKey) {
      select(selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id])
      anchor.current = row.key
    } else if (!selected.has(id)) {
      select([id])
      anchor.current = row.key
    } else narrowOnClick.current = id
  }
  const click = (row: SessionRowData, e: MouseEvent) => {
    const plain = !e.shiftKey && !e.ctrlKey && !e.metaKey
    if (narrowOnClick.current === row.item.id && plain) {
      select([row.item.id])
      anchor.current = row.key
    }
    narrowOnClick.current = null
    // Choosing a session sends away the sheet the sidebar slid in as.
    if (inSheet && plain) useUi.getState().closeSheet(false)
  }

  const renameFolderEnd = (id: string, name: string | null) => {
    useUi.getState().rename(null)
    if (name !== null) void apply({ type: 'renameFolder', id, name })
    requestAnimationFrame(() => focusRow(`folder:${id}`))
  }
  const renameSessionEnd = (row: SessionRowData, title: string | null) => {
    useUi.getState().rename(null)
    if (title !== null) {
      const claude = sessions[row.item.id]?.title
      void apply({ type: 'renameSession', id: row.item.id, title: title.trim() === claude ? null : title })
    }
    requestAnimationFrame(() => focusRow(row.key))
  }

  /** Archives what's selected (or the row you're on), and the next session in its group takes the selection, as in Mail. */
  const archiveFrom = (row: SessionRowData) => {
    const ids = (selected.has(row.item.id) ? selectedInOrder : [row.item.id]).filter((id) => !library.sessions[id]?.archived)
    if (!ids.length) return
    const siblings = tree.rows.filter((r): r is SessionRowData => r.kind === 'session' && r.group === row.group)
    const at = siblings.findIndex((r) => r.key === row.key)
    const next = [...siblings.slice(at + 1), ...siblings.slice(0, at).reverse()].find((r) => !ids.includes(r.item.id))
    archiveSessions(ids)
    if (!next) return select([])
    select([next.item.id])
    anchor.current = next.key
    setCursor(next.key)
    requestAnimationFrame(() => focusRow(next.key))
  }

  /** Opens the context menu at a row, as a right-click there would. */
  const menuAt = (el: HTMLElement) => {
    keyMenuAt.current = performance.now()
    const box = el.getBoundingClientRect()
    el.dispatchEvent(new globalThis.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: box.left + 32, clientY: box.top + box.height / 2 }))
  }

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT') return
    const el = target.closest<HTMLElement>('[data-nav]')
    const key = el?.dataset.nav
    if (!el || !key) return
    if (!viaKeyboard) setViaKeyboard(true)
    const i = order.indexOf(key)
    const row = byKey.get(key)
    const group = row?.kind === 'smart' || row?.kind === 'folder' ? row : undefined
    const session = row?.kind === 'session' ? row : undefined
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    const how = e.shiftKey ? 'extend' : e.ctrlKey ? 'focus' : 'select'
    switch (e.key) {
      case 'ArrowDown':
        handled()
        return moveTo(i + 1, how)
      case 'ArrowUp':
        handled()
        return moveTo(i - 1, how)
      case 'PageDown':
        handled()
        return moveTo(i + 10, how)
      case 'PageUp':
        handled()
        return moveTo(i - 10, how)
      case 'Home':
        handled()
        return moveTo(0, how)
      case 'End':
        handled()
        return moveTo(order.length - 1, how)
      case 'ArrowRight':
        handled()
        // Open a closed group; on an open one, step to its first row.
        if (group?.hasChildren) {
          if (!group.open) toggleGroup(group, false, true)
          else moveTo(i + 1)
        }
        return
      case 'ArrowLeft': {
        handled()
        // Close an open group; anywhere inside one, step out to it.
        if (group?.hasChildren && group.open) return toggleGroup(group, false, false)
        const depth = row?.depth ?? 0
        const parent = depth > 0 ? order.slice(0, i).findLast((k) => (byKey.get(k)?.depth ?? 0) < depth && byKey.get(k)?.kind !== 'session') : undefined
        if (parent) moveTo(order.indexOf(parent), 'focus')
        return
      }
      case 'Enter':
      case ' ':
        handled()
        if (key === ARCHIVE) return toggleArchive()
        if (row?.kind === 'more') return showMoreFrom(row)
        if (group) return toggleGroup(group)
        if (session && e.key === ' ') {
          // Space selects; Ctrl+Space adds or takes away, as in Explorer.
          const id = session.item.id
          select(e.ctrlKey ? (selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id]) : [id])
          anchor.current = key
          return
        }
        if (session) {
          // Into the chat.
          if (inSheet) useUi.getState().closeSheet(true)
          requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-label="Transcript"]')?.focus())
        }
        return
      case 'F2':
        handled()
        if (row?.kind === 'folder') useUi.getState().rename({ kind: 'folder', id: row.folder.id })
        else if (session) useUi.getState().rename({ kind: 'session', id: session.item.id })
        return
      case 'Delete':
        handled()
        if (row?.kind === 'folder') void deleteFolder(row.folder)
        else if (session && !archive) archiveFrom(session)
        return
      case 'Escape':
        if (!archive) return
        handled()
        useUi.getState().setArchive(false)
        setCursor(ARCHIVE)
        requestAnimationFrame(() => focusRow(ARCHIVE))
        return
      case 'ContextMenu':
        handled()
        return menuAt(el)
    }
    if (e.key === 'F10' && e.shiftKey) {
      handled()
      return menuAt(el)
    }
    // Ctrl+A selects the sessions in the group you're in.
    if (e.key.toLowerCase() === 'a' && (e.ctrlKey || e.metaKey)) {
      handled()
      const within = session ? session.group : key
      const ids = tree.rows.flatMap((r) => (r.kind === 'session' && r.group === within ? [r.item.id] : []))
      if (ids.length) select([...new Set(ids)])
      return
    }
    // Numpad * opens everything below, as in Explorer's tree.
    if (e.code === 'NumpadMultiply' && group) {
      handled()
      if (group.kind === 'folder') void apply({ type: 'setExpanded', ids: [...subtreeIds(library.folders, group.folder.id)], expanded: true })
      else toggleGroup(group, false, true)
      return
    }
    // Type to find: the next row whose name starts with what you typed.
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== ' ') {
      handled()
      const t = typed.current
      t.text = e.timeStamp - t.at > 700 ? e.key : t.text + e.key
      t.at = e.timeStamp
      const want = t.text.toLowerCase()
      const labels = order.map((k) => root.current?.querySelector<HTMLElement>(`[data-nav="${CSS.escape(k)}"]`)?.dataset.label?.toLowerCase() ?? '')
      const start = t.text.length > 1 ? i : i + 1
      for (let n = 0; n < order.length; n++) {
        const j = (start + n) % order.length
        if (labels[j].startsWith(want)) return moveTo(j)
      }
    }
  }

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]')?.dataset.nav
    if (key && key !== cursor) setCursor(key)
  }

  // One context menu for the whole tree, aimed at the row that was right-clicked:
  // on a selected session it acts on the whole selection; on any other, on that
  // one alone, ringed, the selection untouched.
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    const preventBaseUI = () => (e as unknown as { preventBaseUIHandler(): void }).preventBaseUIHandler()
    // The browser's own menu event for a key we've already answered.
    if (e.nativeEvent.isTrusted && performance.now() - keyMenuAt.current < 500) {
      e.preventDefault()
      return preventBaseUI()
    }
    const key = (e.target as HTMLElement).closest<HTMLElement>('[data-nav]')?.dataset.nav
    const row = key ? byKey.get(key) : undefined
    if (row?.kind === 'folder') return setMenu({ kind: 'folder', id: row.folder.id })
    if (row?.kind === 'session') {
      const id = row.item.id
      return setMenu(selected.has(id) ? { kind: 'sessions', ids: selectedInOrder, ring: null } : { kind: 'sessions', ids: [id], ring: row.key })
    }
    preventBaseUI()
  }
  const menuFolder = menu?.kind === 'folder' ? library.folders.find((f) => f.id === menu.id) : undefined

  const dragKind = useDrag((s) => s.active?.kind)
  const { setNodeRef: rootDropRef } = useDroppable({ id: 'drop:root', data: { kind: 'root' } satisfies DropData, disabled: dragKind !== 'folder' })
  const rootDropping = useDrag((s) => s.target?.id === 'drop:root')

  const renderRow = (row: TreeRow) => {
    const tabbable = tabKey === row.key
    if (row.kind === 'more') return <MoreRow key={row.key} row={row} tabbable={tabbable} onShow={() => showMoreFrom(row)} />
    if (row.kind === 'session') {
      const isSelected = selected.has(row.item.id)
      return (
        <SessionRow
          key={row.key}
          row={row}
          selected={isSelected}
          selection={isSelected ? selectedInOrder : undefined}
          tabbable={tabbable}
          ringed={menu?.kind === 'sessions' && menu.ring === row.key}
          renaming={renameKey === row.key}
          now={now}
          onPress={(e) => press(row, e)}
          onClick={(e) => click(row, e)}
          onRenameEnd={(title) => renameSessionEnd(row, title)}
        />
      )
    }
    return (
      <GroupRow
        key={row.key}
        row={row}
        tabbable={tabbable}
        renaming={renameKey === row.key}
        menuOpen={row.kind === 'folder' && menu?.kind === 'folder' && menu.id === row.folder.id}
        accepts={row.kind === 'smart' ? DROPS[row.smart as keyof typeof DROPS] : undefined}
        onToggle={(all) => toggleGroup(row, all)}
        onRenameEnd={(name) => row.kind === 'folder' && renameFolderEnd(row.folder.id, name)}
      />
    )
  }

  // A row, and after an open group the box that holds what's inside it.
  const renderNodes = (nodes: TreeNode[]): ReactNode[] =>
    nodes.flatMap(({ row, children }) =>
      row.kind === 'session' || row.kind === 'more' || !row.open || children.length === 0
        ? [renderRow(row)]
        : [renderRow(row), <GroupContents key={`${row.key}/contents`}>{renderNodes(children)}</GroupContents>]
    )

  const heading = (section: Section, first: boolean) => {
    if (section.key === 'folders')
      return (
        <SectionHeading
          dropRef={rootDropRef}
          dropping={rootDropping}
          action={
            <Tooltip label="New Folder" shortcut="Ctrl+Shift+N">
              <Button aria-label="New folder" size="small" onClick={() => void newFolder(null)}>
                <FolderPlus size={15} strokeWidth={1.75} />
              </Button>
            </Tooltip>
          }
        >
          {section.label}
        </SectionHeading>
      )
    if (section.key === 'archive')
      return (
        <SectionHeading
          first={first}
          count={section.count}
          action={
            <Button size="text" className="h-6 px-2 text-[12px] font-medium" onClick={toggleArchive}>
              Done
            </Button>
          }
        >
          {section.label}
        </SectionHeading>
      )
    return (
      <SectionHeading first={first} count={section.count}>
        {section.label}
      </SectionHeading>
    )
  }

  const empty = (section: Section) => {
    if (section.rows.length) return null
    if (section.key === 'folders') return <p className="px-2.5 py-1 text-footnote text-label-secondary">Make a folder, then drag sessions into it.</p>
    if (section.key === 'results')
      return (
        <EmptyState icon={<SearchX size={32} strokeWidth={1.25} />} title="No Results">
          No sessions match “{search.trim()}”.
        </EmptyState>
      )
    if (section.key === 'archive')
      return (
        <EmptyState icon={<Archive size={32} strokeWidth={1.25} />} title="No Archived Sessions">
          Archived sessions rest here. Their transcripts are never deleted.
        </EmptyState>
      )
    return null
  }

  const layout = tree.rows.length <= LAYOUT_LIMIT

  return (
    <aside ref={root} aria-label="Sidebar" className="glass flex h-full shrink-0 flex-col rounded-[var(--radius-panel)]" style={{ width }}>
      <div className="relative z-[2] flex min-h-0 flex-1 flex-col">
        {/* Inset by the frame top and bottom, so these centre on the title bar line. */}
        <div className="drag flex h-[calc(var(--titlebar-h)-2*var(--frame))] shrink-0 items-center gap-0.5 px-1.5">
          <AppMenu />
          <div className="flex-1" />
          <Tooltip label="New Session" shortcut="Ctrl+N">
            <Button aria-label="New session" disabled>
              <SquarePen size={16} strokeWidth={1.75} />
            </Button>
          </Tooltip>
        </div>

        <SearchField
          onLeave={() => {
            const first = order[0]
            setCursor(first)
            focusRow(first)
          }}
        />

        <div
          className={cn('flex min-h-0 flex-1 flex-col', viaKeyboard && 'tree-instant')}
          onKeyDown={onKey}
          onFocus={onFocus}
          onPointerDownCapture={() => viaKeyboard && setViaKeyboard(false)}
        >
          <MotionConfig transition={viaKeyboard ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.25 }} reducedMotion="user">
            <ContextMenuRoot onOpenChange={(open) => !open && setMenu(null)}>
              <ContextMenuTrigger onContextMenu={onContextMenu} className="flex min-h-0 flex-1 flex-col">
                <nav aria-label="Sessions" className="flex flex-1 flex-col overflow-y-auto px-2 pb-2">
                  {tree.sections.map((section, i) => (
                    <div key={section.key} className={cn('flex flex-col', section.key !== 'folders' && section.rows.length === 0 && 'flex-1')}>
                      {heading(section, i === 0)}
                      {empty(section) ?? (
                        <RowMotion.Provider value={{ instant: viaKeyboard || !settled, layout: settled && layout && (section.key === 'library' || section.key === 'folders') }}>
                          <ul role="tree" aria-label={section.label} aria-multiselectable className="relative flex flex-col">
                            <AnimatePresence initial={false}>{renderNodes(nest(section.rows))}</AnimatePresence>
                          </ul>
                        </RowMotion.Provider>
                      )}
                    </div>
                  ))}
                </nav>
              </ContextMenuTrigger>
              {menuFolder && <FolderMenu folder={menuFolder} onRules={() => setRulesFor(menuFolder.id)} />}
              {menu?.kind === 'sessions' && <SessionMenu ids={menu.ids} />}
            </ContextMenuRoot>

            <div className="border-t border-separator px-2 pt-1.5 pb-2">
              <ul role="tree" aria-label="Archive">
                <ArchiveRow open={archive} tabbable={tabKey === ARCHIVE} onToggle={toggleArchive} />
              </ul>
            </div>
          </MotionConfig>
        </div>
      </div>
      <FilingRules folderId={rulesFor} onClose={() => setRulesFor(null)} />
    </aside>
  )
}

/** The search field: filters every folder's sessions by title, prompts and project as you type. */
function SearchField({ onLeave }: { onLeave(): void }) {
  const search = useUi((s) => s.search)
  const setSearch = useUi((s) => s.setSearch)
  return (
    <div className="px-2.5 pt-1 pb-2">
      <label className="flex h-7 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--search-fill)] pr-0.5 pl-2.5 text-label-secondary focus-within:bg-[var(--field)] focus-within:outline-2 focus-within:outline-[var(--accent-ring)]">
        <Search size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
        <input
          type="search"
          data-search
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && search) {
              e.stopPropagation()
              setSearch('')
            } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
              e.preventDefault()
              onLeave()
            }
          }}
          placeholder="Search"
          aria-label="Search sessions"
          spellCheck={false}
          className="no-drag w-full min-w-0 bg-transparent text-[13px] text-label outline-none select-text placeholder:text-label-secondary [&::-webkit-search-cancel-button]:hidden"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setSearch('')}
            className="no-drag flex size-6 shrink-0 items-center justify-center rounded-[6px] text-label-secondary outline-none hover:bg-fill-strong hover:text-label focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          >
            <X size={13} strokeWidth={2} />
          </button>
        )}
      </label>
    </div>
  )
}
