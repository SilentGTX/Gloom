import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, Copy, ImageOff } from 'lucide-react'
import type { BlobRef, ImagePart } from '@shared/transcript'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'

// ─── What a page left in the file ────────────────────────────────────────────

const BLOBS = 300
const blobs = new Map<string, Promise<unknown>>()

/** Reads an image or a long text from the transcript, once; kept so scrolling back doesn't read again. */
export function fetchBlob(sessionId: string, ref: BlobRef): Promise<unknown> {
  const key = `${sessionId}\u0000${ref}`
  let blob = blobs.get(key)
  if (!blob) {
    blob = window.gloom?.transcriptBlob(sessionId, ref) ?? Promise.reject(new Error('Not available here.'))
    blobs.set(key, blob)
    blob.catch(() => blobs.delete(key))
    if (blobs.size > BLOBS) blobs.delete(blobs.keys().next().value!)
  }
  return blob
}

/** A blob once `enabled`: undefined while it loads, null if it couldn't be read. */
export function useBlob(sessionId: string, ref: BlobRef | undefined, enabled = true): unknown {
  const [state, setState] = useState<{ ref: string; value: unknown } | null>(null)
  useEffect(() => {
    if (!ref || !enabled) return
    let alive = true
    fetchBlob(sessionId, ref).then(
      (value) => alive && setState({ ref, value }),
      () => alive && setState({ ref, value: null })
    )
    return () => {
      alive = false
    }
  }, [sessionId, ref, enabled])
  return state && state.ref === ref ? state.value : undefined
}

// ─── Images ──────────────────────────────────────────────────────────────────

/**
 * An image from the transcript, read from the file when its row is drawn (the
 * list only draws rows near the screen). Its frame keeps one height from the
 * start, so nothing above or below it moves when the picture arrives; a click
 * opens it full size.
 */
export function TranscriptImage({ sessionId, part, height = 160, label = 'Image' }: { sessionId: string; part: ImagePart; height?: number; label?: string }) {
  const value = useBlob(sessionId, part.ref)
  const [zoom, setZoom] = useState<Zoom | null>(null)
  // The thumbnail steps aside while its picture is open, as it does in Photos.
  const [away, setAway] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const thumb = useRef<HTMLImageElement>(null)
  const src = typeof value === 'string' ? value : null
  const open = () => {
    const img = thumb.current
    if (!img) return
    const r = img.getBoundingClientRect()
    setZoom({ from: { x: r.left, y: r.top, width: r.width, height: r.height }, natural: { width: img.naturalWidth || r.width, height: img.naturalHeight || r.height } })
    setAway(true)
  }
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`Open ${label.toLowerCase()} full size`}
        disabled={!src}
        onClick={open}
        className={cn(
          'no-drag relative shrink-0 overflow-hidden rounded-[10px] bg-fill outline-none',
          'transition-transform duration-[var(--duration-press)] ease-out enabled:active:scale-[0.98] motion-reduce:enabled:active:scale-100',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)]'
        )}
        style={{ height, minWidth: src ? undefined : Math.round(height * 1.33) }}
      >
        {src ? (
          <img ref={thumb} src={src} alt={label} draggable={false} className={cn('image-in block h-full w-auto max-w-[min(100%,480px)] object-contain', away && 'invisible')} />
        ) : value === null ? (
          <span className="flex h-full items-center justify-center gap-1.5 px-4 text-footnote text-label-secondary">
            <ImageOff size={14} strokeWidth={1.75} aria-hidden />
            Image unavailable
          </span>
        ) : null}
      </button>
      {src && (
        <Lightbox
          zoom={zoom}
          src={src}
          label={label}
          onClose={() => {
            setZoom(null)
            button.current?.focus({ preventScroll: true })
          }}
          onClosed={() => setAway(false)}
        />
      )}
    </>
  )
}

/** Where a picture opened from, and its own size. */
interface Zoom {
  from: { x: number; y: number; width: number; height: number }
  natural: { width: number; height: number }
}

