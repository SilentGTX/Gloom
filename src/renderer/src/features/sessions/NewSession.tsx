import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronDown, Folder as FolderGlyph, FolderOpen, Inbox, ShieldAlert } from 'lucide-react'
import { flattenTree, folderDefaults, folderTrusted, normalizePath } from '@shared/library'
import { isEffort, isMode, type Effort, type ModeId } from '@shared/live'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from '../../components/ui/Menu'
import { useLibrary } from '../../stores/library'
import { useLive } from '../../stores/live'
import { focusComposer } from '../chat/Composer'
import { EffortPicker, effortsFor, ModelPicker, ModePicker } from '../chat/pickers'
import { useProjects } from '../folders/FilingRules'

/** "D:\JS\Gloom" → "Gloom", with the full path beside it in secondary ink. */
const lastPart = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/** A labelled row of a form, the label leading as in a Mac settings pane. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-x-3">
      <span className="text-right text-[13px] text-label-secondary">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

const fieldTrigger =
  'no-drag flex h-8 w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 text-left text-[13px] text-label outline-none shadow-[inset_0_0_0_0.5px_var(--separator-strong)] hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] data-[popup-open]:bg-fill-strong'

/** Where Claude works: your recent working folders, or any folder. */
export function WorkingFolderPicker({ value, onChange, allowNone }: { value: string | null; onChange(path: string | null): void; allowNone?: boolean }) {
  const projects = useProjects().slice(0, 10)
  const choose = async () => {
    const picked = await window.gloom?.pickFolder()
    if (picked) onChange(picked)
  }
  return (
    <MenuRoot>
      <MenuTrigger className={fieldTrigger} aria-label={`Working folder: ${value ?? 'none'}`}>
        <FolderGlyph size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
        {value ? (
          <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span className="shrink-0 font-medium">{lastPart(value)}</span>
            <span className="min-w-0 truncate text-[12px] text-label-secondary" title={value}>
              {value}
            </span>
          </span>
        ) : (
          <span className="flex-1 text-label-tertiary">{allowNone ? 'Ask each time' : 'Choose a folder'}</span>
        )}
        <ChevronDown size={12} strokeWidth={2.25} aria-hidden className="shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        {allowNone && <MenuItem label="Ask Each Time" disabled={!value} onClick={() => onChange(null)} />}
        {projects.map((p) => (
          <MenuItem key={p} label={`${lastPart(p)}  ·  ${p}`} icon={<FolderGlyph />} disabled={!!value && normalizePath(p) === normalizePath(value)} onClick={() => onChange(p)} />
        ))}
        {(projects.length > 0 || allowNone) && <MenuSeparator />}
        <MenuItem label="Choose Folder…" icon={<FolderOpen />} onClick={() => void choose()} />
      </MenuPopup>
    </MenuRoot>
  )
}

