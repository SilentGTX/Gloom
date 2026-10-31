// "Tell Claude What to Do…" on the concept's permission card: the composer
// takes the note ("Tell Claude what to do instead"), and sending it denies the
// request with that note. Esc there, or the card going, lets it go.
import { create } from 'zustand'

export interface Noting {
  sessionId: string
  requestId: string
}

export const useNoting = create<{ card: Noting | null }>(() => ({ card: null }))

export function startNoting(card: Noting): void {
  useNoting.setState({ card })
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-composer]')?.focus())
}

export function stopNoting(): void {
  if (useNoting.getState().card) useNoting.setState({ card: null })
}
