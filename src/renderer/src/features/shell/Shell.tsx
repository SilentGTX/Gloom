import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { cn } from '../../lib/cn'
import { useLibrary, useOpenSession } from '../../stores/library'
import { TranscriptStore, useSplitTranscript } from '../../stores/transcript'
import { useUi } from '../../stores/ui'
import { ChatColumn } from '../chat/ChatColumn'
import { Inspector } from '../concept/Inspector'
import { DiffPane, useDiffRefresh } from '../diff/DiffPane'
import { LibraryDnd } from '../library/drag'
import { SidebarPanel } from '../sidebar/Sidebar'
import { TerminalPane } from '../terminal/TerminalPane'
import { CHAT_MIN, CHAT_MIN_BESIDE_DIFF, CHAT_MIN_HEIGHT, computeLayout, DIFF, FRAME, INSPECTOR, inspectorFits, SIDE, SIDEBAR, TERMINAL } from './layout'
import { SidePane } from '../side/SidePane'
import { OverlaySheet } from './OverlaySheet'
import { Splitter } from './Splitter'

/** A show or hide this recent was yours; later layout changes come from resizing the window and don't slide. */
const TOGGLE_MS = 600
/** Split view's second column is at least this wide. */
const SPLIT_MIN = 360

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/** How a pane you showed or hid moves: slides (a spring with no bounce), fades under reduced motion, snaps from the keyboard. */
function paneTransition(slides: boolean, reduce: boolean | null): Transition {
  return !slides ? { duration: 0 } : reduce ? { duration: 0.2, ease: [0.23, 1, 0.32, 1] } : { type: 'spring', bounce: 0, duration: 0.28 }
}

/**
 * macOS 26's composition: soft paper edge to edge across the whole window, and
 * one sidebar floating over it as a glass panel that carries Gloom's dusk
 * inside: your library, your folders and their sessions. The chat has a
 * toolbar floating over its top, the terminal pane under it, and the diff pane
 * beside it on the trailing side. A narrow window folds the sidebar into a
 * sheet, and lets the diff pane float over the chat.
 *
 * The concept design keeps the sidebar and the chat, turns the terminal and
 * diff panes into views of the chat, and puts an inspector on the trailing
 * side instead: beside the chat while it keeps 640 px, a sheet over it below that.
 */
