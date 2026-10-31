// Routines (File › Routines…): prompts Gloom runs on a schedule, each in a new
// session filed under Routines in the sidebar. The list says when each runs
// next; one opens to edit, Run Now starts it at once.
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { CalendarClock, ChevronDown, Play, Plus, Trash2 } from 'lucide-react'
import type { RoutineList } from '@shared/ipc'
import { describeSchedule, parseCron, type Routine } from '@shared/routines'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuTrigger } from '../../components/ui/Menu'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { notify } from '../../lib/toast'
import { useLive } from '../../stores/live'
import { useUi } from '../../stores/ui'
import { ModelPicker } from '../chat/pickers'

export const useRoutinesSheet = create<{ open: boolean }>(() => ({ open: false }))

const failure = (error: unknown) => String((error as Error)?.message ?? error).replace(/^.*?Error: /, '')

/** The schedules most routines want, as a choice; Custom takes a cron expression. */
const PRESETS: { value: string; label: string; cron: (time: string) => string | null }[] = [
  { value: 'daily', label: 'Every Day', cron: (t) => cronAt(t, '*') },
  { value: 'weekdays', label: 'Weekdays', cron: (t) => cronAt(t, '1-5') },
  { value: 'monday', label: 'Every Monday', cron: (t) => cronAt(t, '1') },
  { value: 'hourly', label: 'Every Hour', cron: () => '0 * * * *' },
  { value: 'manual', label: 'Only When I Start It', cron: () => null },
  { value: 'custom', label: 'Custom (cron)…', cron: () => null }
]

function cronAt(time: string, dow: string): string {
  const [h, m] = time.split(':').map(Number)
  return `${m || 0} ${h || 0} * * ${dow}`
}

/** Which preset a routine's cron is, and its time. */
function presetOf(cron: string | null): { preset: string; time: string } {
  if (!cron) return { preset: 'manual', time: '09:00' }
  const [mi, h, dom, mo, dow] = cron.split(/\s+/)
  const time = /^\d+$/.test(mi) && /^\d+$/.test(h) ? `${h.padStart(2, '0')}:${mi.padStart(2, '0')}` : '09:00'
  if (cron === '0 * * * *') return { preset: 'hourly', time }
  if (dom === '*' && mo === '*' && /^\d+$/.test(mi) && /^\d+$/.test(h)) {
    if (dow === '*') return { preset: 'daily', time }
    if (dow === '1-5') return { preset: 'weekdays', time }
    if (dow === '1') return { preset: 'monday', time }
  }
  return { preset: 'custom', time }
}

