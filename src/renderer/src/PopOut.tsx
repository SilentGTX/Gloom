// A pane in a window of its own (the diff, the terminal, or a side pane tab),
// for one session: the same stores and events as the main window, so it
// stays current, and only that pane on the page.
import { useEffect, useLayoutEffect } from 'react'
import { TooltipProvider } from './components/ui/Tooltip'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { DiffPane } from './features/diff/DiffPane'
import { SidePane } from './features/side/SidePane'
import { startScreens } from './features/terminal/registry'
import { TerminalPane } from './features/terminal/TerminalPane'
import { Toasts } from './lib/toast'
import { useApplyWindowState, useWindowState } from './lib/window-state'
import { useLibrary, useLibraryBridge } from './stores/library'
import { useLiveBridge } from './stores/live'
import { useTerminalsBridge } from './stores/terminals'
import { useTranscript, useTranscriptBridge } from './stores/transcript'
import { useUi, type SideTab } from './stores/ui'

const SIDE_TABS: SideTab[] = ['file', 'plan', 'tasks', 'browser', 'artifacts', 'pr']

export function PopOut({ pane, sessionId }: { pane: string; sessionId: string }) {
  useApplyWindowState(useWindowState())
  useLibraryBridge()
  useTranscriptBridge()
  useLiveBridge()
  useTerminalsBridge()
  useEffect(() => startScreens(), [])
  const session = useLibrary((s) => s.sessions[sessionId])
  const design = useUi((s) => s.design)
  useLayoutEffect(() => {
    document.documentElement.dataset.design = design
    // The tab this window shows (its session comes from the address; the main window's selection, which is kept, stays its own).
    if (SIDE_TABS.includes(pane as SideTab)) useUi.setState({ side: pane as SideTab })
  }, [design, pane, sessionId])
  useEffect(() => {
    if (session) useTranscript.getState().open(sessionId, !!session.file)
  }, [session, sessionId])
  return (
    <TooltipProvider>
      <div className="paper relative flex h-full flex-col overflow-hidden">
        <ErrorBoundary part="Pane" resetKey={sessionId}>
          {pane === 'diff' ? (
            <DiffPane sessionId={sessionId} clearCaptionButtons />
          ) : pane === 'terminal' ? (
            <div className="flex h-full flex-col pt-[var(--titlebar-h)]">
              <TerminalPane session={session} />
            </div>
          ) : (
            <SidePane session={session} clearCaptionButtons />
          )}
        </ErrorBoundary>
        <Toasts />
      </div>
    </TooltipProvider>
  )
}
