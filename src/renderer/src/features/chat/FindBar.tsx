import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { MATCH_LIMIT, useFind } from './find'

/**
 * Find in the transcript: a glass bar that floats at the top trailing corner of
 * the chat, under its toolbar, as Safari's does. It searches as you type;
 * Enter and F3 go to the next match, Shift with either to the previous one,
 * Esc closes it. Opened from the keyboard it appears at once; from a menu it
 * grows out of the corner it lives in.
 */
export function FindBar({ total, instant }: { total: number; instant: boolean }) {
  const open = useFind((s) => s.open)
  const query = useFind((s) => s.query)
  const current = useFind((s) => s.current)
  const reduce = useReducedMotion()
  const hidden = reduce || instant ? { opacity: 0 } : { opacity: 0, scale: 0.96 }

  const close = () => {
    useFind.getState().hide()
    document.querySelector<HTMLElement>('[aria-label="Transcript"]')?.focus({ preventScroll: true })
  }
  const status = !query.trim() ? '' : total === 0 ? 'No matches' : `${current < 0 ? 0 : current + 1} of ${total >= MATCH_LIMIT ? `${MATCH_LIMIT.toLocaleString()}+` : total.toLocaleString()}`

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="find"
          role="search"
          aria-label="Find in transcript"
          className="glass-strong no-drag absolute top-1.5 right-3 z-20 flex h-10 w-[min(360px,calc(100%-24px))] origin-top-right items-center gap-1 rounded-full pr-1 pl-3"
          initial={hidden}
          animate={{ opacity: 1, scale: 1 }}
          exit={hidden}
          transition={instant ? { duration: 0 } : { type: 'spring', bounce: 0, duration: 0.25 }}
        >
          <Search size={14} strokeWidth={1.75} aria-hidden className="relative z-[2] shrink-0 text-label-secondary" />
          <input
            data-find
            aria-label="Find in transcript"
            placeholder="Find in Transcript"
            value={query}
            spellCheck={false}
            onChange={(e) => useFind.getState().setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                useFind.getState().step(e.shiftKey ? -1 : 1)
              } else if (e.key === 'Escape') {
                e.preventDefault()
                close()
              }
            }}
            className="relative z-[2] min-w-0 flex-1 bg-transparent text-[13px] text-label outline-none placeholder:text-label-tertiary"
          />
          <span role="status" aria-live="polite" className="relative z-[2] shrink-0 px-1 text-[12px] text-label-secondary tabular">
            {status}
          </span>
          <div className="relative z-[2] flex shrink-0 items-center">
            <Tooltip label="Previous Match" shortcut="Shift+F3">
              <Button aria-label="Previous match" shape="round" size="icon" disabled={!total} onClick={() => useFind.getState().step(-1)}>
                <ChevronUp size={16} strokeWidth={1.75} />
              </Button>
            </Tooltip>
            <Tooltip label="Next Match" shortcut="F3">
              <Button aria-label="Next match" shape="round" size="icon" disabled={!total} onClick={() => useFind.getState().step(1)}>
                <ChevronDown size={16} strokeWidth={1.75} />
              </Button>
            </Tooltip>
            <Button size="text" shape="round" className="font-medium text-label" onClick={close}>
              Done
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
