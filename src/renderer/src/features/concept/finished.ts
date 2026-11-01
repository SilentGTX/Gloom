// The concept sidebar's green dot, and the pet's "ready": Claude finished a turn
// in a session while you weren't looking at it, because another one was open
// or Gloom wasn't the window in front (minimized, or behind another app while
// you watched the pet). Opening the session clears it, or coming back to Gloom
// with it open, as reading a message clears Mail's dot. Not kept across launches.
import { useEffect } from 'react'
import { create } from 'zustand'
import { useLibrary } from '../../stores/library'
import { isBusy, useLive } from '../../stores/live'
import { useUi } from '../../stores/ui'

export const useFinished = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set() }))

/**
 * You can see the chat: Gloom is the focused window (minimized, it isn't). From the
 * window state main sends, as the title bar uses: the page's own focus and
 * visibility don't change when Gloom is minimized.
 */
let focused = document.hasFocus()
const looking = () => focused

/** Back in Gloom: what the chat shows is seen. */
function readOpen() {
  const ids = useFinished.getState().ids
  const open = useUi.getState().selection
  if (open.some((id) => ids.has(id))) useFinished.setState({ ids: new Set([...ids].filter((id) => !open.includes(id))) })
}

/** Watches turns end and selections change. Mounted once, by the app. */
export function useFinishedTracking(): void {
  useEffect(() => {
    const offLive = useLive.subscribe((s, before) => {
      if (s.sessions === before.sessions) return
      const open = useUi.getState().selection
      let next: Set<string> | null = null
      for (const [id, now] of Object.entries(s.sessions)) {
        const was = before.sessions[id]
        // A turn that failed says so in the composer; it isn't "done".
        if (was && isBusy(was) && now.state === 'idle' && !now.error && (!open.includes(id) || !looking())) (next ??= new Set(useFinished.getState().ids)).add(id)
      }
      if (next) useFinished.setState({ ids: next })
    })
    const offUi = useUi.subscribe((s, before) => {
      if (s.selection === before.selection) return
      const ids = useFinished.getState().ids
      if (s.selection.some((id) => ids.has(id))) useFinished.setState({ ids: new Set([...ids].filter((id) => !s.selection.includes(id))) })
      // Opening a session marked unread reads it, as in Mail (only the one the chat shows).
      const open = s.selection.length === 1 ? s.selection[0] : null
      if (open && useLibrary.getState().library.sessions[open]?.unread) void useLibrary.getState().apply({ type: 'setUnread', ids: [open], unread: false }, { record: false })
    })
    // Back in Gloom, the open session is seen.
    const seen = (now: boolean) => {
      focused = now
      if (now) readOpen()
    }
    const api = window.gloom
    let offWindow = () => {}
    if (api) {
      void api.getWindowState().then((s) => s && (focused = s.focused))
      offWindow = api.onWindowState((s) => seen(s.focused))
    } else {
      const onFocus = () => seen(true)
      const onBlur = () => seen(false)
      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
      offWindow = () => {
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('blur', onBlur)
      }
    }
    return () => {
      offLive()
      offUi()
      offWindow()
    }
  }, [])
}
