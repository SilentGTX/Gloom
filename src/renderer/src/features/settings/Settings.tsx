import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, CircleAlert, CircleCheck } from 'lucide-react'
import type { AppInfo } from '@shared/ipc'
import { isMode, type Settings as SettingsData } from '@shared/live'
import type { ShellId, ShellInfo } from '@shared/terminal'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuTrigger } from '../../components/ui/Menu'
import { cn } from '../../lib/cn'
import { runCommand } from '../../lib/commands'
import { useLive } from '../../stores/live'
import { useUi } from '../../stores/ui'
import { EffortPicker, effortsFor, ModelPicker, ModePicker } from '../chat/pickers'

type Pane = 'general' | 'claude' | 'about'
const PANES: { id: Pane; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'about', label: 'About' }
]

/** The pane you used last opens again. */
let lastPane: Pane = 'general'

const IDLE_CHOICES = [5, 10, 15, 30, 60, 0]
const idleLabel = (m: number) => (m === 0 ? 'Never' : m === 60 ? 'After 1 hour' : `After ${m} minutes`)

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-x-3 py-1.5">
      <span className="pt-[7px] text-right text-[13px] text-label-secondary">{label}</span>
      <div className="min-w-0">
        {children}
        {hint && <p className="mt-1 text-[11.5px] leading-snug text-label-secondary">{hint}</p>}
      </div>
    </div>
  )
}

/** A segmented control: one of a few, all in view. */
function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[9px] bg-fill-strong p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'no-drag h-[26px] rounded-[7px] px-3 text-[12.5px] outline-none transition-[background-color,box-shadow] duration-[var(--duration-press)] ease-out focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]',
            o.value === value ? 'bg-[var(--field)] font-medium text-label shadow-[0_0.5px_2px_rgb(0_0_0/0.15)]' : 'text-label-secondary hover:text-label'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <label className="flex cursor-default items-center gap-2 pt-[5px] text-[13px] text-label">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {label}
    </label>
  )
}

/**
 * Settings (Ctrl+,): what new sessions start with, how long an idle session's
 * process lives, notifications, the terminal's shell and appearance; then
 * Claude Code itself, and Gloom's version. Changes apply as you make them;
 * there's nothing to save.
 */
