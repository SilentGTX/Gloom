import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react'
import { useUi } from '../../stores/ui'
import { ChatColumn } from '../chat/ChatColumn'
import { LibraryDnd } from '../library/drag'
import { SidebarPanel } from '../sidebar/Sidebar'
import { CHAT_MIN, computeLayout, SIDEBAR } from './layout'
import { OverlaySheet } from './OverlaySheet'
import { Splitter } from './Splitter'

/** The sidebar floats this far inside the window's edges. */
const FRAME = 8
/** A show or hide this recent was yours; later layout changes come from resizing the window and don't slide. */
const TOGGLE_MS = 600

function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/**
 * macOS 26's composition: soft paper edge to edge across the whole window, and
 * one sidebar floating over it as a glass panel that carries Gloom's dusk
 * inside: your library, your folders and their sessions. The chat has a
 * toolbar floating over its top. A narrow window folds the sidebar into a sheet.
 */
export function Shell() {
  const width = useWindowWidth()
  const ui = useUi()
  const reduce = useReducedMotion()
  const { sidebarInline } = computeLayout(width, ui)

  // A sidebar that fits inline again doesn't need its sheet.
  const { sheet, closeSheet } = ui
  useEffect(() => {
    if (sheet && sidebarInline) closeSheet(true)
  }, [sheet, sidebarInline, closeSheet])

  const column = ui.sidebarWidth + FRAME * 2
  // Toasts centre over the chat, beside the sidebar.
  useEffect(() => {
    document.documentElement.style.setProperty('--content-shift', `${sidebarInline ? column / 2 : 0}px`)
  }, [sidebarInline, column])
  // The splitter may not push the chat under its minimum (which would fold the sidebar away mid-drag).
  const sidebarMax = Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, width - CHAT_MIN - FRAME * 2))

  // Shown or hidden with the pointer, the sidebar slides in and out along the
  // same path, past its own width so the shadow goes too; from the keyboard it
  // snaps, and reduced motion fades it.
  // The transition goes in through `custom`, so a sidebar on its way out leaves the way you sent it.
  const slides = !ui.instant && Date.now() - ui.toggledAt < TOGGLE_MS
  const transition: Transition = !slides ? { duration: 0 } : reduce ? { duration: 0.2, ease: [0.23, 1, 0.32, 1] } : { type: 'spring', bounce: 0, duration: 0.32 }
  const variants = {
    away: (t: Transition) => ({ ...(reduce ? { opacity: 0 } : { x: -column - 24 }), transition: t }),
    here: (t: Transition) => ({ ...(reduce ? { opacity: 1 } : { x: 0 }), transition: t })
  }

  return (
    <LibraryDnd>
      <div className="paper relative flex h-full overflow-hidden">
        {/* Leaving, it's lifted out of the row at once, so the chat takes the room while it slides away. */}
        <AnimatePresence initial={false} mode="popLayout" custom={transition}>
          {sidebarInline && (
            <motion.div
              key="sidebar"
              className="relative z-20 shrink-0 p-[var(--frame)]"
              style={{ width: column }}
              custom={transition}
              variants={variants}
              initial="away"
              animate="here"
              exit="away"
            >
              <SidebarPanel width={ui.sidebarWidth} />
            </motion.div>
          )}
        </AnimatePresence>
        {sidebarInline && (
          <Splitter variant="edge" label="Resize sidebar" value={ui.sidebarWidth} min={SIDEBAR.min} max={sidebarMax} initial={SIDEBAR.initial} onChange={ui.setSidebarWidth} />
        )}
        <ChatColumn sidebarShown={sidebarInline || sheet} />

        <OverlaySheet open={sheet} instant={ui.instant} area={{ inset: 0 }} inset={FRAME} width={ui.sidebarWidth} label="Sidebar" onClose={closeSheet}>
          <SidebarPanel width={ui.sidebarWidth} inSheet />
        </OverlaySheet>
      </div>
    </LibraryDnd>
  )
}