export function Shell() {
  const { width, height } = useWindowSize()
  const ui = useUi()
  const reduce = useReducedMotion()
  const session = useOpenSession()
  // Split view: a second session beside the open one, with a transcript of its own.
  const splitSession = useLibrary((s) => (ui.split && ui.split !== session?.id ? s.sessions[ui.split] : undefined))
  const concept = ui.design === 'concept'
  // Bigger text lets the sidebar go wider (deep folders and long titles stay readable); back at
  // the usual size it narrows again, and the wider choice waits for the bigger text.
  const widest = SIDEBAR.max * Math.max(1, ui.textScale)
  const sidebarWidth = Math.min(ui.sidebarWidth, widest)
  const { sidebarInline } = computeLayout(width, { sidebarWidth, sidebarHidden: ui.sidebarHidden })

  // A sidebar that fits inline again doesn't need its sheet.
  const { sheet, closeSheet } = ui
  useEffect(() => {
    if (sheet && sidebarInline) closeSheet(true)
  }, [sheet, sidebarInline, closeSheet])

  const column = sidebarWidth + FRAME * 2
  const sidebarSpace = sidebarInline ? column : 0
  // Toasts centre over the chat, beside the sidebar.
  useEffect(() => {
    document.documentElement.style.setProperty('--content-shift', `${sidebarInline ? column / 2 : 0}px`)
  }, [sidebarInline, column])
  // The splitter may not push the chat under its minimum (which would fold the sidebar away mid-drag).
  const sidebarMax = Math.max(SIDEBAR.min, Math.min(widest, width - CHAT_MIN - FRAME * 2))

  // The side pane (File, Plan, Tasks, Browser, Artifacts) takes the trailing slot while it shows: the
  // diff pane and the inspector step aside for it, and come back when it goes. Like the diff pane, it
  // floats over the chat when the chat would drop under 560 px.
  const sideOpen = ui.side !== null
  const sideMax = Math.max(SIDE.min, Math.min(SIDE.max, width - sidebarSpace - CHAT_MIN_BESIDE_DIFF))
  const sideInline = sideOpen && width - sidebarSpace - SIDE.min >= CHAT_MIN_BESIDE_DIFF
  const sideWidth = Math.min(ui.sideWidth, sideMax)

  // The diff pane sits beside the chat while the chat keeps 560 px; narrower, it floats over it.
  const diffMax = Math.max(DIFF.min, Math.min(DIFF.max, width - sidebarSpace - CHAT_MIN_BESIDE_DIFF))
  const diffInline = !concept && !sideOpen && ui.diffOpen && width - sidebarSpace - DIFF.min >= CHAT_MIN_BESIDE_DIFF
  const diffWidth = Math.min(ui.diffWidth, diffMax)
  const terminalMax = Math.max(TERMINAL.min, height - CHAT_MIN_HEIGHT - 48)
  const terminalHeight = Math.min(ui.terminalHeight, terminalMax)

  // The concept's inspector, and the changes it lists (read while it or the Changes view shows).
  const inspectorRoom = inspectorFits(width, { sidebarWidth, sidebarHidden: ui.sidebarHidden })
  const inspectorInline = concept && !sideOpen && ui.inspectorOpen && inspectorRoom
  const inspectorSheet = concept && !sideOpen && ui.inspectorSheet && !inspectorRoom
  const { settleInspector } = ui
  useEffect(() => {
    if (concept && inspectorRoom) settleInspector()
  }, [concept, inspectorRoom, settleInspector])
  useDiffRefresh(concept && (inspectorInline || inspectorSheet || ui.view === 'changes') ? (session?.id ?? null) : null, ui.diffTab)

  // Shown or hidden with the pointer, the sidebar slides in and out along the
  // same path, past its own width so the shadow goes too; from the keyboard it
  // snaps, and reduced motion fades it. The panes do the same along their own
  // edges. The transition goes in through `custom`, so a pane on its way out
  // leaves the way you sent it.
  const now = Date.now()
  const sidebarMotion = paneTransition(!ui.instant && now - ui.toggledAt < TOGGLE_MS, reduce)
  const paneMotion = paneTransition(!ui.paneInstant && now - ui.paneToggledAt < TOGGLE_MS, reduce)
  const sidebarVariants = {
    away: (t: Transition) => ({ ...(reduce ? { opacity: 0 } : { x: -column - 24 }), transition: t }),
    here: (t: Transition) => ({ ...(reduce ? { opacity: 1 } : { x: 0 }), transition: t })
  }
  const diffVariants = {
    away: (t: Transition) => ({ ...(reduce ? { opacity: 0 } : { x: diffWidth + 24 }), transition: t }),
    here: (t: Transition) => ({ ...(reduce ? { opacity: 1 } : { x: 0 }), transition: t })
  }
  const sideVariants = {
    away: (t: Transition) => ({ ...(reduce ? { opacity: 0 } : { x: sideWidth + 24 }), transition: t }),
    here: (t: Transition) => ({ ...(reduce ? { opacity: 1 } : { x: 0 }), transition: t })
  }
  const inspectorVariants = {
    away: (t: Transition) => ({ ...(reduce ? { opacity: 0 } : { x: INSPECTOR.width + 24 }), transition: t }),
    here: (t: Transition) => ({ ...(reduce ? { opacity: 1 } : { x: 0 }), transition: t })
  }
  const terminalVariants = {
    away: (t: Transition) => ({ ...(reduce ? { opacity: 0 } : { y: terminalHeight + 8 }), transition: t }),
    here: (t: Transition) => ({ ...(reduce ? { opacity: 1 } : { y: 0 }), transition: t })
  }

  return (
    <LibraryDnd>
      <div className="paper relative flex h-full overflow-hidden">
        {/* Leaving, it's lifted out of the row at once, so the chat takes the room while it slides away. */}
        <AnimatePresence initial={false} mode="popLayout" custom={sidebarMotion}>
          {sidebarInline && (
            <motion.div
              key="sidebar"
              className="relative z-20 shrink-0 p-[var(--frame)]"
              style={{ width: column }}
              custom={sidebarMotion}
              variants={sidebarVariants}
              initial="away"
              animate="here"
              exit="away"
            >
              <ErrorBoundary part="Sidebar">
                <SidebarPanel width={sidebarWidth} />
              </ErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>
        {sidebarInline && (
          <Splitter variant="edge" label="Resize sidebar" value={sidebarWidth} min={SIDEBAR.min} max={sidebarMax} initial={SIDEBAR.initial} onChange={ui.setSidebarWidth} />
        )}

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <ChatColumn session={session} sidebarShown={sidebarInline || sheet} clearCaptionButtons={!splitSession && !sideInline && (concept ? !inspectorInline : !diffInline)} />
            {splitSession && (
              <>
                <Splitter
                  variant="hairline"
                  sizes="after"
                  label="Resize split view"
                  value={Math.min(ui.splitWidth, Math.max(SPLIT_MIN, width - sidebarSpace - CHAT_MIN - (sideInline ? sideWidth : diffInline ? diffWidth : inspectorInline ? INSPECTOR.width : 0)))}
                  min={SPLIT_MIN}
                  max={Math.max(SPLIT_MIN, width - sidebarSpace - CHAT_MIN - (sideInline ? sideWidth : diffInline ? diffWidth : inspectorInline ? INSPECTOR.width : 0))}
                  initial={520}
                  onChange={ui.setSplitWidth}
                />
                <div className="relative flex min-w-0 shrink-0 flex-col" style={{ width: Math.min(ui.splitWidth, Math.max(SPLIT_MIN, width - sidebarSpace - CHAT_MIN - (sideInline ? sideWidth : diffInline ? diffWidth : inspectorInline ? INSPECTOR.width : 0))) }}>
                  <TranscriptStore.Provider value={useSplitTranscript}>
                    <ErrorBoundary part="Chat" resetKey={splitSession.id}>
                      <ChatColumn session={splitSession} sidebarShown split clearCaptionButtons={!sideInline && (concept ? !inspectorInline : !diffInline)} />
                    </ErrorBoundary>
                  </TranscriptStore.Provider>
                </div>
              </>
            )}
          </div>
          <AnimatePresence initial={false} mode="popLayout" custom={paneMotion}>
            {!concept && ui.terminalOpen && (
              <motion.div
                key="terminal"
                className="relative z-10 flex shrink-0 flex-col"
                style={{ height: terminalHeight }}
                custom={paneMotion}
                variants={terminalVariants}
                initial="away"
                animate="here"
                exit="away"
              >
                <Splitter
                  variant="hairline"
                  orientation="horizontal"
                  sizes="after"
                  label="Resize terminal"
                  value={terminalHeight}
                  min={TERMINAL.min}
                  max={terminalMax}
                  initial={TERMINAL.initial}
                  onChange={ui.setTerminalHeight}
                />
                <ErrorBoundary part="Terminal" resetKey={session?.id}>
                  <TerminalPane session={session} />
                </ErrorBoundary>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {diffInline && (
          <Splitter variant="hairline" sizes="after" label="Resize diff" value={diffWidth} min={DIFF.min} max={diffMax} initial={DIFF.initial} onChange={ui.setDiffWidth} />
        )}
        {sideInline && <Splitter variant="hairline" sizes="after" label="Resize pane" value={sideWidth} min={SIDE.min} max={sideMax} initial={SIDE.initial} onChange={ui.setSideWidth} />}
        <AnimatePresence initial={false} mode="popLayout" custom={paneMotion}>
          {diffInline && (
            <motion.div key="diff" className="relative z-10 shrink-0" style={{ width: diffWidth }} custom={paneMotion} variants={diffVariants} initial="away" animate="here" exit="away">
              <ErrorBoundary part="Diff" resetKey={session?.id}>
                <DiffPane sessionId={session?.id ?? null} clearCaptionButtons />
              </ErrorBoundary>
            </motion.div>
          )}
          {sideInline && (
            <motion.div key="side" className="relative z-10 shrink-0" style={{ width: sideWidth }} custom={paneMotion} variants={sideVariants} initial="away" animate="here" exit="away">
              <ErrorBoundary part="Pane" resetKey={session?.id}>
                <SidePane session={session} clearCaptionButtons />
              </ErrorBoundary>
            </motion.div>
          )}
          {inspectorInline && (
            <motion.div
              key="inspector"
              className="relative z-10 shrink-0"
              style={{ width: INSPECTOR.width }}
              custom={paneMotion}
              variants={inspectorVariants}
              initial="away"
              animate="here"
              exit="away"
            >
              <ErrorBoundary part="Inspector" resetKey={session?.id}>
                <Inspector session={session} clearCaptionButtons />
              </ErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>

        <OverlaySheet
          open={!concept && !sideOpen && ui.diffOpen && !diffInline}
          instant={ui.paneInstant}
          area={{ inset: 0 }}
          inset={FRAME}
          width={Math.min(ui.diffWidth, width - FRAME * 2 - 48)}
          side="right"
          label="Diff"
          onClose={(viaKeyboard) => ui.toggleDiff(viaKeyboard, false)}
        >
          <div className="diff-sheet h-full overflow-hidden rounded-[var(--radius-panel)]">
            <ErrorBoundary part="Diff" resetKey={session?.id}>
              <DiffPane sessionId={session?.id ?? null} clearCaptionButtons />
            </ErrorBoundary>
          </div>
        </OverlaySheet>

        <OverlaySheet
          open={sideOpen && !sideInline}
          instant={ui.paneInstant}
          area={{ inset: 0 }}
          inset={FRAME}
          width={Math.min(ui.sideWidth, width - FRAME * 2 - 48)}
          side="right"
          label="Pane"
          onClose={(viaKeyboard) => ui.closeSide(viaKeyboard)}
        >
          <div className={cn(concept ? 'concept-sheet' : 'diff-sheet rounded-[var(--radius-panel)]', 'h-full overflow-hidden')}>
            <ErrorBoundary part="Pane" resetKey={session?.id}>
              <SidePane session={session} clearCaptionButtons={false} />
            </ErrorBoundary>
          </div>
        </OverlaySheet>

        <OverlaySheet
          open={inspectorSheet}
          instant={ui.paneInstant}
          area={{ inset: 0 }}
          inset={FRAME}
          width={Math.min(INSPECTOR.width, width - FRAME * 2 - 48)}
          side="right"
          label="Inspector"
          onClose={(viaKeyboard) => ui.toggleInspector(viaKeyboard, false)}
        >
          <div className="concept-sheet h-full overflow-hidden">
            <ErrorBoundary part="Inspector" resetKey={session?.id}>
              <Inspector session={session} clearCaptionButtons={false} />
            </ErrorBoundary>
          </div>
        </OverlaySheet>

        <OverlaySheet open={sheet} instant={ui.instant} area={{ inset: 0 }} inset={FRAME} width={sidebarWidth} label="Sidebar" onClose={closeSheet}>
          <ErrorBoundary part="Sidebar">
            <SidebarPanel width={sidebarWidth} inSheet />
          </ErrorBoundary>
        </OverlaySheet>
      </div>
    </LibraryDnd>
  )
}