export function RoutinesSheet() {
  const open = useRoutinesSheet((s) => s.open)
  const [list, setList] = useState<RoutineList | null>(null)
  const [editing, setEditing] = useState<Partial<Routine> | null>(null)
  useEffect(() => {
    if (!open) return
    void window.gloom?.routines.list().then(setList)
    return window.gloom?.routines.onChanged(setList)
  }, [open])
  const close = () => {
    setEditing(null)
    useRoutinesSheet.setState({ open: false })
  }
  const run = async (r: Routine) => {
    try {
      const id = await window.gloom!.routines.run(r.id)
      notify(`Started “${r.name}”`, { action: { label: 'Show', onClick: () => useUi.getState().select([id]) } })
    } catch (error) {
      notify(failure(error))
    }
  }
  return (
    <Dialog open={open} onClose={close} title={editing ? (editing.id ? 'Edit Routine' : 'New Routine') : 'Routines'} width={600}>
      {editing ? (
        <RoutineForm routine={editing} onDone={() => setEditing(null)} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[12.5px] leading-snug text-label-secondary">Prompts Gloom runs on a schedule, each in a new session under Routines in the sidebar. They run while Gloom is open; a run missed while it was closed happens when it opens.</p>
          {!list?.routines.length ? (
            <EmptyState icon={<CalendarClock size={36} strokeWidth={1.25} />} title="No Routines">
              Make one for something Claude should do regularly: a morning summary, a nightly check.
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-1">
              {list.routines.map((r) => {
                const next = list.next[r.id]
                return (
                  <li key={r.id} className="flex items-center gap-2 rounded-[10px] bg-fill px-3 py-2">
                    <button type="button" onClick={() => setEditing(r)} className="no-drag min-w-0 flex-1 text-left outline-none focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]">
                      <span className={cn('block truncate text-[13px] font-medium', r.enabled ? 'text-label' : 'text-label-secondary')}>{r.name}</span>
                      <span className="block truncate text-[12px] text-label-secondary">
                        {describeSchedule(r)}
                        {!r.enabled ? ' · Off' : next ? ` · Next ${new Date(next).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
                      </span>
                    </button>
                    <Tooltip label="Run Now">
                      <Button size="small" aria-label={`Run ${r.name} now`} onClick={() => void run(r)}>
                        <Play size={12} strokeWidth={2} aria-hidden fill="currentColor" />
                      </Button>
                    </Tooltip>
                    <Tooltip label="Delete">
                      <Button size="small" aria-label={`Delete ${r.name}`} onClick={() => void window.gloom?.routines.remove(r.id)}>
                        <Trash2 size={12} strokeWidth={1.75} aria-hidden />
                      </Button>
                    </Tooltip>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex justify-between">
            <Button size="text" tone="secondary" onClick={() => setEditing({ cron: '0 9 * * 1-5', enabled: true, mode: 'default' })}>
              <Plus size={13} strokeWidth={2} aria-hidden /> New Routine
            </Button>
            <Button size="text" tone="primary" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function RoutineForm({ routine, onDone }: { routine: Partial<Routine>; onDone(): void }) {
  const models = useLive((s) => s.models)
  const [draft, setDraft] = useState<Partial<Routine>>(routine)
  const initial = presetOf(routine.cron ?? null)
  const [preset, setPreset] = useState(initial.preset)
  const [time, setTime] = useState(initial.time)
  const [custom, setCustom] = useState(routine.cron ?? '')
  const [error, setError] = useState<string | null>(null)
  const cron = preset === 'custom' ? custom.trim() || null : (PRESETS.find((p) => p.value === preset)?.cron(time) ?? null)
  const cronProblem = preset === 'custom' && custom.trim() && !parseCron(custom) ? 'Five fields: minute hour day month weekday, as in 0 9 * * 1-5.' : null
  const save = async () => {
    try {
      await window.gloom!.routines.save({ ...draft, cron, at: null })
      onDone()
    } catch (e) {
      setError(failure(e))
    }
  }
  const pick = async () => {
    const folder = await window.gloom?.pickFolder()
    if (folder) setDraft({ ...draft, cwd: folder })
  }
  const field = 'no-drag w-full rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 text-[13px] text-label outline-none shadow-[inset_0_0_0_0.5px_var(--separator-strong)] placeholder:text-label-tertiary focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]'
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-label-secondary">
        Name
        <input value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Morning summary" className={cn(field, 'h-8')} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-label-secondary">
        What each run does
        <textarea
          value={draft.prompt ?? ''}
          onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          rows={5}
          placeholder="Each run starts fresh, so say everything: what to look at, what to do, how to report."
          className={cn(field, 'resize-y py-2 leading-snug')}
        />
      </label>
      <div className="flex flex-col gap-1 text-[12px] text-label-secondary">
        Folder
        <div className="flex gap-2">
          <span className={cn(field, 'flex h-8 min-w-0 flex-1 items-center truncate font-mono text-[12px]')} title={draft.cwd}>
            {draft.cwd ?? 'Choose the folder it works in'}
          </span>
          <Button size="text" tone="secondary" onClick={() => void pick()}>
            Choose…
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 text-[12px] text-label-secondary">
          When
          <MenuRoot>
            <MenuTrigger className={cn(field, 'flex h-8 w-44 items-center gap-2 text-left hover:bg-fill-strong data-[popup-open]:bg-fill-strong')}>
              <span className="flex-1 truncate">{PRESETS.find((p) => p.value === preset)?.label}</span>
              <ChevronDown size={12} strokeWidth={2.25} aria-hidden className="opacity-60" />
            </MenuTrigger>
            <MenuPopup align="start">
              <MenuRadioGroup value={preset} onChange={setPreset}>
                {PRESETS.map((p) => (
                  <MenuRadioItem key={p.value} value={p.value} label={p.label} />
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </MenuRoot>
        </div>
        {['daily', 'weekdays', 'monday'].includes(preset) && (
          <label className="flex flex-col gap-1 text-[12px] text-label-secondary">
            At
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(field, 'h-8 w-28')} />
          </label>
        )}
        {preset === 'custom' && (
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] text-label-secondary">
            cron (local time)
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="0 9 * * 1-5" spellCheck={false} aria-invalid={!!cronProblem} className={cn(field, 'h-8 font-mono')} />
          </label>
        )}
        <div className="flex flex-col gap-1 text-[12px] text-label-secondary">
          Model
          <ModelPicker look="field" value={draft.model ?? null} models={models} onChange={(model) => setDraft({ ...draft, model })} />
        </div>
      </div>
      {cronProblem && <p className="text-[12px] text-[var(--removed-text)]">{cronProblem}</p>}
      <label className="flex items-center gap-2 text-[13px] text-label">
        <input type="checkbox" checked={draft.enabled !== false} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="size-4 accent-[var(--accent)]" />
        On
      </label>
      {error && (
        <p role="alert" className="text-[12.5px] text-[var(--removed-text)]">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button size="text" tone="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button size="text" tone="primary" type="submit" disabled={!!cronProblem}>
          Save
        </Button>
      </div>
    </form>
  )
}