/**
 * A picture full size over a dimmed window. It grows out of the thumbnail you
 * clicked and goes back into it when it closes (a click anywhere, or Esc);
 * with reduced motion it fades instead.
 */
function Lightbox({ zoom, src, label, onClose, onClosed }: { zoom: Zoom | null; src: string; label: string; onClose(): void; onClosed(): void }) {
  const reduce = useReducedMotion()
  const panel = useRef<HTMLDivElement>(null)
  // Keeps the geometry while closing, after `zoom` is gone.
  const [last, setLast] = useState(zoom)
  if (zoom && zoom !== last) setLast(zoom)
  const z = zoom ?? last

  useEffect(() => {
    if (!zoom) return
    panel.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, onClose])

  if (!z) return null
  // Its own size, fitted inside the window with a margin.
  const margin = 40
  const fit = Math.min(1, (window.innerWidth - margin * 2) / z.natural.width, (window.innerHeight - margin * 2) / z.natural.height)
  const width = z.natural.width * fit
  const height = z.natural.height * fit
  const thumbnail = {
    x: z.from.x + z.from.width / 2 - window.innerWidth / 2,
    y: z.from.y + z.from.height / 2 - window.innerHeight / 2,
    scale: z.from.width / width
  }
  const hidden = reduce ? { opacity: 0 } : { ...thumbnail, opacity: 1 }
  const transition = reduce ? { duration: 0.2 } : { type: 'spring' as const, bounce: 0, duration: 0.34 }

  return createPortal(
    <AnimatePresence onExitComplete={onClosed}>
      {zoom && <motion.div key="scrim" className="no-drag fixed inset-0 z-40 bg-black/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={transition} onClick={onClose} />}
      {zoom && (
        <motion.div key="picture" ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className="no-drag fixed inset-0 z-50 flex items-center justify-center outline-none" onClick={onClose}>
          <motion.img
            src={src}
            alt={label}
            draggable={false}
            className="rounded-[8px] shadow-[0_20px_60px_rgb(0_0_0/0.5)]"
            style={{ width, height }}
            initial={hidden}
            animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            exit={hidden}
            transition={transition}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
}

/** A row of images that scrolls sideways, so a long set never changes the row's height. */
export function ImageStrip({ sessionId, images, height, label }: { sessionId: string; images: ImagePart[]; height?: number; label?: string }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {images.map((part, i) => (
        <TranscriptImage key={part.ref} sessionId={sessionId} part={part} height={height} label={images.length > 1 ? `${label ?? 'Image'} ${i + 1}` : label} />
      ))}
    </div>
  )
}

// ─── Copying ─────────────────────────────────────────────────────────────────

/** Copies text; the icon turns to a checkmark for a moment as confirmation. */
export function CopyButton({ text, label = 'Copy', className }: { text: string | (() => string); label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <Tooltip label={copied ? 'Copied' : label}>
      <Button
        aria-label={copied ? 'Copied' : label}
        size="small"
        className={className}
        onClick={() => {
          void navigator.clipboard.writeText(typeof text === 'function' ? text() : text).then(() => setCopied(true))
        }}
      >
        {copied ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={1.75} />}
      </Button>
    </Tooltip>
  )
}

/** Shows text a page cut short in full, on request. */
export function useFullText(sessionId: string, more: BlobRef | undefined): { full: string | null; loading: boolean; load(): void } {
  const [asked, setAsked] = useState(false)
  const value = useBlob(sessionId, more, asked)
  return { full: typeof value === 'string' ? value : null, loading: asked && value === undefined, load: () => setAsked(true) }
}

/** "Show All" under text that was cut short. */
export function ShowAll({ onClick, loading, children = 'Show All' }: { onClick(): void; loading: boolean; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="no-drag rounded-[6px] px-1.5 py-0.5 text-footnote font-medium text-accent-text outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] disabled:opacity-60"
    >
      {loading ? 'Loading…' : children}
    </button>
  )
}
