import type { SessionMeta } from '@shared/library'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { TerminalPane } from '../terminal/TerminalPane'

/**
 * The concept's Terminal view: the session's shells on a card in the chat's
 * place, inset from its edges, in the code colour. Ctrl+` comes back to the
 * conversation.
 */
export function TerminalView({ session }: { session: SessionMeta }) {
  return (
    <div className="absolute inset-x-0 top-[var(--titlebar-h)] bottom-0 flex flex-col bg-[var(--surface)] px-6 pt-1 pb-6">
      <div className="concept-terminal relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <ErrorBoundary part="Terminal" resetKey={session.id}>
          <TerminalPane session={session} embedded />
        </ErrorBoundary>
      </div>
    </div>
  )
}
