import { formatAccelerator } from '@shared/commands'
import { projectName, type SessionMeta } from '@shared/library'
import { GlassCapsule } from '../../components/ui/Glass'
import { cn } from '../../lib/cn'
import { runCommand } from '../../lib/commands'
import { useUi, type ChatView } from '../../stores/ui'
import { useWorktrees, WorktreeCapsule } from '../chat/Worktree'
import { inspectorFits } from '../shell/layout'
import { PaneToolbar, SidebarStandIns } from '../shell/Toolbar'
import { UpdateButton } from '../update/UpdateButton'
import { InspectorButton } from './Inspector'
import { Spinner, Track, type TrackSegment } from './parts'

/** What the session is doing, as the status pill says it. */
export type Status = { kind: 'waiting' | 'working' | 'idle'; text: string }

const VIEWS: TrackSegment<ChatView>[] = [
  { value: 'conversation', label: 'Conversation', title: 'The conversation with Claude' },
  { value: 'changes', label: 'Changes', title: 'What this session changed', shortcut: formatAccelerator('CmdOrCtrl+Shift+D') },
  { value: 'terminal', label: 'Terminal', title: 'A terminal in the working folder', shortcut: formatAccelerator('CmdOrCtrl+`') }
]

/**
 * The concept's chat toolbar: the session's title over its folder and branch,
 * Conversation, Changes and Terminal in the middle, then what it's doing and
 * the inspector's button. With the sidebar away, its menu, its button and New
 * Session come to the leading edge.
 */
export function ConceptToolbar({
  session,
  title,
  status,
  sidebarShown,
  clearCaptionButtons
}: {
  session: SessionMeta | undefined
  title: string | null
  status: Status | null
  sidebarShown: boolean
  clearCaptionButtons: boolean
}) {
  const view = useUi((s) => s.view)
  const setView = useUi((s) => s.setView)
  const inspectorShown = useUi((s) => (inspectorFits(window.innerWidth, s) ? s.inspectorOpen : s.inspectorSheet))
  const branch = useWorktrees((s) => (session ? s.info[session.id]?.branch : undefined)) ?? (session?.gitBranch && session.gitBranch !== 'HEAD' ? session.gitBranch : null)
  return (
    <PaneToolbar clearCaptionButtons={clearCaptionButtons} className="concept-toolbar">
      {!sidebarShown && <SidebarStandIns withToggle />}
      {session && title && (
        <div className="flex min-w-[96px] shrink flex-col px-1 leading-[1.25]">
          <h1 className="truncate font-display text-[14px] font-bold tracking-[-0.01em] text-label">{title}</h1>
          <p className="truncate text-[11.5px] text-label-secondary">
            {projectName(session)}
            {branch && ` · ${branch}`}
          </p>
        </div>
      )}
      {session && <WorktreeCapsule id={session.id} />}
      <div className="min-w-2 flex-1" />
      {session && (
        <Track
          label="Show"
          value={view}
          segments={VIEWS}
          onChange={(next, viaKeyboard) => {
            if (next === view) return
            // The same toggles the menu runs, so the terminal takes the keyboard as it does there.
            if (next === 'conversation') runCommand(view === 'changes' ? 'view.toggleDiff' : 'view.toggleTerminal', viaKeyboard)
            else if (next === 'changes') setView('changes')
            else runCommand('view.toggleTerminal', viaKeyboard)
          }}
        />
      )}
      <div className="min-w-2 flex-1" />
      {status && <StatusPill status={status} />}
      <UpdateButton />
      <GlassCapsule label="Window">
        <InspectorButton shown={inspectorShown} />
      </GlassCapsule>
    </PaneToolbar>
  )
}

/**
 * What the session is doing, as a pill: amber while Claude waits for you, a
 * spinner and the shimmer while it works, plain words at rest. A live region,
 * so a change is read out once.
 */
function StatusPill({ status }: { status: Status }) {
  const waiting = status.kind === 'waiting'
  return (
    <div role="status" className={cn('concept-pill', `is-${status.kind}`)}>
      {waiting ? (
        // Takes you to the card waiting at the foot of the conversation.
        <button type="button" className="no-drag contents" onClick={() => showCard()}>
          <span aria-hidden className="concept-pill-dot" />
          {status.text}
        </button>
      ) : status.kind === 'working' ? (
        <>
          <Spinner />
          <span className="live-text">{status.text}</span>
        </>
      ) : (
        status.text
      )}
    </div>
  )
}

/** The conversation, scrolled to the card that waits for you. */
function showCard() {
  useUi.getState().setView('conversation')
  window.dispatchEvent(new Event('gloom:show-card'))
}
