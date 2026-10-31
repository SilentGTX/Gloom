// Routines: prompts Gloom runs on a schedule, each in a new session, as the
// Claude app's scheduled tasks and the Routines section of its sidebar. A
// schedule is a 5-field cron expression in local time, or one moment; a
// routine with neither runs only when you start it. Pure, shared by main
// (which runs them) and the window (which lists and edits them).

export interface Routine {
  id: string
  name: string
  /** What the new session is told, whole: each run starts fresh. */
  prompt: string
  /** The folder the session works in. */
  cwd: string
  model: string | null
  mode: string
  /** Five fields, local time ("0 9 * * 1-5"), or null. */
  cron: string | null
  /** One moment (ms), instead of cron. */
  at: number | null
  enabled: boolean
  /** When it last ran (ms), and the session that run made. */
  lastRun: number | null
  lastSession: string | null
  created: number
}

const FIELDS: [min: number, max: number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7] // day of week (0 and 7 are Sunday)
]

/** One cron field as the set of values it allows, or null when it isn't valid. */
function field(text: string, [min, max]: [number, number]): Set<number> | null {
  const out = new Set<number>()
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part.trim())
    if (!m) return null
    const step = m[4] ? Number(m[4]) : 1
    const from = m[1] === '*' ? min : Number(m[2])
    const to = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : from
    if (step < 1 || from < min || to > max || from > to) return null
    for (let v = from; v <= to; v += step) out.add(v)
  }
  return out
}

export interface Cron {
  minute: Set<number>
  hour: Set<number>
  dom: Set<number>
  month: Set<number>
  dow: Set<number>
  /** cron's rule: with both day fields restricted, either may match. */
  domAny: boolean
  dowAny: boolean
}

/** A cron expression parsed, or null when it isn't one. */
export function parseCron(expr: string): Cron | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const sets = parts.map((p, i) => field(p, FIELDS[i]))
  if (sets.some((s) => !s)) return null
  const [minute, hour, dom, month, dow] = sets as Set<number>[]
  if (dow.has(7)) dow.add(0)
  return { minute, hour, dom, month, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' }
}

function matches(c: Cron, d: Date): boolean {
  if (!c.minute.has(d.getMinutes()) || !c.hour.has(d.getHours()) || !c.month.has(d.getMonth() + 1)) return false
  const dom = c.dom.has(d.getDate())
  const dow = c.dow.has(d.getDay())
  if (c.domAny && c.dowAny) return true
  if (c.domAny) return dow
  if (c.dowAny) return dom
  return dom || dow
}

/** The first minute after `after` the expression matches (local time), within a year; null when none. */
export function nextCron(expr: string, after: number): number | null {
  const c = parseCron(expr)
  if (!c) return null
  const d = new Date(after)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (matches(c, d)) return d.getTime()
    d.setMinutes(d.getMinutes() + 1)
  }
  return null
}

/** When a routine runs next: its moment (until it ran), its cron's next minute after it last ran or was made; null when it doesn't. */
export function nextRun(r: Routine, now: number): number | null {
  if (!r.enabled) return null
  if (r.at !== null) return r.lastRun === null ? r.at : null
  if (!r.cron) return null
  // From the last run (or its making): a run missed while Gloom was closed is due at once, and only once.
  void now
  return nextCron(r.cron, r.lastRun ?? r.created)
}

/** Routines due now: their next run has come (a run missed while Gloom was closed comes once, at launch). */
export function dueRoutines(routines: readonly Routine[], now: number): Routine[] {
  return routines.filter((r) => {
    const next = nextRun(r, now)
    return next !== null && next <= now
  })
}

/** "Weekdays at 9:00", "Every hour", "Once, Nov 2 at 3:00 PM", or the cron itself. */
export function describeSchedule(r: Pick<Routine, 'cron' | 'at'>): string {
  if (r.at !== null) return `Once, ${new Date(r.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
  if (!r.cron) return 'When you start it'
  const [mi, h, dom, mo, dow] = r.cron.trim().split(/\s+/)
  const time = /^\d+$/.test(mi) && /^\d+$/.test(h) ? new Date(2000, 0, 1, Number(h), Number(mi)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : null
  if (mi === '0' && h === '*' && dom === '*' && mo === '*' && dow === '*') return 'Every hour'
  if (/^\*\/\d+$/.test(mi) && h === '*' && dom === '*' && mo === '*' && dow === '*') return `Every ${mi.slice(2)} minutes`
  if (time && dom === '*' && mo === '*' && dow === '*') return `Every day at ${time}`
  if (time && dom === '*' && mo === '*' && dow === '1-5') return `Weekdays at ${time}`
  const days = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
  if (time && dom === '*' && mo === '*' && /^[0-7]$/.test(dow)) return `${days[Number(dow) % 7]} at ${time}`
  if (time && /^\d+$/.test(dom) && mo === '*' && dow === '*') return `Monthly on day ${dom} at ${time}`
  return `cron ${r.cron}`
}
