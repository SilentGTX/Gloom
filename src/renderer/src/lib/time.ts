// How the session list and details show times.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "Now", "12m", "3h", "4d", then a date after a week ("Oct 21", with the year if it isn't this one). */
export function relativeTime(ms: number, now: number): string {
  const ago = Math.max(0, now - ms)
  if (ago < MINUTE) return 'Now'
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m`
  if (ago < DAY) return `${Math.floor(ago / HOUR)}h`
  if (ago < 7 * DAY) return `${Math.floor(ago / DAY)}d`
  const date = new Date(ms)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Oct 21, 2026 at 4:05 PM", for details and tooltips. */
export function fullDate(ms: number): string {
  const date = new Date(ms)
  return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}
