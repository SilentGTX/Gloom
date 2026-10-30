import { useEffect, useState } from 'react'
import { ArrowDownToLine, Sparkles } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { GlassCapsule } from '../../components/ui/Glass'
import { Tooltip } from '../../components/ui/Tooltip'
import { takeLastVersion, useUpdateState } from '../../lib/update'

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
            <Tooltip label="Update Ready" detail={`Gloom ${update.available}`}>
              <button
                type="button"
                aria-label={`Update to Gloom ${update.available}`}
                onClick={() => void window.gloom?.installUpdate()}
                className="update-button no-drag"
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
