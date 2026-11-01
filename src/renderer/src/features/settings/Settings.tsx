import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, CircleAlert, CircleCheck } from 'lucide-react'
import type { AppInfo } from '@shared/ipc'
import { branchPrefixProblem, isMode, TRANSCRIPT_VIEWS, type NoticeLevel, type Settings as SettingsData } from '@shared/live'
import type { ShellId, ShellInfo } from '@shared/terminal'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuTrigger } from '../../components/ui/Menu'
import { cn } from '../../lib/cn'
import { runCommand } from '../../lib/commands'
import { useLive } from '../../stores/live'
import { useUi } from '../../stores/ui'
import { EffortPicker, effortsFor, ModelPicker, ModePicker } from '../chat/pickers'
import { PetsPane } from './PetsPane'

export type Pane = 'general' | 'sessions' | 'notifications' | 'pets' | 'claude' | 'about'
const PANES: { id: Pane; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'pets', label: 'Pets' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'about', label: 'About' }
]

/** The pane you used last opens again. */
let lastPane: Pane = 'general'

/** Opens Settings on a pane (the pet's menu opens it on Pets). */
export function openSettings(pane: Pane): void {
  lastPane = pane
  const live = useLive.getState()
  // Already open on another pane: it switches.
  if (live.settingsOpen) live.setSettingsOpen(false)
  requestAnimationFrame(() => useLive.getState().setSettingsOpen(true))
}

const IDLE_CHOICES = [5, 10, 15, 30, 60, 0]
const idleLabel = (m: number) => (m === 0 ? 'Never' : m === 60 ? 'After 1 hour' : `After ${m} minutes`)
/** The days the Claude app's picker offers. */
const ARCHIVE_CHOICES = [0, 1, 2, 7, 14, 30]
const archiveLabel = (d: number) => (d === 0 ? 'Never' : d === 1 ? 'After 1 day' : `After ${d} days`)
/** The output styles Claude Code comes with, until a session lists yours too. */
const BUILT_IN_STYLES = ['Concise', 'Explanatory', 'Learning', 'Proactive']


const LEVELS: { value: NoticeLevel; label: string; detail: string }[] = [
  { value: 'banner', label: 'Banners', detail: 'A notification and the taskbar badge' },
  { value: 'badge', label: 'Badge Only', detail: 'Only the count on the taskbar button' },
  { value: 'off', label: 'Off', detail: 'Nothing' }
]

const FIELD =
  'no-drag flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 text-left text-[13px] text-label shadow-[inset_0_0_0_0.5px_var(--separator-strong)] outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] data-[popup-open]:bg-fill-strong'

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
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