/** Where the session goes in your library: Unfiled or one of your folders. */
function PlacePicker({ value, onChange }: { value: string | null; onChange(folderId: string | null): void }) {
  const folders = useLibrary((s) => s.library.folders)
  const rows = flattenTree(folders, { all: true })
  const current = folders.find((f) => f.id === value)
  return (
    <MenuRoot>
      <MenuTrigger className={fieldTrigger} aria-label={`Place in: ${current?.name ?? 'Unfiled'}`}>
        {current ? <FolderGlyph size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" /> : <Inbox size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />}
        <span className="min-w-0 flex-1 truncate">{current?.name ?? 'Unfiled'}</span>
        <ChevronDown size={12} strokeWidth={2.25} aria-hidden className="shrink-0 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuItem label="Unfiled" icon={<Inbox />} disabled={value === null} onClick={() => onChange(null)} />
        {rows.length > 0 && <MenuSeparator />}
        {rows.map((r) => (
          <MenuItem key={r.folder.id} label={r.folder.name} icon={<FolderGlyph />} indent={r.depth} disabled={r.folder.id === value} onClick={() => onChange(r.folder.id)} />
        ))}
      </MenuPopup>
    </MenuRoot>
  )
}

/**
 * New Session (Ctrl+N): where Claude works, with which model, mode and
 * effort, and where the session goes in your library. A folder's defaults
 * fill it in. A folder Claude hasn't run in asks for your trust first: its
 * project hooks and MCP servers run without Claude Code's own trust prompt.
 */
export function NewSessionSheet() {
  const { open, folderId } = useLive((s) => s.newSession)
  const close = useLive((s) => s.closeNewSession)
  return (
    <Dialog open={open} onClose={close} title="New Session" description="Claude starts once you send your first message." width={480}>
      {open && <NewSessionForm initialFolder={folderId} onDone={close} />}
    </Dialog>
  )
}

function NewSessionForm({ initialFolder, onDone }: { initialFolder: string | null; onDone(): void }) {
  const library = useLibrary((s) => s.library)
  const sessions = useLibrary((s) => s.sessions)
  const settings = useLive((s) => s.settings)
  const models = useLive((s) => s.models)
  const projects = useProjects()
  const [place, setPlace] = useState<string | null>(initialFolder)
  const [cwd, setCwd] = useState<string | null>(null)
  const [model, setModel] = useState<string | null>(settings.model)
  const [mode, setMode] = useState<ModeId>(settings.mode)
  const [effort, setEffort] = useState<Effort | null>(settings.effort)
  const [busy, setBusy] = useState(false)

  // The folder's defaults (or its parents'), else Settings', else your last working folder.
  useEffect(() => {
    const d = folderDefaults(library.folders, place)
    setCwd(d.cwd ?? projects[0] ?? null)
    setModel(d.model ?? settings.model)
    setMode(isMode(d.mode) ? d.mode : settings.mode)
    // Only when the place changes: what you pick afterwards stands.
  }, [place])
  useEffect(() => {
    if (!cwd && projects[0]) setCwd(folderDefaults(library.folders, place).cwd ?? projects[0])
  }, [projects.length])

  const trusted = !cwd || folderTrusted(library, Object.values(sessions), cwd)
  const efforts = effortsFor(model, models)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!cwd || busy) return
    setBusy(true)
    if (!trusted) await useLibrary.getState().apply({ type: 'trustFolder', path: cwd }, { record: false })
    const id = await useLive.getState().create({ cwd, model, mode, effort: effort && efforts.includes(effort) ? effort : null }, place)
    setBusy(false)
    if (!id) return
    onDone()
    focusComposer()
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2.5">
      <Row label="Working folder">
        <WorkingFolderPicker value={cwd} onChange={setCwd} />
      </Row>
      <Row label="Model">
        <ModelPicker look="field" value={model} models={models} onChange={setModel} />
      </Row>
      <Row label="Mode">
        <ModePicker look="field" value={mode} onChange={setMode} />
      </Row>
      {efforts.length > 0 && (
        <Row label="Effort">
          <EffortPicker look="field" value={effort && isEffort(effort) ? effort : null} efforts={efforts} onChange={setEffort} />
        </Row>
      )}
      <Row label="Place in">
        <PlacePicker value={place} onChange={setPlace} />
      </Row>

      {!trusted && cwd && (
        <div role="note" className="mt-1 flex gap-2.5 rounded-[12px] bg-fill p-3 text-[12.5px] leading-snug">
          <ShieldAlert size={16} strokeWidth={1.75} aria-hidden className="mt-px shrink-0 text-[var(--warning)]" />
          <p className="text-label">
            <span className="font-semibold">Trust {lastPart(cwd)}?</span> Claude hasn’t worked here before. It can run this folder’s hooks and MCP servers and change its files.
            Only trust folders whose contents you know.
          </p>
        </div>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <Button size="text" tone="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="text" tone="primary" disabled={!cwd || busy}>
          {trusted ? 'Start Session' : 'Trust and Start'}
        </Button>
      </div>
    </form>
  )
}

/** A folder's defaults for New Session inside it (and its subfolders, unless they have their own). */
export function FolderDefaultsDialog({ folderId, onClose }: { folderId: string | null; onClose(): void }) {
  const folder = useLibrary((s) => (folderId ? s.library.folders.find((f) => f.id === folderId) : undefined))
  return (
    <Dialog open={!!folder} onClose={onClose} title={folder ? `New Sessions in ${folder.name}` : 'New Sessions'} description="New Session inside this folder starts with these. Its subfolders use them too, unless they have their own." width={480}>
      {folder && <DefaultsForm folderId={folder.id} onDone={onClose} />}
    </Dialog>
  )
}

function DefaultsForm({ folderId, onDone }: { folderId: string; onDone(): void }) {
  const folder = useLibrary((s) => s.library.folders.find((f) => f.id === folderId))
  const settings = useLive((s) => s.settings)
  const models = useLive((s) => s.models)
  const saved = folder?.defaults
  const [cwd, setCwd] = useState<string | null>(saved?.cwd ?? null)
  const [model, setModel] = useState<string | null>(saved?.model ?? settings.model)
  const [mode, setMode] = useState<ModeId>(isMode(saved?.mode) ? saved.mode : settings.mode)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    await useLibrary.getState().apply({ type: 'setFolderDefaults', id: folderId, defaults: { ...(cwd ? { cwd } : {}), ...(model ? { model } : {}), mode } }, { record: false })
    onDone()
  }
  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-2.5">
      <Row label="Working folder">
        <WorkingFolderPicker value={cwd} onChange={setCwd} allowNone />
      </Row>
      <Row label="Model">
        <ModelPicker look="field" value={model} models={models} onChange={setModel} />
      </Row>
      <Row label="Mode">
        <ModePicker look="field" value={mode} onChange={setMode} />
      </Row>
      <div className="mt-2 flex gap-2">
        <Button
          size="text"
          tone="secondary"
          onClick={() => {
            void useLibrary.getState().apply({ type: 'setFolderDefaults', id: folderId, defaults: null }, { record: false })
            onDone()
          }}
        >
          Clear
        </Button>
        <div className="flex-1" />
        <Button size="text" tone="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="text" tone="primary">
          Save
        </Button>
      </div>
    </form>
  )
}
