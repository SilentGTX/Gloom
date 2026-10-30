import { Archive, Clock3, FolderPlus, Inbox, MessagesSquare, PanelLeftClose, Pin, Search, type LucideIcon } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { runCommand } from '../../lib/commands'
import { cn } from '../../lib/cn'
import { useUi, type SmartFolder } from '../../stores/ui'
import { AppMenu } from '../shell/AppMenu'

export const SMART_FOLDERS: Record<SmartFolder, { label: string; icon: LucideIcon }> = {
  all: { label: 'All Sessions', icon: MessagesSquare },
  recent: { label: 'Recent', icon: Clock3 },
  pinned: { label: 'Pinned', icon: Pin },
  unfiled: { label: 'Unfiled', icon: Inbox },
  archived: { label: 'Archived', icon: Archive }
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
 * The folder tree: Liquid Glass over the dusk. Phase 1 has the smart folders;
 * your own folders arrive with the library.
 */
export function FolderColumn({ width, inSheet, className }: { width: number; inSheet?: boolean; className?: string }) {
  const selected = useUi((s) => s.selected)
  const select = useUi((s) => s.select)
  const closeOverlay = useUi((s) => s.closeOverlay)
  const pick = (folder: SmartFolder) => {
    select(folder)
    if (inSheet) closeOverlay(false)
  }

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

        <div className="px-2.5 pt-2 pb-2.5">
          <label className="flex h-8 items-center gap-2 rounded-full bg-fill px-3 text-label-tertiary">
            <Search size={14} strokeWidth={1.75} aria-hidden />
            <input
              disabled
              placeholder="Search"
              aria-label="Search sessions"
              className="w-full min-w-0 bg-transparent text-[13px] text-label outline-none placeholder:text-label-tertiary disabled:cursor-default"
            />
          </label>
        </div>

        <nav className="flex-1 overflow-y-auto px-2" aria-label="Smart folders">
          <ul className="flex flex-col gap-px">
            {(['all', 'recent', 'pinned', 'unfiled'] as const).map((id) => (
              <li key={id}>
                <SidebarRow folder={id} selected={selected === id} onSelect={() => pick(id)} />
              </li>
            ))}
          </ul>
          <div className="mt-5 flex h-7 items-center justify-between pr-1 pl-2.5">
            <span className="text-[12px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">Folders</span>
            <Tooltip label="New Folder" shortcut="Ctrl+Shift+N">
              <Button aria-label="New folder" size="small" disabled>
                <FolderPlus size={15} strokeWidth={1.75} />
              </Button>
            </Tooltip>
          </div>
          <p className="px-2.5 py-1 text-footnote text-label-secondary">No folders yet</p>
        </nav>

        <div className="px-2 pt-1 pb-2.5">
          <SidebarRow folder="archived" selected={selected === 'archived'} onSelect={() => pick('archived')} />
        </div>
      </div>
    </aside>
  )
}

function SidebarRow({ folder, selected, onSelect }: { folder: SmartFolder; selected: boolean; onSelect(): void }) {
  const { label, icon: Icon } = SMART_FOLDERS[folder]
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'no-drag flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-row)] px-2.5 text-left outline-none',
        'transition-[background-color] duration-[var(--duration-press)] ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--accent-ring)]',
        selected ? 'font-medium text-[var(--selection-label)] shadow-[0_1px_2px_rgb(0_0_0/0.06)] [background:var(--selection)]' : 'text-label hover:bg-fill active:bg-fill-pressed'
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden className="text-accent-text" />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}
