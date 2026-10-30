import { useEffect, useState, useSyncExternalStore } from 'react'
import type { UpdateScreen, UpdateState } from '@shared/ipc'
import cloud from '../assets/update.png'

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

let screen: UpdateScreen | null = null
const screenListeners = new Set<() => void>()

function setScreen(next: UpdateScreen | null) {
  screen = next
  for (const listener of screenListeners) listener()
}

/**
 * Learns what the update screen shows, and follows it from then on. main.tsx
 * waits for this before the first render, so a screen that's up at launch is
 * in the window's first frame, its cloud already decoded.
 */
export async function loadUpdateScreen(): Promise<void> {
  const api = window.gloom
  if (!api) return
  const decoded = Object.assign(new Image(), { src: cloud }).decode().catch(() => undefined)
  // Listening first: the answer is never older than a change that arrives before it.
  api.onUpdateScreen(setScreen)
  setScreen(await api.getUpdateScreen())
  await decoded
}

/** What the update screen shows, or null when it's down. */
export function useUpdateScreen(): UpdateScreen | null {
  return useSyncExternalStore(
    (listener) => {
      screenListeners.add(listener)
      return () => screenListeners.delete(listener)
    },
    () => screen
  )
}
