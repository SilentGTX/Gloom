import { FileDiff, MessagesSquare, SquareTerminal } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Tooltip } from '../../components/ui/Tooltip'
import { LeadingControls, Toolbar, type LeadingControl } from '../shell/Toolbar'

/** Chat column: solid, the only column without Mica behind it. */
export function ChatColumn({ leading }: { leading: LeadingControl[] }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-[var(--surface-chat)]">
      <Toolbar clearCaptionButtons>
        <LeadingControls controls={leading} />
        <div className="flex-1" />
        <Tooltip label="Diff" shortcut="Ctrl+Shift+D">
          <Button aria-label="Diff pane" disabled>
            <FileDiff size={16} strokeWidth={1.75} />
          </Button>
        </Tooltip>
        <Tooltip label="Terminal" shortcut="Ctrl+`">
          <Button aria-label="Terminal" disabled>
            <SquareTerminal size={16} strokeWidth={1.75} />
          </Button>
        </Tooltip>
      </Toolbar>
      <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title="No Session Selected">
        Choose a session to read it here.
      </EmptyState>
    </main>
  )
}
