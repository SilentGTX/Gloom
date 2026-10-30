import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { ArrowUpDown, MessagesSquare, SearchX } from 'lucide-react'
import { ELSEWHERE_MS, type Place } from '@shared/library'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { GlassCapsule } from '../../components/ui/Glass'
import { ContextMenuRoot, ContextMenuTrigger, MenuCheckItem, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useNow } from '../../lib/now'
import { useLibrary } from '../../stores/library'
import { useUi, type SortOrder } from '../../stores/ui'
import { SMART_FOLDERS } from '../folders/FolderColumn'
import { BarTitle, LeadingControls, NewSessionButton, PaneToolbar, type LeadingControl } from '../shell/Toolbar'
import { listSessions, type SessionItem } from './derive'
import { archiveSessions, SessionMenu } from './SessionMenu'
import { SessionRow } from './SessionRow'

type Entry = { kind: 'header'; key: string; label: string } | { kind: 'session'; key: string; item: SessionItem }

const SORTS: { value: SortOrder; label: string }[] = [
  { value: 'activity', label: 'Last Activity' },
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Date Created' }
]

const EMPTY: Record<string, { title: string; text: string }> = {
  all: { title: 'No Sessions Yet', text: 'Sessions you start in Claude Code show up here.' },
  recent: { title: 'Nothing Recent', text: 'Sessions active in the last week show up here.' },
  pinned: { title: 'No Pinned Sessions', text: 'Pin a session to keep it at the top.' },
  unfiled: { title: 'Everything’s Filed', text: 'Every session is in one of your folders.' },
  archived: { title: 'No Archived Sessions', text: 'Archived sessions rest here. Their transcripts are never deleted.' },
  folder: { title: 'No Sessions', text: 'Drag sessions here, or give the folder filing rules.' }
}

function placeTitle(place: Place, folderName: string | undefined, searching: boolean): string {
  if (searching) return 'Results'
  return 'smart' in place ? SMART_FOLDERS[place.smart].label : (folderName ?? 'Folder')
}

/**
 * The selected folder's sessions, on the paper, with a toolbar floating over
 * the top: the folder's name leading, view options and New Session trailing.
 */
export function SessionColumn({ width, leading = [], className }: { width: number; leading?: LeadingControl[]; className?: string }) {
  const place = useUi((s) => s.place)
  const search = useUi((s) => s.search)
  const sort = useUi((s) => s.sort)
  const includeSubfolders = useUi((s) => s.includeSubfolders)
  const selection = useUi((s) => s.selection)
  const library = useLibrary((s) => s.library)
  const sessions = useLibrary((s) => s.sessions)
  const indexed = useLibrary((s) => s.indexed)
  const now = useNow(15_000)
  const folderName = 'folder' in place ? library.folders.find((f) => f.id === place.folder)?.name : undefined

  const items = useMemo(
    () => listSessions(library, sessions, place, { search, sort, includeSubfolders, now }),
    [library, sessions, place, search, sort, includeSubfolders, now]
  )
  // Pinned sessions lead, under their own heading, unless everything here is pinned.
  const entries = useMemo<Entry[]>(() => {
    const pinned = items.filter((i) => i.entry?.pinned).length
    const rows: Entry[] = items.map((item) => ({ kind: 'session', key: item.id, item }))
    if (!pinned || pinned === items.length) return rows
    return [{ kind: 'header', key: 'h:pinned', label: 'Pinned' }, ...rows.slice(0, pinned), { kind: 'header', key: 'h:rest', label: 'Sessions' }, ...rows.slice(pinned)]
  }, [items])

  const empty = !search && indexed && items.length === 0
  const kind = 'smart' in place ? place.smart : 'folder'

  return (
    <section aria-label="Sessions" className={cn('relative flex h-full shrink-0 flex-col pt-[var(--titlebar-h)]', className)} style={{ width }}>
      <PaneToolbar>
        <LeadingControls controls={leading} />
        <BarTitle>{placeTitle(place, folderName, !!search)}</BarTitle>
        <div className="flex-1" />
        <ViewOptions />
        <NewSessionButton />
      </PaneToolbar>
      {!indexed ? (
        // Nothing yet, rather than an empty state that flashes at launch.
        <div className="flex-1" />
      ) : empty ? (
        <EmptyState icon={<MessagesSquare size={36} strokeWidth={1.25} />} title={EMPTY[kind].title}>
          {EMPTY[kind].text}
        </EmptyState>
      ) : search && items.length === 0 ? (
        <EmptyState icon={<SearchX size={36} strokeWidth={1.25} />} title="No Results">
          No sessions match “{search}”.
        </EmptyState>
      ) : (
        <SessionList entries={entries} items={items} selection={selection} place={place} now={now} />
      )}
    </section>
  )
}

