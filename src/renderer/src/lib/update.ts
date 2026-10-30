import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/ipc'

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    const api = window.gloom
    if (!api) return
    let alive = true
    void api.getUpdateState().then((s) => alive && setState(s))
    const off = api.onUpdateState(setState)
    return () => {
      alive = false
      off()
    }
  }, [])
  return state
}

/** The version Gloom was on last time it ran, recorded per launch. */
export function takeLastVersion(current: string): string | null {
  try {
    const last = localStorage.getItem('gloom.lastVersion')
    localStorage.setItem('gloom.lastVersion', current)
    return last
  } catch {
    return null
  }
}
