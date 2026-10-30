import { Archive, Clock3, FolderPlus, Inbox, MessagesSquare, PanelLeftClose, Pin, Search, type LucideIcon } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { runCommand } from '../../lib/commands'
import { cn } from '../../lib/cn'
import { useUi, type SmartFolder } from '../../stores/ui'
import { LeadingControls, Toolbar, type LeadingControl } from '../shell/Toolbar'

export const SMART_FOLDERS: Record<SmartFolder, { label: string; icon: LucideIcon }> = {
  all: { label: 'All Sessions', icon: MessagesSquare },
  recent: { label: 'Recent', icon: Clock3 },
  pinned: { label: 'Pinned', icon: Pin },
  unfiled: { label: 'Unfiled', icon: Inbox },
  archived: { label: 'Archived', icon: Archive }
}

/** Folder tree column. Phase 1 has the smart folders; your own folders arrive with the library. */
export function FolderColumn({ width, leading, inSheet }: { width: number; leading: LeadingControl[]; inSheet?: boolean }) {
  const selected = useUi((s) => s.selected)
  const select = useUi((s) => s.select)
  const closeOverlay = useUi((s) => s.closeOverlay)
  const pick = (folder: SmartFolder) => {
    select(folder)
    if (inSheet) closeOverlay(false)
  }

  return (
    <aside aria-label="Folders" className={cn('flex h-full shrink-0 flex-col', !inSheet && 'bg-[var(--material-folders)]')} style={{ width }}>
      <Toolbar>
        <LeadingControls controls={leading} />
        <div className="flex-1" />
        <Tooltip label="Hide Folders" shortcut="Ctrl+B">
          <Button aria-label="Hide folders" onClick={() => runCommand('view.toggleFolders')}>
            <PanelLeftClose size={16} strokeWidth={1.75} />
          </Button>
        </Tooltip>
      </Toolbar>

      <div className="px-2.5 pb-2">
        <label className="flex h-7 items-center gap-2 rounded-[var(--radius-control)] bg-fill px-2 text-label-tertiary">
          <Search size={14} strokeWidth={1.75} aria-hidden />
          <input
            disabled
            placeholder="Search"
            aria-label="Search sessions"
            className="w-full min-w-0 bg-transparent text-footnote text-label outline-none placeholder:text-label-tertiary disabled:cursor-default"
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
        <div className="mt-4 flex h-7 items-center justify-between pr-0.5 pl-2.5">
          <span className="text-caption font-semibold tracking-[var(--tracking-caption)] text-label-tertiary">Folders</span>
          <Tooltip label="New Folder" shortcut="Ctrl+Shift+N">
            <Button aria-label="New folder" disabled className="size-6">
              <FolderPlus size={15} strokeWidth={1.75} />
            </Button>
          </Tooltip>
        </div>
        <p className="px-2.5 py-1 text-footnote text-label-tertiary">No folders yet</p>
      </nav>

      <div className="px-2 pt-1 pb-2">
        <SidebarRow folder="archived" selected={selected === 'archived'} onSelect={() => pick('archived')} />
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
        'no-drag flex h-7 w-full items-center gap-2.5 rounded-[var(--radius-row)] px-2.5 text-left outline-none',
        'transition-[background-color] duration-[var(--duration-press)] ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--accent-ring)]',
        selected ? 'bg-selection font-medium text-selection-label' : 'text-label hover:bg-fill active:bg-fill-pressed'
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden className={selected ? undefined : 'text-accent-text'} />
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}
