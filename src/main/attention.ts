// When a session needs you or finishes while you're in another app: a Windows
// notification (clicking it opens the session), the taskbar button flashing,
// and a badge on it counting the sessions waiting for you. Nothing of this
// while Gloom is in front: the chat and the sidebar already say it there.
import { BrowserWindow, nativeImage, Notification } from 'electron'
import { IPC } from '@shared/ipc'
import type { LiveEvent, PromptCard } from '@shared/live'
import { settings } from './claude/settings'
import type { AttentionKind } from './claude/sessions'

/** Shown notifications, kept so their click handlers outlive garbage collection. */
const shown = new Set<Notification>()

function body(kind: AttentionKind, card?: PromptCard): string {
  if (kind === 'finished') return 'Claude finished.'
  if (kind === 'failed') return 'Claude stopped with an error.'
  // Never the command or the file itself: a notification can be read over your shoulder.
  if (card?.kind === 'plan') return 'Claude has a plan for you to review.'
  if (card?.kind === 'question') return 'Claude has a question for you.'
  return 'Claude needs your permission to continue.'
}

/** Brings the window forward on the session. */
export function reveal(win: BrowserWindow, id: string): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  const event: LiveEvent = { type: 'reveal', id }
  win.webContents.send(IPC.liveEvent, event)
}

export function attend(win: BrowserWindow | null, id: string, title: string, kind: AttentionKind, card?: PromptCard): void {
  if (!win || win.isDestroyed() || (win.isFocused() && win.isVisible() && !win.isMinimized())) return
  win.flashFrame(true)
  if (!settings().notifications || !Notification.isSupported()) return
  const note = new Notification({ title, body: body(kind, card) })
  shown.add(note)
  note.on('click', () => {
    shown.delete(note)
    if (!win.isDestroyed()) reveal(win, id)
  })
  note.on('close', () => shown.delete(note))
  note.show()
}

/** The taskbar's badge: how many sessions wait for you, drawn by the window (main has no canvas). */
export function setBadge(win: BrowserWindow | null, count: number, png: string | null): void {
  if (!win || win.isDestroyed()) return
  if (count <= 0 || !png) {
    win.setOverlayIcon(null, '')
    return
  }
  const image = nativeImage.createFromDataURL(png)
  win.setOverlayIcon(image.isEmpty() ? null : image, count === 1 ? '1 session is waiting for you' : `${count} sessions are waiting for you`)
}
