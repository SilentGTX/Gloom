import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import type { UpdateScreen as Screen } from '@shared/ipc'
import cloud from '../../assets/update.png'
import { cn } from '../../lib/cn'
import { useUpdateScreen, useUpdateState } from '../../lib/update'

/** One full breath of the busy icon (1.6 s each way). */
const BREATH_MS = 3_200

const mb = (bytes: number) => Math.round(bytes / 1e6)

/** The status line and the small line under the bar. */
function words(screen: Screen): [string, string] {
  switch (screen.status) {
    case 'checking':
      return ['Checking for updates…', '']
    case 'downloading':
      return [`Downloading Gloom ${screen.version}…`, `${mb(screen.received)} MB of ${mb(screen.total)} MB`]
    case 'installing':
      return [`Installing Gloom ${screen.version}…`, screen.reopens ? 'Gloom reopens when it’s done' : '']
    case 'starting':
      return [`Starting Gloom ${screen.version}…`, '']
    case 'failed':
      return ['Couldn’t update Gloom', `Back to Gloom in ${screen.seconds}…`]
  }
}

/**
 * The window becomes Sync's update window while Gloom checks for, downloads
 * or installs an update: its size stays, the app goes from view, and the
 * window shows the update window's page. At launch it is the window's first
 * frame; later it fades in over the app. When it's done the light comes up
 * behind the icon as it fades, and the app is there. An update that unpacks
 * beside the running copy ends with the new version's window opening on top
 * of this one on the same screen (handover.ts), so the screen carries on
 * across the swap and then gives way to the new app. The app is inert
 * meanwhile (App.tsx) and focus waits on the screen.
 */
export function UpdateScreen({ screen }: { screen: Screen | null }) {
  const open = screen !== null
  const root = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  // Not in a cleanup: React puts focus back where it was before a commit, so
  // focus moved during one (when cleanups run) would land on the screen again.
  useLayoutEffect(() => {
    if (open) {
      const active = document.activeElement
      // Strict Mode runs this twice, the second time with focus already here.
      if (!root.current?.contains(active)) returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null
      root.current?.focus({ preventScroll: true })
    } else if (returnTo.current) {
      if (returnTo.current.isConnected) returnTo.current.focus({ preventScroll: true })
      returnTo.current = null
    }
  }, [open])

  return <AnimatePresence initial={false}>{screen && <Page key="update-screen" screen={screen} root={root} />}</AnimatePresence>
}

/** The screen on its own, before the app loads (taking over from the previous version, main.tsx). */
export function UpdateScreenAlone() {
  return <UpdateScreen screen={useUpdateScreen()} />
}

function Page({ screen, root }: { screen: Screen; root: RefObject<HTMLDivElement | null> }) {
  // Leaving, the app takes the pointer back at once while the screen fades.
  const present = useIsPresent()
  const reduce = useReducedMotion()
  const version = useUpdateState()?.current
  // The icon breathes in time with the clock, so the next version's window,
  // opening on top of this one, takes the breath up where this one is.
  const [breath] = useState(() => Date.now() % BREATH_MS)
  const [status, detail] = words(screen)
  const progress = screen.status === 'downloading' && screen.total > 0 ? screen.received / screen.total : 0
  const bar =
    screen.status === 'downloading'
      ? { role: 'progressbar', 'aria-label': 'Download', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(progress * 100) }
      : screen.status === 'installing'
        ? { role: 'progressbar', 'aria-label': 'Installing' }
        : { 'aria-hidden': true }

  return (
    <motion.div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-name"
      aria-describedby="update-status"
      tabIndex={-1}
      // The whole window drags, as Sync's update window did.
      className={cn('update-screen fixed inset-0 z-[70]', present ? 'drag' : 'pointer-events-none')}
      data-status={screen.status}
      data-busy={screen.status === 'failed' ? undefined : ''}
      data-leaving={present ? undefined : ''}
      style={{ '--breath': breath } as CSSProperties}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: reduce ? 0.2 : 0.35, ease: [0.23, 1, 0.32, 1] } }}
      transition={{ duration: reduce ? 0.2 : 0.3, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="update-mark" aria-hidden>
        <div className="update-halo" />
        <div className="update-icon">
          <img src={cloud} alt="" draggable={false} />
        </div>
      </div>
      <h2 id="update-name" className="update-name">
        Gloom
      </h2>
      <p id="update-status" className="update-status" role="status">
        {status}
      </p>
      <div className="update-progress" {...bar} style={{ '--progress': progress } as CSSProperties}>
        <span />
      </div>
      <p className="update-detail">{detail}</p>
      <p className="update-version">{version && `Version ${version}`}</p>
    </motion.div>
  )
}
