import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { useOpenSession } from '../../stores/library'
import { useUi } from '../../stores/ui'
import { ChatColumn } from '../chat/ChatColumn'
import { DiffPane } from '../diff/DiffPane'
import { LibraryDnd } from '../library/drag'
import { SidebarPanel } from '../sidebar/Sidebar'
import { TerminalPane } from '../terminal/TerminalPane'
import { CHAT_MIN, CHAT_MIN_BESIDE_DIFF, CHAT_MIN_HEIGHT, computeLayout, DIFF, SIDEBAR, TERMINAL } from './layout'
import { OverlaySheet } from './OverlaySheet'
import { Splitter } from './Splitter'

/** The sidebar floats this far inside the window's edges. */
const FRAME = 8
/** A show or hide this recent was yours; later layout changes come from resizing the window and don't slide. */
const TOGGLE_MS = 600

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
 */
export function Shell() {
  const { width, height } = useWindowSize()
  const ui = useUi()
  const reduce = useReducedMotion()
  const session = useOpenSession()
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

  // The diff pane sits beside the chat while the chat keeps 560 px; narrower, it floats over it.
  const diffMax = Math.max(DIFF.min, Math.min(DIFF.max, width - sidebarSpace - CHAT_MIN_BESIDE_DIFF))
  const diffInline = ui.diffOpen && width - sidebarSpace - DIFF.min >= CHAT_MIN_BESIDE_DIFF
  const diffWidth = Math.min(ui.diffWidth, diffMax)
  const terminalMax = Math.max(TERMINAL.min, height - CHAT_MIN_HEIGHT - 48)
  const terminalHeight = Math.min(ui.terminalHeight, terminalMax)

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
          <ChatColumn session={session} sidebarShown={sidebarInline || sheet} clearCaptionButtons={!diffInline} />
          <AnimatePresence initial={false} mode="popLayout" custom={paneMotion}>
            {ui.terminalOpen && (
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
        <AnimatePresence initial={false} mode="popLayout" custom={paneMotion}>
          {diffInline && (
            <motion.div key="diff" className="relative z-10 shrink-0" style={{ width: diffWidth }} custom={paneMotion} variants={diffVariants} initial="away" animate="here" exit="away">
              <ErrorBoundary part="Diff" resetKey={session?.id}>
                <DiffPane sessionId={session?.id ?? null} clearCaptionButtons />
              </ErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>

        <OverlaySheet
          open={ui.diffOpen && !diffInline}
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

        <OverlaySheet open={sheet} instant={ui.instant} area={{ inset: 0 }} inset={FRAME} width={sidebarWidth} label="Sidebar" onClose={closeSheet}>
          <ErrorBoundary part="Sidebar">
            <SidebarPanel width={sidebarWidth} inSheet />
          </ErrorBoundary>
        </OverlaySheet>
      </div>
    </LibraryDnd>
  )
}
