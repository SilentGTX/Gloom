import { useEffect, useState } from 'react'
import { ArrowDownToLine, Sparkles } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Tooltip } from '../../components/ui/Tooltip'
import { takeLastVersion, useUpdateState } from '../../lib/update'

/**
 * The title bar's update button: absent until an update is downloaded and
 * verified, then it lights up. The one prominent control, so its background
 * carries the colour (Liquid Glass's rule for primary actions).
 */
export function UpdateButton() {
  const update = useUpdateState()
  const reduce = useReducedMotion()
  const ready = update?.status === 'ready'
  return (
    <AnimatePresence>
      {ready && (
        <motion.div
          key="update"
          className="no-drag"
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.86 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'spring', bounce: 0, duration: 0.45 }}
        >
          <Tooltip label={`Install Gloom ${update.available} and Restart`}>
            <button
              type="button"
              aria-label={`Update to Gloom ${update.available}`}
              onClick={() => void window.gloom?.installUpdate()}
              className="update-capsule"
            >
              <span className="update-glow" aria-hidden />
              <ArrowDownToLine size={15} strokeWidth={2} aria-hidden />
              Update
            </button>
          </Tooltip>
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
