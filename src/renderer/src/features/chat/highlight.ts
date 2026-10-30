// The window's side of syntax highlighting: one worker for every code block,
// a cache so a block scrolled back into view doesn't ask again, and plain text
// for blocks too big to be worth it.
import { useEffect, useState } from 'react'
import { resolveLanguage } from './languages'

/** A line of tokens: text, its colour (a CSS variable), and font style bits (1 italic, 2 bold). */
export type Token = [content: string, color: string, fontStyle: number]

export interface HighlightRequest {
  id: number
  code: string
  lang: string
}

export interface HighlightReply {
  id: number
  lines: Token[][] | null
}

const MAX_CHARS = 120_000
const MAX_LINES = 4_000
const CACHE_SIZE = 300

let worker: Worker | null = null
let failed = false
let nextId = 1
const waiting = new Map<number, (lines: Token[][] | null) => void>()
const cache = new Map<string, Token[][] | null>()

function getWorker(): Worker | null {
  if (worker || failed) return worker
  try {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<HighlightReply>) => {
      waiting.get(data.id)?.(data.lines)
      waiting.delete(data.id)
    }
    worker.onerror = () => {
      // Highlighting is a nicety: without the worker, code stays plain.
      failed = true
      worker = null
      for (const done of waiting.values()) done(null)
      waiting.clear()
    }
  } catch {
    failed = true
  }
  return worker
}

function remember(key: string, lines: Token[][] | null): void {
  cache.delete(key)
  cache.set(key, lines)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
}

/** Highlighted lines for a block, or null to show it plain. */
export function useHighlight(code: string, lang: string | undefined): Token[][] | null {
  const key = `${lang ?? ''}\u0000${code}`
  const worth = !!lang && !!resolveLanguage(lang) && code.length <= MAX_CHARS && code.split('\n', MAX_LINES + 1).length <= MAX_LINES
  // Kept with the block it belongs to, so a changed block never shows another's colours.
  const [state, setState] = useState<{ key: string; lines: Token[][] | null }>(() => ({ key, lines: cache.get(key) ?? null }))

  useEffect(() => {
    if (!worth || cache.has(key)) return
    const w = getWorker()
    if (!w) return
    let alive = true
    const id = nextId++
    waiting.set(id, (lines) => {
      remember(key, lines)
      if (alive) setState({ key, lines })
    })
    const request: HighlightRequest = { id, code, lang: lang! }
    w.postMessage(request)
    return () => {
      alive = false
    }
  }, [key, worth, code, lang])

  if (!worth) return null
  return state.key === key ? state.lines : (cache.get(key) ?? null)
}
