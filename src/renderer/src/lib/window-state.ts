import { useEffect, useState } from 'react'
import type { WindowState } from '@shared/ipc'

const FALLBACK_ACCENT = '#5b5bd6'

/** In a plain browser (layout previews) there is no main process to ask. */
function browserState(): WindowState {
  return {
    focused: document.hasFocus(),
    maximized: false,
    fullscreen: false,
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
    accent: FALLBACK_ACCENT,
    titleBarHeight: 44
  }
}

export function useWindowState(): WindowState {
  const [state, setState] = useState<WindowState>(browserState)
  useEffect(() => {
    const api = window.gloom
    if (api) {
      let alive = true
      void api.getWindowState().then((s) => alive && s && setState(s))
      const off = api.onWindowState(setState)
      return () => {
        alive = false
        off()
      }
    }
    const update = () => setState(browserState())
    const scheme = matchMedia('(prefers-color-scheme: dark)')
    window.addEventListener('focus', update)
    window.addEventListener('blur', update)
    scheme.addEventListener('change', update)
    return () => {
      window.removeEventListener('focus', update)
      window.removeEventListener('blur', update)
      scheme.removeEventListener('change', update)
    }
  }, [])
  return state
}

/** Mirrors the window state onto <html> so CSS can follow it. */
export function useApplyWindowState(state: WindowState): void {
  useEffect(() => {
    const root = document.documentElement
    root.dataset.focused = String(state.focused)
    root.dataset.maximized = String(state.maximized)
    root.style.setProperty('--accent', state.accent)
    root.style.setProperty('--on-accent', luminance(state.accent) > 0.45 ? '#000000' : '#ffffff')
    root.style.setProperty('--titlebar-h', `${state.titleBarHeight}px`)
  }, [state])
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}
