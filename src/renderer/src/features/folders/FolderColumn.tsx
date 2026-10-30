import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { MotionConfig } from 'motion/react'
import {
  Archive,
  Clock3,
  Folder as FolderGlyph,
  FolderInput,
  FolderPlus,
  FolderTree,
  Inbox,
  MessagesSquare,
  PanelLeftClose,
  Pencil,
  Pin,
  Search,
  Trash2,
  X,
  type LucideIcon
} from 'lucide-react'
import { childrenOf, flattenTree, folderPath, subtreeIds, type Folder, type Place, type SmartFolder } from '@shared/library'
import { Button } from '../../components/ui/Button'
import { ContextMenuPopup, ContextMenuRoot, ContextMenuTrigger, MenuItem, MenuSeparator, MenuSubmenu } from '../../components/ui/Menu'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { runCommand } from '../../lib/commands'
import { useNow } from '../../lib/now'
import { applyWithUndo, useLibrary } from '../../stores/library'
import { samePlace, useUi } from '../../stores/ui'
import { useDrag, type DropData } from '../library/drag'
import { countSessions } from '../sessions/derive'
import { AppMenu } from '../shell/AppMenu'
import { FilingRules } from './FilingRules'
import { FolderRow, SidebarHeading, SmartRow } from './FolderRows'

export const SMART_FOLDERS: Record<SmartFolder, { label: string; icon: LucideIcon }> = {
  all: { label: 'All Sessions', icon: MessagesSquare },
  recent: { label: 'Recent', icon: Clock3 },
  pinned: { label: 'Pinned', icon: Pin },
  unfiled: { label: 'Unfiled', icon: Inbox },
  archived: { label: 'Archived', icon: Archive }
}

const TOP_SMART: SmartFolder[] = ['all', 'recent', 'pinned', 'unfiled']
const DROPS: Partial<Record<SmartFolder, 'unfiled' | 'pinned' | 'archived'>> = { unfiled: 'unfiled', pinned: 'pinned', archived: 'archived' }

const navKeyOf = (place: Place) => ('smart' in place ? `smart:${place.smart}` : `folder:${place.folder}`)
const placeOf = (key: string): Place => (key.startsWith('folder:') ? { folder: key.slice(7) } : { smart: key.slice(6) as SmartFolder })

function focusNav(key: string) {
  document.querySelector<HTMLElement>(`[data-nav="${CSS.escape(key)}"]`)?.focus({ preventScroll: false })
}

/** Creates a folder, shows it, and starts naming it. */
export async function newFolder(parentId: string | null): Promise<void> {
  const result = await useLibrary.getState().apply({ type: 'createFolder', parentId })
  if (!result?.folderId) return
  useUi.getState().go({ folder: result.folderId })
  useUi.getState().rename({ kind: 'folder', id: result.folderId })
}

/** Deletes a folder and everything below it; its sessions go to Unfiled. A toast offers Undo. */
export async function deleteFolder(folder: Folder): Promise<void> {
  const { library } = useLibrary.getState()
  const ids = subtreeIds(library.folders, folder.id)
  const sessions = Object.values(library.sessions).filter((e) => e.folderId && ids.has(e.folderId)).length
  const moved = sessions === 1 ? ' · 1 session moved to Unfiled' : sessions ? ` · ${sessions} sessions moved to Unfiled` : ''
  await applyWithUndo({ type: 'deleteFolder', id: folder.id }, `Deleted “${folder.name}”${moved}`)
}

/**
 * The sidebar as one floating object: Gloom's dusk sky inside it, the glass
 * over the sky. The same panel sits inline and slides in as the narrow-window
 * sheet, so it looks the same wherever it appears.
 */
export function FolderPanel({ width, inSheet }: { width: number; inSheet?: boolean }) {
  return (
    <div className="relative h-full shrink-0" style={{ width }}>
      <div className="sky rounded-[var(--radius-panel)]" aria-hidden />
      <FolderColumn width={width} inSheet={inSheet} />
    </div>
  )
}

/**
 * The folder tree, in Liquid Glass over the dusk: smart folders, then yours,
 * nested as deep as you like, then Archived. Selection follows the keyboard
 * focus, as in a Finder sidebar.
 */