function SessionList({ entries, items, selection, place, now }: { entries: Entry[]; items: SessionItem[]; selection: string[]; place: Place; now: number }) {
  const select = useUi((s) => s.select)
  const anchor = useUi((s) => s.anchor)
  const renaming = useUi((s) => s.renaming)
  const folders = useLibrary((s) => s.library.folders)
  const apply = useLibrary((s) => s.apply)
  const virtuoso = useRef<VirtuosoHandle>(null)
  const list = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<string | null>(selection.at(-1) ?? null)
  const [menu, setMenu] = useState<{ ids: string[]; ring: string | null } | null>(null)
  const [scrolled, setScrolled] = useState(false)
  // A press on a row that's already selected may be the start of dragging the whole selection.
  const narrowOnClick = useRef<string | null>(null)
  const selected = useMemo(() => new Set(selection), [selection])
  const order = useMemo(() => items.map((i) => i.id), [items])
  const selectedInOrder = useMemo(() => order.filter((id) => selected.has(id)), [order, selected])
  const entryIndex = useMemo(() => new Map(entries.map((e, i) => [e.key, i])), [entries])

  // A selection that has left the list (filed elsewhere, archived) is let go.
  useEffect(() => {
    const kept = selection.filter((id) => order.includes(id))
    if (kept.length !== selection.length) select(kept)
  }, [order, selection, select])

  const reveal = (id: string) => {
    const index = entryIndex.get(id)
    if (index !== undefined) virtuoso.current?.scrollIntoView({ index, behavior: 'auto' })
  }
  const range = (from: string, to: string) => {
    const a = order.indexOf(from)
    const b = order.indexOf(to)
    if (a < 0 || b < 0) return [to]
    return order.slice(Math.min(a, b), Math.max(a, b) + 1)
  }

  // Selection follows the press, as in Finder and Mail. Pressing a row that's
  // already selected keeps the selection, so it can be dragged; a plain click
  // without a drag then narrows it to that row.
  const press = (id: string, e: PointerEvent) => {
    if (e.button !== 0) return
    list.current?.focus({ preventScroll: true })
    setCursor(id)
    narrowOnClick.current = null
    if (e.shiftKey && anchor) select(range(anchor, id), anchor)
    else if (e.ctrlKey || e.metaKey) select(selected.has(id) ? selection.filter((s) => s !== id) : [...selection, id], id)
    else if (!selected.has(id)) select([id], id)
    else narrowOnClick.current = id
  }
  const click = (id: string, e: MouseEvent) => {
    if (narrowOnClick.current === id && !e.shiftKey && !e.ctrlKey && !e.metaKey) select([id], id)
    narrowOnClick.current = null
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    const at = cursor ? order.indexOf(cursor) : -1
    const go = (index: number) => {
      const id = order[Math.max(0, Math.min(order.length - 1, index))]
      if (!id) return
      e.preventDefault()
      setCursor(id)
      if (e.shiftKey) select(range(anchor ?? id, id), anchor ?? id)
      else select([id], id)
      reveal(id)
    }
    switch (e.key) {
      case 'ArrowDown':
        return go(at < 0 ? 0 : at + 1)
      case 'ArrowUp':
        return go(at < 0 ? 0 : at - 1)
      case 'Home':
        return go(0)
      case 'End':
        return go(order.length - 1)
      case 'PageDown':
        return go(at + 10)
      case 'PageUp':
        return go(at - 10)
      case 'ArrowLeft':
        // Back to the sidebar.
        e.preventDefault()
        document.querySelector<HTMLElement>('aside[aria-label="Folders"] [role="treeitem"][tabindex="0"]')?.focus()
        return
      case 'F2':
        e.preventDefault()
        if (selection.length === 1) useUi.getState().rename({ kind: 'session', id: selection[0] })
        return
      case 'Delete':
        e.preventDefault()
        if (!('smart' in place && place.smart === 'archived')) archiveSessions(selectedInOrder)
        return
    }
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      select(order, order[0] ?? null)
    }
  }

  // Right-click a selected row and the menu acts on the whole selection;
  // right-click any other row and it acts on that one, ringed, selection untouched.
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-session-id]')?.dataset.sessionId
    if (id) {
      setMenu(selected.has(id) ? { ids: selectedInOrder, ring: null } : { ids: [id], ring: id })
      return
    }
    ;(e as unknown as { preventBaseUIHandler(): void }).preventBaseUIHandler()
    // The Menu key or Shift+F10 aims at the list itself: open the menu at the row
    // you're on instead, as if it had been right-clicked there.
    const row = e.target === list.current && cursor && selected.has(cursor) ? document.getElementById(`session-${cursor}`) : null
    if (!row) return
    e.preventDefault()
    const box = row.getBoundingClientRect()
    row.dispatchEvent(new globalThis.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: box.left + 32, clientY: box.top + box.height / 2 }))
  }

  const renameEnd = (id: string, title: string | null) => {
    useUi.getState().rename(null)
    if (title !== null) {
      const claude = useLibrary.getState().sessions[id]?.title
      void apply({ type: 'renameSession', id, title: title.trim() === claude ? null : title })
    }
    requestAnimationFrame(() => list.current?.focus({ preventScroll: true }))
  }

  return (
    <ContextMenuRoot onOpenChange={(open) => !open && setMenu(null)}>
      <ContextMenuTrigger onContextMenu={onContextMenu} className="flex min-h-0 flex-1 flex-col">
        <div
          ref={list}
          role="listbox"
          aria-label="Sessions"
          aria-multiselectable
          aria-activedescendant={cursor && order.includes(cursor) ? `session-${cursor}` : undefined}
          tabIndex={0}
          data-session-list
          onKeyDown={onKey}
          onFocus={() => {
            if (!cursor && order[0] && selection.length === 0) setCursor(order[0])
          }}
          className="group/list min-h-0 flex-1 outline-none"
        >
          <Virtuoso
            ref={virtuoso}
            data={entries}
            computeItemKey={(_, entry) => entry.key}
            increaseViewportBy={240}
            atTopStateChange={(atTop) => setScrolled(!atTop)}
            className={cn('h-full', scrolled && 'scroll-edge')}
            itemContent={(_, entry) =>
              entry.kind === 'header' ? (
                <div className="px-5 pt-3 pb-1 text-[12px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">{entry.label}</div>
              ) : (
                <SessionRow
                  item={entry.item}
                  selected={selected.has(entry.key)}
                  selection={selected.has(entry.key) ? selectedInOrder : undefined}
                  ringed={menu?.ring === entry.key}
                  renaming={renaming?.kind === 'session' && renaming.id === entry.key}
                  showFolder={!('folder' in place && entry.item.entry?.folderId === place.folder)}
                  folders={folders}
                  elsewhere={now - entry.item.meta.updated < ELSEWHERE_MS}
                  now={now}
                  onPress={(e) => press(entry.key, e)}
                  onClick={(e) => click(entry.key, e)}
                  onRenameEnd={(title) => renameEnd(entry.key, title)}
                />
              )
            }
            components={{ Footer: () => <div className="h-3" /> }}
          />
        </div>
      </ContextMenuTrigger>
      {menu && <SessionMenu ids={menu.ids} place={place} />}
    </ContextMenuRoot>
  )
}

/** Sorting, and whether a folder shows its subfolders' sessions too. */
function ViewOptions() {
  const sort = useUi((s) => s.sort)
  const setSort = useUi((s) => s.setSort)
  const includeSubfolders = useUi((s) => s.includeSubfolders)
  const toggleSubfolders = useUi((s) => s.toggleSubfolders)
  return (
    <GlassCapsule>
      <MenuRoot>
        <Tooltip label="View Options">
          <MenuTrigger
            render={
              <Button aria-label="View options" shape="round">
                <ArrowUpDown size={16} strokeWidth={1.75} />
              </Button>
            }
          />
        </Tooltip>
        <MenuPopup align="end">
          <MenuGroup>
            <MenuGroupLabel>Sort By</MenuGroupLabel>
            <MenuRadioGroup value={sort} onChange={setSort}>
              {SORTS.map((s) => (
                <MenuRadioItem key={s.value} value={s.value} label={s.label} />
              ))}
            </MenuRadioGroup>
          </MenuGroup>
          <MenuSeparator />
          <MenuCheckItem label="Include Subfolders" checked={includeSubfolders} onClick={toggleSubfolders} />
        </MenuPopup>
      </MenuRoot>
    </GlassCapsule>
  )
}