function Heading({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return <h3 className={cn('mb-1 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary', !first && 'mt-4')}>{children}</h3>
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

/** A checkbox: one setting on or off (macOS's choice for a single setting). `indent` shows it depends on the one above. */
function Toggle({ checked, onChange, label, disabled = false, indent = false }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean; indent?: boolean }) {
  return (
    <label className={cn('flex cursor-default items-center gap-2 pt-[5px] text-[13px]', disabled ? 'text-label-tertiary' : 'text-label', indent && 'pl-6')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="size-4 accent-[var(--accent)]" />
      {label}
    </label>
  )
}

/** A pop-up button: one of several, the chosen one shown. */
function Choice<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; detail?: string }[]; onChange(v: T): void; label: string }) {
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <MenuRoot>
      <MenuTrigger aria-label={`${label}: ${current?.label ?? ''}`} className={FIELD}>
        <span className="flex-1 truncate">{current?.label}</span>
        <ChevronDown size={12} strokeWidth={2.25} aria-hidden className="shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup value={String(value)} onChange={(v) => onChange((typeof value === 'number' ? Number(v) : v) as T)}>
          {options.map((o) => (
            <MenuRadioItem key={String(o.value)} value={String(o.value)} label={o.label} detail={o.detail} />
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </MenuRoot>
  )
}

/**
 * Settings (Ctrl+,): what new sessions start with, sessions and their
 * worktrees, notifications, the terminal's shell and appearance; then Claude
 * Code itself, and Gloom's version. Changes apply as you make them; there's
 * nothing to save.
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
    <Dialog open={open} onClose={() => setOpen(false)} title="Settings" width={600}>
      <div className="flex flex-col gap-4">
        <div className="flex justify-center">
          <Segmented label="Settings pane" value={pane} options={PANES.map((p) => ({ value: p.id, label: p.label }))} onChange={choose} />
        </div>
        <div className="min-h-[340px]">
          {pane === 'general' && <General />}
          {pane === 'sessions' && <Sessions />}
          {pane === 'notifications' && <Notifications />}
          {pane === 'pets' && <PetsPane />}
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

const update = (patch: Partial<SettingsData>) => void useLive.getState().updateSettings(patch)

function General() {
  const settings = useLive((s) => s.settings)
  const models = useLive((s) => s.models)
  // Your own styles too, once a session's Claude Code has listed them.
  const listed = useLive((s) => [...new Set(Object.values(s.sessions).flatMap((l) => l.outputStyles ?? []))].join('\n'))
  const styles = [...new Set([...BUILT_IN_STYLES, ...listed.split('\n').filter((x) => x && x.toLowerCase() !== 'default')])]
  const glass = useUi((s) => s.glassAlways)
  const design = useUi((s) => s.design)
  const efforts = effortsFor(settings.model, models)
  return (
    <div>
      <Heading first>New sessions</Heading>
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
      <Row label="Output style" hint="How Claude writes its replies. A session can have its own in the inspector.">
        <Choice
          label="Output style"
          value={settings.outputStyle ?? ''}
          options={[{ value: '', label: 'Your Claude Code Setting', detail: 'Whatever ~/.claude/settings.json says' }, ...styles.map((s) => ({ value: s, label: s }))]}
          onChange={(v) => update({ outputStyle: v || null })}
        />
      </Row>
      <Row label="Suggestions" hint="Each suggestion is one more small request, made from the conversation Claude already has.">
        <Toggle checked={settings.promptSuggestions} onChange={(promptSuggestions) => update({ promptSuggestions })} label="Suggest a next prompt after each reply" />
      </Row>
      <Row label="Remote Control" hint="Carry on from claude.ai or the Claude app on your phone while Gloom runs the session here.">
        <Toggle checked={settings.remoteControl} onChange={(remoteControl) => update({ remoteControl })} label="Connect new sessions to Remote Control" />
      </Row>
      <Heading>Window</Heading>
      <Row label="Design" hint="Concept: a quiet neutral window with an inspector beside the chat. Classic: the dusk, with the diff and terminal as panes.">
        <Segmented
          label="Design"
          value={design}
          options={[
            { value: 'concept', label: 'Concept' },
            { value: 'classic', label: 'Classic' }
          ]}
          onChange={(next) => runCommand(next === 'concept' ? 'view.designConcept' : 'view.designClassic')}
        />
      </Row>
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
      <Heading>Terminal</Heading>
      <Row label="Shell" hint="New terminals open with it; ones already open keep theirs.">
        <ShellPicker value={settings.shell} onChange={(shell) => update({ shell })} />
      </Row>
    </div>
  )
}

function Sessions() {
  const settings = useLive((s) => s.settings)
  return (
    <div>
      <Heading first>Sessions</Heading>
      <Row label="Close idle sessions" hint="Each running session is a Claude Code process with its own MCP servers. A closed one picks up again when you send it a message.">
        <Choice label="Close idle sessions" value={settings.idleMinutes} options={IDLE_CHOICES.map((m) => ({ value: m, label: idleLabel(m) }))} onChange={(idleMinutes) => update({ idleMinutes })} />
      </Row>
      <Row label="Archive inactive" hint="Sessions with no activity for this long go to Archived. Never one that’s running, pinned or unread; a worktree with uncommitted changes stays on disk.">
        <Choice label="Archive inactive sessions" value={settings.archiveAfterDays} options={ARCHIVE_CHOICES.map((d) => ({ value: d, label: archiveLabel(d) }))} onChange={(archiveAfterDays) => update({ archiveAfterDays })} />
      </Row>
      <Row label="Pull requests">
        <Toggle checked={settings.archiveOnPrClose} onChange={(archiveOnPrClose) => update({ archiveOnPrClose })} label="Archive a session when its pull request merges or closes" />
      </Row>
      <Row label="Sleep" hint="Only idle sleep: closing the lid still sleeps.">
        <Toggle checked={settings.keepAwake} onChange={(keepAwake) => update({ keepAwake })} label="Keep the computer awake while Claude works" />
        <Toggle checked={settings.keepAwakeOnBattery} disabled={!settings.keepAwake} indent onChange={(keepAwakeOnBattery) => update({ keepAwakeOnBattery })} label="On battery power too" />
      </Row>
      <Row label="Conversations" hint="How a conversation shows when you open it; View › Transcript View changes the open one.">
        <Segmented label="Transcript view" value={settings.transcriptView} options={TRANSCRIPT_VIEWS.map((v) => ({ value: v.id, label: v.label }))} onChange={(transcriptView) => update({ transcriptView })} />
      </Row>
      <Heading>Worktrees</Heading>
      <Row label="Branch prefix" hint={<>New sessions’ branches are named <span className="font-mono">{settings.branchPrefix}/quiet-moon</span>.</>}>
        <PrefixField value={settings.branchPrefix} />
      </Row>
      <Row label="Location">
        <WorktreeLocation folder={settings.worktreeFolder} />
      </Row>
    </div>
  )
}

/** The branch prefix, checked as you type; it's kept once it's valid and you leave the field (or press Enter). */
function PrefixField({ value }: { value: string }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const problem = branchPrefixProblem(draft.trim())
  const commit = () => {
    const next = draft.trim()
    if (!branchPrefixProblem(next) && next !== value) update({ branchPrefix: next })
    else if (branchPrefixProblem(next)) setDraft(value)
  }
  return (
    <div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape' && draft !== value) {
            e.stopPropagation()
            setDraft(value)
          }
        }}
        spellCheck={false}
        aria-label="Branch prefix"
        aria-invalid={!!problem}
        aria-describedby={problem ? 'prefix-problem' : undefined}
        className={cn(FIELD, 'font-mono', problem && 'shadow-[inset_0_0_0_1px_var(--removed-text)]')}
      />
      {problem && (
        <p id="prefix-problem" role="alert" className="mt-1 flex items-center gap-1 text-[11.5px] text-[var(--removed-text)]">
          <CircleAlert size={12} strokeWidth={2} aria-hidden />
          {problem}
        </p>
      )}
    </div>
  )
}

