// Gloom's toasts: Sonner for stacking, timing and swipe, drawn headless as a
// glass capsule so they match the rest of the functional layer. They sit under
// the title bar, not at the window's bottom edge, which can hang off-screen,
// centred over the chat rather than the window when the sidebar is beside it.
import { toast, Toaster } from 'sonner'

interface NotifyOptions {
  /** Lets a later call (Ctrl+Z, say) dismiss this toast. */
  id?: string
  action?: { label: string; onClick(): void }
  /** Milliseconds. Undo toasts stay long enough to reach for; hovering pauses them, and Ctrl+Z works after. */
  duration?: number
}

export function notify(message: string, { id, action, duration = action ? 8000 : 4000 }: NotifyOptions = {}): void {
  toast.custom(
    (toastId) => (
      <div role="status" className="glass-strong flex min-h-10 max-w-[min(480px,calc(100vw-32px))] items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-[13px] text-label">
        <span className="relative z-[2] min-w-0 flex-1 truncate">{message}</span>
        {action && (
          <button
            type="button"
            onClick={() => {
              action.onClick()
              toast.dismiss(toastId)
            }}
            className="no-drag relative z-[2] h-7 shrink-0 rounded-full px-3 text-[13px] font-semibold text-accent-text outline-none transition-[transform,background-color] duration-[var(--duration-press)] ease-out hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] active:scale-[0.97]"
          >
            {action.label}
          </button>
        )}
      </div>
    ),
    { id, duration }
  )
}

/** Mounted once, at the root. */
export function Toasts() {
  // --content-shift: half the sidebar's column, set by the shell while it's inline.
  return <Toaster position="top-center" theme="system" offset={56} gap={8} visibleToasts={3} style={{ left: 'calc(50% + var(--content-shift, 0px))' }} />
}