export function FolderColumn({ width, inSheet, className }: { width: number; inSheet?: boolean; className?: string }) {
  const place = useUi((s) => s.place)
  const go = useUi((s) => s.go)
  const renaming = useUi((s) => s.renaming)
  const includeSubfolders = useUi((s) => s.includeSubfolders)
  const closeOverlay = useUi((s) => s.closeOverlay)
  const library = useLibrary((s) => s.library)
  const sessions = useLibrary((s) => s.sessions)
  const apply = useLibrary((s) => s.apply)
  const now = useNow(60_000)
  const counts = useMemo(() => countSessions(library, sessions, includeSubfolders, now), [library, sessions, includeSubfolders, now])
  const rows = useMemo(() => flattenTree(library.folders), [library.folders])
  const byId = useMemo(() => new Map(rows.map((r) => [r.folder.id, r])), [rows])
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [rulesFor, setRulesFor] = useState<string | null>(null)
  // Rows spring to their new places after a drop or a click, but not after a key.
  const [viaKeyboard, setViaKeyboard] = useState(false)
  const typed = useRef({ text: '', at: 0 })

  const order = useMemo(() => [...TOP_SMART.map((s) => `smart:${s}`), ...rows.map((r) => `folder:${r.folder.id}`), 'smart:archived'], [rows])
  const selectedKey = navKeyOf(place)
  // The selected row is the sidebar's one tab stop; if it's gone, the first row is.
  const tabKey = order.includes(selectedKey) ? selectedKey : order[0]

  // Rows select on press; a click (the press let go) sends away the sheet they sit in.
  const choose = () => inSheet && closeOverlay(false)
  const moveTo = (index: number) => {
    const key = order[Math.max(0, Math.min(order.length - 1, index))]
    go(placeOf(key))
    focusNav(key)
  }
  const toggle = (id: string, all: boolean) => {
    const folder = byId.get(id)?.folder
    if (!folder) return
    const below = subtreeIds(library.folders, id)
    // Closing over the selected folder selects the one you closed, as Finder does.
    if (folder.expanded && 'folder' in place && place.folder !== id && below.has(place.folder)) go({ folder: id })
    void apply({ type: 'setExpanded', ids: all ? [...below] : [id], expanded: !folder.expanded })
  }
  const renameEnd = (id: string, name: string | null) => {
    useUi.getState().rename(null)
    if (name !== null) void apply({ type: 'renameFolder', id, name })
    requestAnimationFrame(() => focusNav(`folder:${id}`))
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT') return
    if (!viaKeyboard) setViaKeyboard(true)
    const key = target.closest<HTMLElement>('[data-nav]')?.dataset.nav
    if (!key) return
    const i = order.indexOf(key)
    const row = key.startsWith('folder:') ? byId.get(key.slice(7)) : undefined
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    switch (e.key) {
      case 'ArrowDown':
        handled()
        return moveTo(i + 1)
      case 'ArrowUp':
        handled()
        return moveTo(i - 1)
      case 'Home':
        handled()
        return moveTo(0)
      case 'End':
        handled()
        return moveTo(order.length - 1)
      case 'ArrowRight':
        handled()
        if (row?.hasChildren) {
          if (!row.folder.expanded) toggle(row.folder.id, false)
          else moveTo(i + 1)
        }
        return
      case 'ArrowLeft':
        handled()
        if (row?.hasChildren && row.folder.expanded) toggle(row.folder.id, false)
        else if (row?.folder.parentId) moveTo(order.indexOf(`folder:${row.folder.parentId}`))
        return
      case 'F2':
        handled()
        if (row) useUi.getState().rename({ kind: 'folder', id: row.folder.id })
        return
      case 'Delete':
        handled()
        if (row) void deleteFolder(row.folder)
        return
      case 'Enter':
        // On to the session list.
        handled()
        document.querySelector<HTMLElement>('[data-session-list]')?.focus()
        return
    }
    // Numpad * opens everything below, as in Explorer's tree.
    if (e.code === 'NumpadMultiply' && row) {
      handled()
      void apply({ type: 'setExpanded', ids: [...subtreeIds(library.folders, row.folder.id)], expanded: true })
      return
    }
    // Type to find: the next row whose name starts with what you typed.
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey && e.key !== ' ') {
      handled()
      const t = typed.current
      t.text = e.timeStamp - t.at > 700 ? e.key : t.text + e.key
      t.at = e.timeStamp
      const want = t.text.toLowerCase()
      const labels = order.map((k) => document.querySelector<HTMLElement>(`[data-nav="${CSS.escape(k)}"]`)?.dataset.label?.toLowerCase() ?? '')
      const start = t.text.length > 1 ? i : i + 1
      for (let n = 0; n < order.length; n++) {
        const j = (start + n) % order.length
        if (labels[j].startsWith(want)) return moveTo(j)
      }
    }
  }

  // One context menu for the whole tree, aimed at the row that was right-clicked.
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-folder-id]')?.dataset.folderId
    if (id) setMenuFor(id)
    else (e as unknown as { preventBaseUIHandler(): void }).preventBaseUIHandler()
  }
  const menuFolder = menuFor ? byId.get(menuFor)?.folder : undefined

  const dragKind = useDrag((s) => s.active?.kind)
  const { setNodeRef: rootDropRef } = useDroppable({ id: 'drop:root', data: { kind: 'root' } satisfies DropData, disabled: dragKind !== 'folder' })
  const rootDropping = useDrag((s) => s.target?.id === 'drop:root')

  return (
    <aside aria-label="Folders" className={cn('glass flex h-full shrink-0 flex-col rounded-[var(--radius-panel)]', className)} style={{ width }}>
      <div className="relative z-[2] flex min-h-0 flex-1 flex-col">
        {/* Inset by the frame top and bottom, so these centre on the title bar line. */}
        <div className="drag flex h-[calc(var(--titlebar-h)-2*var(--frame))] shrink-0 items-center gap-0.5 px-1.5">
          <AppMenu />
          <div className="flex-1" />
          <Tooltip label="Hide Folders" shortcut="Ctrl+B">
            <Button aria-label="Hide folders" onClick={() => runCommand('view.toggleFolders')}>
              <PanelLeftClose size={16} strokeWidth={1.75} />
            </Button>
          </Tooltip>
        </div>

        <SearchField />

        <div
          className={cn('flex min-h-0 flex-1 flex-col', viaKeyboard && 'tree-instant')}
          onKeyDown={onKey}
          onPointerDownCapture={() => viaKeyboard && setViaKeyboard(false)}
        >
          <MotionConfig transition={viaKeyboard ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.25 }} reducedMotion="user">
            <nav className="flex-1 overflow-y-auto px-2 pb-2" aria-label="Library">
              <ul role="tree" aria-label="Smart Folders" className="flex flex-col gap-px">
                {TOP_SMART.map((s) => (
                  <SmartRow
                    key={s}
                    navKey={`smart:${s}`}
                    label={SMART_FOLDERS[s].label}
                    icon={SMART_FOLDERS[s].icon}
                    count={counts.smart[s]}
                    selected={samePlace(place, { smart: s })}
                    tabbable={tabKey === `smart:${s}`}
                    accepts={DROPS[s]}
                    onSelect={() => go({ smart: s })}
                    onChoose={choose}
                  />
                ))}
              </ul>

              <SidebarHeading
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
                Folders
              </SidebarHeading>

              {rows.length === 0 ? (
                <p className="px-2.5 py-1 text-footnote text-label-secondary">Make a folder, then drag sessions into it.</p>
              ) : (
                <ContextMenuRoot onOpenChange={(open) => !open && setMenuFor(null)}>
                  <ContextMenuTrigger onContextMenu={onContextMenu}>
                    <ul role="tree" aria-label="Your Folders" className="flex flex-col gap-px">
                      {rows.map((row) => (
                        <FolderRow
                          key={row.folder.id}
                          row={row}
                          count={counts.folders[row.folder.id] ?? 0}
                          selected={samePlace(place, { folder: row.folder.id })}
                          tabbable={tabKey === `folder:${row.folder.id}`}
                          renaming={renaming?.kind === 'folder' && renaming.id === row.folder.id}
                          menuOpen={menuFor === row.folder.id}
                          onSelect={() => go({ folder: row.folder.id })}
                          onChoose={choose}
                          onToggle={(all) => toggle(row.folder.id, all)}
                          onRename={() => useUi.getState().rename({ kind: 'folder', id: row.folder.id })}
                          onRenameEnd={(name) => renameEnd(row.folder.id, name)}
                        />
                      ))}
                    </ul>
                  </ContextMenuTrigger>
                  {menuFolder && <FolderMenu folder={menuFolder} onRules={() => setRulesFor(menuFolder.id)} />}
                </ContextMenuRoot>
              )}
            </nav>

            <div className="px-2 pt-1 pb-2.5">
              <ul role="tree" aria-label="Archive">
                <SmartRow
                  navKey="smart:archived"
                  label={SMART_FOLDERS.archived.label}
                  icon={SMART_FOLDERS.archived.icon}
                  count={counts.smart.archived}
                  selected={samePlace(place, { smart: 'archived' })}
                  tabbable={tabKey === 'smart:archived'}
                  accepts="archived"
                  onSelect={() => go({ smart: 'archived' })}
                  onChoose={choose}
                />
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
function SearchField() {
  const search = useUi((s) => s.search)
  const setSearch = useUi((s) => s.setSearch)
  return (
    <div className="px-2.5 pt-2 pb-2.5">
      <label className="flex h-8 items-center gap-2 rounded-full bg-fill pr-1 pl-3 text-label-secondary focus-within:bg-[var(--field)] focus-within:outline-2 focus-within:outline-[var(--accent-ring)]">
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
              document.querySelector<HTMLElement>('[data-session-list]')?.focus()
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
            className="no-drag flex size-6 shrink-0 items-center justify-center rounded-full text-label-secondary outline-none hover:bg-fill-strong hover:text-label focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          >
            <X size={13} strokeWidth={2} />
          </button>
        )}
      </label>
    </div>
  )
}