function WorktreeLocation({ folder }: { folder: string | null }) {
  const choose = async () => {
    const picked = await window.gloom?.pickFolder()
    if (picked) update({ worktreeFolder: picked })
  }
  return (
    <div>
      <Choice
        label="Worktree location"
        value={folder ? 'own' : 'project'}
        options={[
          { value: 'project', label: 'Inside the Project', detail: '<repo>/.claude/worktrees, as the Claude app does' },
          { value: 'own', label: 'In a Folder of Your Own…', detail: '<folder>/<repository>/<name>' }
        ]}
        onChange={(v) => (v === 'project' ? update({ worktreeFolder: null }) : void choose())}
      />
      {folder && (
        <div className="mt-1.5 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-label-secondary" title={folder}>
            {folder}
          </p>
          <Button size="text" tone="secondary" onClick={() => void choose()}>
            Change…
          </Button>
        </div>
      )}
    </div>
  )
}

function Notifications() {
  const settings = useLive((s) => s.settings)
  return (
    <div>
      <Heading first>When Gloom is in the background</Heading>
      <Row label="Permission requests" hint="Claude asks to use a tool, or has a plan for you to review.">
        <Choice label="Permission requests" value={settings.notifyPermission} options={LEVELS} onChange={(notifyPermission) => update({ notifyPermission })} />
      </Row>
      <Row label="Questions" hint="Claude asks you to choose between options.">
        <Choice label="Questions" value={settings.notifyQuestion} options={LEVELS} onChange={(notifyQuestion) => update({ notifyQuestion })} />
      </Row>
      <Row label="Claude finishes" hint="A turn ends, or stops with an error.">
        <Choice label="Claude finishes" value={settings.notifyFinished} options={LEVELS.filter((l) => l.value !== 'badge')} onChange={(v) => update({ notifyFinished: v === 'off' ? 'off' : 'banner' })} />
      </Row>
      <Heading>Banners</Heading>
      <Row label="Sound">
        <Toggle checked={settings.notifySound} onChange={(notifySound) => update({ notifySound })} label="Play Windows’ notification sound" />
      </Row>
      <Row label="Taskbar">
        <Toggle checked={settings.flashTaskbar} onChange={(flashTaskbar) => update({ flashTaskbar })} label="Flash Gloom’s taskbar button" />
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
      <MenuTrigger className={FIELD}>
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
      <Heading>SSH connections</Heading>
      <SshHosts />
    </div>
  )
}

/**
 * Machines a session can run on, over your own ssh (its config and keys, so
 * a Host from ~/.ssh/config works): New Session › Runs On offers them. Claude
 * Code must be installed there, and ssh must connect without a password prompt.
 */
function SshHosts() {
  const hosts = useLive((s) => s.settings.sshHosts)
  const [host, setHost] = useState('')
  const [name, setName] = useState('')
  const valid = /^[\w.@-]+$/.test(host.trim()) && !host.trim().startsWith('-')
  const add = () => {
    if (!valid) return
    update({ sshHosts: [...hosts, { id: crypto.randomUUID().slice(0, 8), name: name.trim() || host.trim(), host: host.trim(), claude: null }] })
    setHost('')
    setName('')
  }
  return (
    <div>
      {hosts.map((h) => (
        <Row key={h.id} label={h.name}>
          <div className="flex items-center gap-2 pt-[3px]">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-label-secondary">ssh {h.host}</span>
            <Button size="text" tone="secondary" onClick={() => update({ sshHosts: hosts.filter((x) => x.id !== h.id) })}>
              Remove
            </Button>
          </div>
        </Row>
      ))}
      <Row label="Add" hint="A Host from ~/.ssh/config, or user@host. Claude Code needs to be installed there, and ssh to connect without asking for a password.">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Connection name" className={cn(FIELD, 'w-28')} />
          <input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="mac-mini or me@host"
            aria-label="SSH host"
            spellCheck={false}
            className={cn(FIELD, 'min-w-0 flex-1 font-mono')}
          />
          <Button size="text" tone="secondary" disabled={!valid} onClick={add}>
            Add
          </Button>
        </div>
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
