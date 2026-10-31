// The concept sidebar's green dot: Claude finished a turn in a session while
// you were looking at another one. Opening the session clears it, as reading
// a message clears Mail's dot. Not kept across launches.
import { useEffect } from 'react'
import { create } from 'zustand'
import { useLibrary } from '../../stores/library'
import { isBusy, useLive } from '../../stores/live'
import { useUi } from '../../stores/ui'

export const useFinished = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set() }))

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
        if (was && isBusy(was) && now.state === 'idle' && !now.error && !open.includes(id)) (next ??= new Set(useFinished.getState().ids)).add(id)
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
    return () => {
      offLive()
      offUi()
    }
  }, [])
}
