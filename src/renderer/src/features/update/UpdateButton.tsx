import { useEffect, useState } from 'react'
import { ArrowDownToLine, Sparkles } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { GlassCapsule } from '../../components/ui/Glass'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { notify } from '../../lib/toast'
import { takeLastVersion, useUpdateState } from '../../lib/update'
import { isBusy, useLive } from '../../stores/live'

/**
 * The title bar's update button: absent until a check finds a newer Gloom
 * (one runs every half hour while Gloom is open), then the download arrow
 * arrives in Gloom's dusk indigo, the one coloured symbol in the toolbar, and
 * lights up once. Clicking it turns the window into the update screen.
 */
export function UpdateButton() {
  const update = useUpdateState()
  const reduce = useReducedMotion()
  const ready = update?.status === 'available'
  return (
    <AnimatePresence>
      {ready && (
        <motion.div
          key="update"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.86 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.45 }}
        >
          <GlassCapsule>
            {/* Clicked while Claude works, it waits for the turns to end, as the Claude app's updates do. */}
            <Tooltip label={update.waiting ? 'Updates When Claude Finishes' : 'Update Ready'} detail={`Gloom ${update.available}`}>
              <button
                type="button"
                aria-label={update.waiting ? `Gloom ${update.available} installs when Claude finishes` : `Update to Gloom ${update.available}`}
                onClick={() => {
                  if (!update.waiting) notifyIfWaiting()
                  void window.gloom?.installUpdate()
                }}
                className={cn('update-button no-drag', update.waiting && 'opacity-60')}
              >
                <span className="update-glow" aria-hidden />
                <ArrowDownToLine size={16} strokeWidth={2} aria-hidden />
              </button>
            </Tooltip>
          </GlassCapsule>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Says why nothing happens yet, when Claude is mid-turn somewhere. */
function notifyIfWaiting(): void {
  const busy = Object.values(useLive.getState().sessions).filter(isBusy).length
  if (busy) notify(busy === 1 ? 'Gloom updates when Claude finishes in your running session.' : `Gloom updates when Claude finishes in your ${busy} running sessions.`)
}

/** After an update relaunches Gloom, a quiet note says which version it is now. */
export function UpdatedNote() {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    void window.gloom?.getAppInfo().then(({ version: current }) => {
      const last = takeLastVersion(current)
      if (!last || last === current) return
      setVersion(current)
      timer = setTimeout(() => setVersion(null), 4500)
    })
    return () => clearTimeout(timer)
  }, [])
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
      <AnimatePresence>
        {version && (
          <motion.div
            key="updated"
            className="glass-strong flex items-center gap-2 rounded-full px-4 py-2 text-[13px] text-label"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
          >
            <Sparkles size={15} strokeWidth={1.75} className="relative z-[2] text-[var(--signal)]" aria-hidden />
            <span className="relative z-[2]">Updated to Gloom {version}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