export function SettingsSheet() {
  const open = useLive((s) => s.settingsOpen)
  const setOpen = useLive((s) => s.setSettingsOpen)
  const [pane, setPane] = useState<Pane>(lastPane)
  useEffect(() => {
    if (open) setPane(lastPane)
  }, [open])
  const choose = (p: Pane) => {
    lastPane = p
    setPane(p)
  }
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Settings" width={560}>
      <div className="flex flex-col gap-4">
        <div className="flex justify-center">
          <Segmented label="Settings pane" value={pane} options={PANES.map((p) => ({ value: p.id, label: p.label }))} onChange={choose} />
        </div>
        <div className="min-h-[300px]">
          {pane === 'general' && <General />}
          {pane === 'claude' && <ClaudeCode />}
          {pane === 'about' && <About />}
        </div>
        <div className="flex justify-end">
          <Button size="text" tone="primary" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function General() {
  const settings = useLive((s) => s.settings)
  const models = useLive((s) => s.models)
  const update = (patch: Partial<SettingsData>) => void useLive.getState().updateSettings(patch)
  const glass = useUi((s) => s.glassAlways)
  const efforts = effortsFor(settings.model, models)
  return (
    <div>
      <h3 className="mb-1 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">New sessions</h3>
      <Row label="Model">
        <ModelPicker look="field" value={settings.model} models={models} onChange={(model) => update({ model })} />
      </Row>
      <Row label="Mode" hint="A folder’s own defaults come first.">
        <ModePicker look="field" value={settings.mode} onChange={(mode) => isMode(mode) && update({ mode })} />
      </Row>
      {efforts.length > 0 && (
        <Row label="Effort">
          <EffortPicker look="field" value={settings.effort} efforts={efforts} onChange={(effort) => update({ effort })} />
        </Row>
      )}
      <h3 className="mt-4 mb-1 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">Sessions</h3>
      <Row label="Close idle sessions" hint="Each running session is a Claude Code process with its own MCP servers. A closed one picks up again when you send it a message.">
        <MenuRoot>
          <MenuTrigger className="no-drag flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 text-left text-[13px] text-label shadow-[inset_0_0_0_0.5px_var(--separator-strong)] outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] data-[popup-open]:bg-fill-strong">
            <span className="flex-1">{idleLabel(settings.idleMinutes)}</span>
            <ChevronDown size={12} strokeWidth={2.25} aria-hidden className="shrink-0 opacity-60" />
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuRadioGroup value={String(settings.idleMinutes)} onChange={(v) => update({ idleMinutes: Number(v) })}>
              {IDLE_CHOICES.map((m) => (
                <MenuRadioItem key={m} value={String(m)} label={idleLabel(m)} />
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </MenuRoot>
      </Row>
      <Row label="Notifications">
        <Toggle checked={settings.notifications} onChange={(notifications) => update({ notifications })} label="When a session needs you or finishes in the background" />
      </Row>
      <h3 className="mt-4 mb-1 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">Terminal</h3>
      <Row label="Shell" hint="New terminals open with it; ones already open keep theirs.">
        <ShellPicker value={settings.shell} onChange={(shell) => update({ shell })} />
      </Row>
      <h3 className="mt-4 mb-1 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">Window</h3>
      <Row label="Appearance">
        <Segmented
          label="Appearance"
          value={settings.theme}
          options={[
            { value: 'system', label: 'Windows' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
          onChange={(theme) => update({ theme })}
        />
      </Row>
      <Row label="Glass" hint="Clear glass that lets the dusk show through, even when Windows’ transparency effects are off.">
        <Toggle checked={glass} onChange={() => runCommand('view.toggleGlass')} label="Always show glass" />
      </Row>
    </div>
  )
}

/** The shells installed here; one that isn't (PowerShell 7, Git Bash) isn't offered. */
function ShellPicker({ value, onChange }: { value: ShellId; onChange(shell: ShellId): void }) {
  const [shells, setShells] = useState<ShellInfo[]>([])
  useEffect(() => {
    void window.gloom?.terminal.shells().then(setShells)
  }, [])
  const current = shells.find((s) => s.id === value) ?? shells[0]
  return (
    <MenuRoot>
      <MenuTrigger className="no-drag flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 text-left text-[13px] text-label shadow-[inset_0_0_0_0.5px_var(--separator-strong)] outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] data-[popup-open]:bg-fill-strong">
        <span className="flex-1 truncate">{current?.label ?? 'Windows PowerShell'}</span>
        <ChevronDown size={12} strokeWidth={2.25} aria-hidden className="shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup value={current?.id ?? value} onChange={(v) => onChange(v as ShellId)}>
          {shells.map((s) => (
            <MenuRadioItem key={s.id} value={s.id} label={s.label} detail={s.path} />
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </MenuRoot>
  )
}

function ClaudeCode() {
  const claude = useLive((s) => s.claude)
  const settings = useLive((s) => s.settings)
  const refresh = async () => {
    const info = await window.gloom?.claude.info({ fresh: true })
    if (info) useLive.setState({ claude: info })
  }
  const locate = async () => {
    const path = await window.gloom?.claude.locate()
    if (!path) return
    await useLive.getState().updateSettings({ claudePath: path })
    await refresh()
  }
  return (
    <div>
      <Row label="Claude Code">
        {claude?.path ? (
          <div className="flex items-start gap-2 pt-[6px] text-[13px]">
            {claude.outdated ? <CircleAlert size={15} strokeWidth={1.75} className="mt-px shrink-0 text-[var(--warning)]" aria-hidden /> : <CircleCheck size={15} strokeWidth={1.75} className="mt-px shrink-0 text-[var(--added-text)]" aria-hidden />}
            <div className="min-w-0">
              <p>{claude.version ? `Version ${claude.version}` : 'Installed'}</p>
              <p className="truncate text-[11.5px] text-label-secondary" title={claude.path}>
                {claude.path}
              </p>
              {claude.outdated && (
                <p className="mt-1 text-[11.5px] leading-snug text-label-secondary">Gloom was made with Claude Code {claude.expected}. Update so the newest models and options work.</p>
              )}
            </div>
          </div>
        ) : (
          <p className="pt-[6px] text-[13px]">Not found. Install it, or choose its claude.exe.</p>
        )}
      </Row>
      <Row label="">
        <div className="flex flex-wrap gap-2">
          {claude?.path && (
            <Button size="text" tone={claude.outdated ? 'primary' : 'secondary'} onClick={() => void window.gloom?.claude.inTerminal('update')}>
              Update Claude Code…
            </Button>
          )}
          <Button size="text" tone="secondary" onClick={() => void locate()}>
            Choose claude.exe…
          </Button>
          {settings.claudePath && (
            <Button size="text" tone="secondary" onClick={() => void useLive.getState().updateSettings({ claudePath: null }).then(refresh)}>
              Use the Default
            </Button>
          )}
          <Button size="text" tone="secondary" onClick={() => void refresh()}>
            Check Again
          </Button>
        </div>
      </Row>
      <Row label="Account" hint="Gloom uses Claude Code’s own login, the same as your terminal’s.">
        <Button size="text" tone="secondary" className="mt-[2px]" onClick={() => void window.gloom?.claude.inTerminal('login')}>
          Log In…
        </Button>
      </Row>
    </div>
  )
}

function About() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    void window.gloom?.getAppInfo().then(setInfo)
  }, [])
  return (
    <div>
      <Row label="Gloom">
        <p className="pt-[6px] text-[13px]">{info ? `Version ${info.version}` : ''}</p>
      </Row>
      <Row label="">
        <Button size="text" tone="secondary" onClick={() => runCommand('help.checkUpdates')}>
          Check for Updates…
        </Button>
      </Row>
      {info && (
        <Row label="Built with">
          <p className="pt-[6px] text-[12px] text-label-secondary tabular">
            Electron {info.electron} · Chromium {info.chrome} · Node {info.node}
          </p>
        </Row>
      )}
    </div>
  )
}
