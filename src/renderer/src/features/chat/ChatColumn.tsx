import { MessagesSquare } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'
import { ChatControls, LeadingControls, NewSessionButton, PaneToolbar, type LeadingControl } from '../shell/Toolbar'

/**
 * Chat: content, so paper, never glass. Its toolbar floats over the top; when
 * the session list is folded away it also carries the list's controls.
 */
export function ChatColumn({ leading, withNewSession }: { leading: LeadingControl[]; withNewSession: boolean }) {
  return (
    <main className="relative flex min-w-0 flex-1 flex-col pt-[var(--titlebar-h)]">
      <PaneToolbar clearCaptionButtons>
        <LeadingControls controls={leading} />
        {withNewSession && <NewSessionButton />}
        <div className="flex-1" />
        <ChatControls />
      </PaneToolbar>
      <EmptyState icon={<MessagesSquare size={40} strokeWidth={1.25} />} title="No Session Selected">
        Choose a session to read it here.
      </EmptyState>
    </main>
  )
}
