import { EmptyState } from '../../components/ui/EmptyState'
import { cn } from '../../lib/cn'
import { useUi } from '../../stores/ui'
import { SMART_FOLDERS } from '../folders/FolderColumn'
import { BarTitle, LeadingControls, NewSessionButton, PaneToolbar, type LeadingControl } from '../shell/Toolbar'

/**
 * Session list: the selected folder's sessions, on the paper, with its own
 * toolbar floating over the top (title leading, New Session trailing).
 * Empty until the library lands.
 */
export function SessionColumn({ width, leading = [], className }: { width: number; leading?: LeadingControl[]; className?: string }) {
  const selected = useUi((s) => s.selected)
  return (
    <section aria-label="Sessions" className={cn('relative flex h-full shrink-0 flex-col pt-[var(--titlebar-h)]', className)} style={{ width }}>
      <PaneToolbar>
        <LeadingControls controls={leading} />
        <BarTitle>{SMART_FOLDERS[selected].label}</BarTitle>
        <div className="flex-1" />
        <NewSessionButton />
      </PaneToolbar>
      <EmptyState title="No Sessions">Your Claude Code sessions will show up here.</EmptyState>
    </section>
  )
}
