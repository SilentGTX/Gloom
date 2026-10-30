import { SquarePen } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useUi } from '../../stores/ui'
import { SMART_FOLDERS } from '../folders/FolderColumn'
import { LeadingControls, Toolbar, type LeadingControl } from '../shell/Toolbar'

/** Session list column: the selected folder's sessions. Empty until the library lands. */
export function SessionColumn({ width, leading, inSheet }: { width: number; leading: LeadingControl[]; inSheet?: boolean }) {
  const selected = useUi((s) => s.selected)
  return (
    <section aria-label="Sessions" className={cn('flex h-full shrink-0 flex-col', !inSheet && 'bg-[var(--material-sessions)]')} style={{ width }}>
      <Toolbar>
        <LeadingControls controls={leading} />
        <h1 className="min-w-0 flex-1 truncate px-1.5 font-display text-headline font-semibold tracking-[var(--tracking-title)]">
          {SMART_FOLDERS[selected].label}
        </h1>
        <Tooltip label="New Session" shortcut="Ctrl+N">
          <Button aria-label="New session" disabled>
            <SquarePen size={16} strokeWidth={1.75} />
          </Button>
        </Tooltip>
      </Toolbar>
      <EmptyState title="No Sessions">Your Claude Code sessions will show up here.</EmptyState>
    </section>
  )
}
