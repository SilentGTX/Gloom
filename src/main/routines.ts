// Routines Gloom runs: kept in routines.json in userData, checked every half
// minute while Gloom is open. A due routine starts a new session in its folder
// with its prompt (filed under Routines in the sidebar); a run missed while
// Gloom was closed happens once, at launch, as the Claude app's scheduled
// tasks do.
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { isMode, type ModeId } from '@shared/live'
import { dueRoutines, nextRun, parseCron, type Routine } from '@shared/routines'

const TICK_MS = 30_000

export interface RoutineHost {
  /** Starts a session in `cwd` with the prompt; resolves to its ID. */
  run(routine: Routine): Promise<string>
  changed(routines: Routine[]): void
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** A routine as saved, or as the window or Claude sent it: what's valid, or why not. */
export function cleanRoutine(raw: unknown, existing?: Routine): Routine {
  if (!isObj(raw)) throw new Error('bad routine')
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : ''
  const prompt = typeof raw.prompt === 'string' ? raw.prompt.slice(0, 50_000) : ''
  const cwd = typeof raw.cwd === 'string' ? raw.cwd : ''
  if (!name) throw new Error('Give the routine a name.')
  if (!prompt.trim()) throw new Error('Give the routine a prompt: what each run should do.')
  if (!cwd || !isAbsolute(cwd)) throw new Error('Choose the folder it works in.')
  const cron = typeof raw.cron === 'string' && raw.cron.trim() ? raw.cron.trim() : null
  if (cron && !parseCron(cron)) throw new Error(`“${cron}” isn’t a schedule: five fields, minute hour day month weekday.`)
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : null
  if (cron && at) throw new Error('A routine runs on a schedule or once, not both.')
  return {
    id: existing?.id ?? (typeof raw.id === 'string' && raw.id ? raw.id : randomUUID()),
    name,
    prompt,
    cwd,
    model: typeof raw.model === 'string' && raw.model ? raw.model.slice(0, 200) : null,
    mode: isMode(raw.mode) ? raw.mode : 'default',
    cron,
    at,
    enabled: raw.enabled !== false,
    lastRun: existing?.lastRun ?? null,
    lastSession: existing?.lastSession ?? null,
    created: existing?.created ?? Date.now()
  }
}

export class Routines {
  private list: Routine[] = []
  private file = ''
  private timer: ReturnType<typeof setInterval> | null = null
  private running = new Set<string>()

  constructor(private readonly host: RoutineHost) {}

  load(): void {
    this.file = join(app.getPath('userData'), 'routines.json')
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
        const items = isObj(raw) && Array.isArray(raw.routines) ? raw.routines : []
        this.list = items.flatMap((r: unknown) => {
          try {
            const clean = cleanRoutine(r)
            const keep = r as Partial<Routine>
            return [{ ...clean, lastRun: typeof keep.lastRun === 'number' ? keep.lastRun : null, lastSession: typeof keep.lastSession === 'string' ? keep.lastSession : null, created: typeof keep.created === 'number' ? keep.created : clean.created }]
          } catch {
            return []
          }
        })
      }
    } catch {
      // Unreadable: none, and the next change writes a good file.
    }
  }

  start(): void {
    this.timer ??= setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref?.()
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  all(): Routine[] {
    return this.list
  }

  /** Adds a routine, or changes one (by id). */
  save(raw: unknown): Routine {
    const id = isObj(raw) && typeof raw.id === 'string' ? raw.id : null
    const existing = id ? this.list.find((r) => r.id === id) : undefined
    const routine = cleanRoutine(raw, existing)
    this.list = existing ? this.list.map((r) => (r.id === routine.id ? routine : r)) : [...this.list, routine]
    this.persist()
    return routine
  }

  remove(id: string): boolean {
    const before = this.list.length
    this.list = this.list.filter((r) => r.id !== id)
    if (this.list.length !== before) this.persist()
    return this.list.length !== before
  }

  /** Runs one now (Run Now, or Claude's run_routine). */
  async runNow(id: string): Promise<string> {
    const routine = this.list.find((r) => r.id === id)
    if (!routine) throw new Error('No such routine.')
    return this.fire(routine)
  }

  /** When each runs next, for the window. */
  nextRuns(now = Date.now()): Record<string, number | null> {
    return Object.fromEntries(this.list.map((r) => [r.id, nextRun(r, now)]))
  }

  private async tick(): Promise<void> {
    for (const routine of dueRoutines(this.list, Date.now())) {
      if (this.running.has(routine.id)) continue
      await this.fire(routine).catch((error: unknown) => console.warn(`Gloom: routine ${routine.name} didn’t start:`, error))
    }
  }

  private async fire(routine: Routine): Promise<string> {
    this.running.add(routine.id)
    try {
      // Marked run first, so a failure doesn't fire it again every half minute.
      this.list = this.list.map((r) => (r.id === routine.id ? { ...r, lastRun: Date.now(), ...(r.at !== null ? { enabled: false } : {}) } : r))
      this.persist()
      const session = await this.host.run(routine)
      this.list = this.list.map((r) => (r.id === routine.id ? { ...r, lastSession: session } : r))
      this.persist()
      return session
    } finally {
      this.running.delete(routine.id)
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file + '.tmp', JSON.stringify({ version: 1, routines: this.list }, null, 1))
      renameSync(this.file + '.tmp', this.file)
    } catch (error) {
      console.error('Gloom: couldn’t save routines:', error)
    }
    this.host.changed(this.list)
  }
}

export type { ModeId }
