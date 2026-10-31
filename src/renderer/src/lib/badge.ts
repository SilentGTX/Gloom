// The taskbar badge: how many sessions wait for you, in Gloom's indigo. Main
// sets it on the taskbar button but has no canvas, so the window draws it.
import { useEffect } from 'react'
import { noticeLevel } from '@shared/live'
import { useLive } from '../stores/live'

function draw(count: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#5b5bd6'
  ctx.beginPath()
  ctx.arc(16, 16, 15, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${count > 9 ? 15 : 20}px "Segoe UI Variable Display", "Segoe UI", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(count > 9 ? '9+' : String(count), 16, 17)
  return canvas.toDataURL('image/png')
}

/** Sessions waiting for you, leaving out the kinds you turned off in Settings › Notifications. */
export function useWaitingBadge(): void {
  const waiting = useLive((s) => Object.values(s.sessions).filter((l) => l.state === 'waiting' && noticeLevel(s.settings, 'waiting', l.cards[0]) !== 'off').length)
  useEffect(() => {
    const api = window.gloom
    if (!api) return
    void api.setBadge(waiting, waiting ? draw(waiting) : null)
  }, [waiting])
}