/** A folder's context menu: the few things you'd do to it, Delete last. */
function FolderMenu({ folder, onRules }: { folder: Folder; onRules(): void }) {
  const apply = useLibrary((s) => s.apply)
  const folders = useLibrary((s) => s.library.folders)
  return (
    <ContextMenuPopup label={`${folder.name} actions`}>
      <MenuItem label="Rename" icon={<Pencil />} onClick={() => useUi.getState().rename({ kind: 'folder', id: folder.id })} />
      <MenuItem label="New Folder Inside" icon={<FolderPlus />} onClick={() => void newFolder(folder.id)} />
      <MenuItem label="Filing Rules…" icon={<FolderTree />} onClick={onRules} />
      <MenuSeparator />
      <MenuSubmenu label="Move To" icon={<FolderInput />}>
        <MoveTargets
          folders={folders}
          exclude={subtreeIds(folders, folder.id)}
          current={folder.parentId}
          topLevel="Top Level"
          onPick={(parentId) => void apply({ type: 'moveFolder', id: folder.id, parentId, index: childrenOf(folders, parentId).length })}
        />
      </MenuSubmenu>
      <MenuSeparator />
      <MenuItem label="Delete Folder" icon={<Trash2 />} destructive onClick={() => void deleteFolder(folder)} />
    </ContextMenuPopup>
  )
}

/**
 * Destinations for Move To: a top level (Unfiled, for sessions) and every
 * folder, indented by depth, in one submenu rather than one per level.
 */
export function MoveTargets({
  folders,
  exclude,
  current,
  topLevel,
  onPick
}: {
  folders: Folder[]
  exclude?: Set<string>
  /** Where it is now: listed, but unavailable. */
  current: string | null | undefined
  topLevel: string
  onPick(folderId: string | null): void
}) {
  const rows = flattenTree(folders, { all: true }).filter((r) => !exclude?.has(r.folder.id))
  return (
    <>
      <MenuItem label={topLevel} disabled={current === null} onClick={() => onPick(null)} />
      {rows.length > 0 && <MenuSeparator />}
      {rows.map((r) => (
        <MenuItem
          key={r.folder.id}
          label={r.folder.name}
          icon={<FolderGlyph />}
          indent={r.depth}
          disabled={current === r.folder.id}
          onClick={() => onPick(r.folder.id)}
        />
      ))}
    </>
  )
}

/** "Work › Clients", for showing where a session lives. */
export function folderLabel(folders: Folder[], id: string): string {
  return folderPath(folders, id)
    .map((f) => f.name)
    .join(' › ')
}
