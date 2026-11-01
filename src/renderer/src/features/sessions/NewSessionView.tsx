// A new session, as the Claude app starts one: no dialog, the chat itself.
// Gloom's cloud over the places you've worked, the composer ready to type,
// and under it where the session runs and whether it gets a worktree. Nothing
// is made until the first message goes (stores/live.ts › startDraft).
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Popover } from '@base-ui/react/popover'
import { Check, ChevronDown, ChevronRight, Cloud, FolderOpen, GitBranch, Laptop, Plus, Search, ShieldAlert, SquareTerminal } from 'lucide-react'
import { folderTrusted } from '@shared/library'
import cloud from '../../assets/update.png'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { useLibrary } from '../../stores/library'
import { useLive } from '../../stores/live'
import { useConcept } from '../concept/parts'
import { envKey, envLabel, lastPart, matchesEnv, recentEnvironments, sameEnv, type Environment } from './environments'

/** The places you've worked, newest first, kept current. */
function useEnvironments(): Environment[] {
  const sessions = useLibrary((s) => s.sessions)
  const entries = useLibrary((s) => s.library.sessions)
  const hosts = useLive((s) => s.settings.sshHosts)
  return useMemo(() => recentEnvironments(Object.values(sessions), entries, hosts), [sessions, entries, hosts])
}

function EnvIcon({ env, className }: { env: Environment; className?: string }) {
  const Icon = env.kind === 'ssh' ? SquareTerminal : env.kind === 'cloud' ? Cloud : Laptop
  return <Icon size={14} strokeWidth={1.75} aria-hidden className={cn('shrink-0', className)} />
}

const choose = (env: Environment) => useLive.getState().setNewDraft({ env })

/** Picks a folder with the system's dialog, as somewhere new to work. */
async function chooseFolder(): Promise<void> {
  const picked = await window.gloom?.pickFolder()
  if (picked) choose({ kind: 'local', cwd: picked })
}

// ─── The screen ─────────────────────────────────────────────────────────────

/**
 * What the chat shows for a session not started yet: Gloom's cloud, then the
 * last three places you worked (the one it'll run in checked), and Choose
 * Environment for the rest. The composer sits at the foot, ready to type.
 */
export function NewSessionView() {
  const reduce = useReducedMotion()
  const concept = useConcept()
  const draft = useLive((s) => s.newDraft)
  const hosts = useLive((s) => s.settings.sshHosts)
  const folder = useLibrary((s) => (draft?.folderId ? s.library.folders.find((f) => f.id === draft.folderId) : undefined))
  const all = useEnvironments()
  // The current one stays in the list, even when it's older than the last three (a folder's default, say).
  const recent = useMemo(() => {
    const top = all.slice(0, 3)
    return draft?.env && !top.some((e) => sameEnv(e, draft.env)) ? [draft.env, ...top.slice(0, 2)] : top
  }, [all, draft?.env])
  if (!draft) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6" style={{ paddingBottom: 'var(--composer-space)' }}>
      <motion.div
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
        className="flex w-full max-w-[340px] flex-col items-center"
      >
        <img src={cloud} alt="" draggable={false} className="pointer-events-none mb-3 h-14 w-auto select-none" />
        <h2 className="sr-only">New Session</h2>
        {folder && <p className="mb-2 text-[12.5px] text-label-secondary">Files into {folder.name}</p>}
        <section aria-label="Where Claude works" className={cn('w-full rounded-[14px] p-1 text-[13px] text-label', concept ? 'concept-composer' : 'glass-strong')}>
          <div className="relative z-[2] flex flex-col">
            {recent.length === 0 && <p className="px-2.5 py-2 text-label-secondary">Choose a folder for Claude to work in.</p>}
            {recent.map((env) => {
              const { name, detail } = envLabel(env, hosts)
              const current = sameEnv(env, draft.env)
              return (
                <button
                  key={envKey(env)}
                  type="button"
                  aria-pressed={current}
                  title={detail}
                  onClick={() => choose(env)}
                  className="no-drag flex h-8 items-center gap-2.5 rounded-[9px] px-2.5 text-left outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)]"
                >
                  <EnvIcon env={env} className="text-label-secondary" />
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  {current && <Check size={14} strokeWidth={2.25} aria-hidden className="shrink-0 text-accent-text" />}
                </button>
              )
            })}
            <span aria-hidden className="mx-2 my-1 h-px bg-separator" />
            <EnvironmentPicker side="bottom" align="start">
              <span className="flex h-8 items-center gap-1.5 px-2.5 text-label-secondary">
                Choose Environment
                <ChevronDown size={12} strokeWidth={2.25} aria-hidden className="opacity-70" />
              </span>
            </EnvironmentPicker>
          </div>
        </section>
      </motion.div>
    </div>
  )
}

// ─── Choose Environment ─────────────────────────────────────────────────────

type Item = { key: string; env?: Environment; action?: () => void; label: string; detail?: string; icon: ReactNode; trailing?: ReactNode }

const popupClass = [
  'glass-strong w-[320px] max-h-[min(460px,var(--available-height))] overflow-hidden rounded-[var(--radius-popover)] text-[13px] text-label outline-none',
  'origin-[var(--transform-origin)] transition-[transform,opacity] duration-[var(--duration-menu)] ease-out',
  'data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[ending-style]:duration-[120ms]',
  'motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[ending-style]:scale-100'
].join(' ')

/**
 * Every place a session can run, as one list you search as you type: your
 * folders here (the rest behind More), Claude in the cloud, your SSH
 * connections, and a folder you haven't worked in. One popover, no cascade.
 */
export function EnvironmentPicker({ children, side, align, className, label = 'Choose environment' }: { children: ReactNode; side: 'top' | 'bottom'; align: 'start' | 'center'; className?: string; label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={label}
        className={cn('no-drag flex min-w-0 items-center rounded-[9px] text-left outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)] data-[popup-open]:bg-fill-strong', className)}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side={side} align={align} sideOffset={6} collisionPadding={8} className="z-50 outline-none">
          <Popover.Popup aria-label="Environments" className={popupClass}>
            {open && <EnvironmentList onDone={() => setOpen(false)} />}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

function EnvironmentList({ onDone }: { onDone(): void }) {
  const draft = useLive((s) => s.newDraft)
  const hosts = useLive((s) => s.settings.sshHosts)
  const all = useEnvironments()
  const [query, setQuery] = useState('')
  const [more, setMore] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const pick = (env: Environment) => {
    choose(env)
    onDone()
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-composer]')?.focus())
  }
  const item = (env: Environment): Item => {
    const { name, detail } = envLabel(env, hosts)
    return { key: envKey(env), env, label: name, detail, icon: <EnvIcon env={env} />, trailing: sameEnv(env, draft?.env) ? <Check size={14} strokeWidth={2.25} aria-hidden className="text-accent-text" /> : undefined }
  }

  const searching = query.trim().length > 0
  const locals = all.filter((e) => e.kind === 'local' && matchesEnv(e, query, hosts))
  const shownLocals = searching || more ? locals : locals.slice(0, 3)
  // The cloud runs from a folder's repository: the folder chosen here, else your last one.
  const base = draft?.env?.kind === 'local' ? draft.env.cwd : (all.find((e) => e.kind === 'local')?.cwd ?? null)
  const cloudEnv: Environment | null = base ? { kind: 'cloud', cwd: base } : null
  const sshes = all.filter((e) => e.kind === 'ssh' && matchesEnv(e, query, hosts))

  const sections: { title: string; items: Item[] }[] = [
    {
      title: 'This Computer',
      items: [
        ...shownLocals.map(item),
        ...(!searching && !more && locals.length > 3
          ? [{ key: 'more', action: () => setMore(true), label: 'More', icon: <ChevronRight size={14} strokeWidth={2} aria-hidden />, trailing: <span className="text-[12px] text-label-secondary tabular">{locals.length - 3}</span> }]
          : [])
      ]
    },
    { title: 'Cloud', items: cloudEnv && matchesEnv(cloudEnv, query, hosts) ? [item(cloudEnv)] : [] },
    { title: 'SSH', items: sshes.map(item) },
    {
      title: '',
      items: [
        { key: 'choose', action: () => void chooseFolder().then(onDone), label: 'Choose Folder…', icon: <FolderOpen size={14} strokeWidth={1.75} aria-hidden /> },
        {
          key: 'ssh-settings',
          action: () => {
            onDone()
            useLive.getState().setSettingsOpen(true)
          },
          label: 'Add SSH Connection…',
          icon: <Plus size={14} strokeWidth={1.75} aria-hidden />
        }
      ]
    }
  ].filter((s) => s.items.length > 0)
  const flat = sections.flatMap((s) => s.items)
  const at = Math.min(highlight, flat.length - 1)
  const take = (i: Item) => (i.env ? pick(i.env) : i.action?.())

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((at + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (flat[at]) take(flat[at])
    }
  }

  let index = -1
  return (
    <div className="relative z-[2] flex max-h-[inherit] flex-col">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 shadow-[inset_0_-0.5px_0_var(--separator)]">
        <Search size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHighlight(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Search environments"
          aria-label="Search environments"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={flat[at] ? `${listId}-${at}` : undefined}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-label outline-none placeholder:text-label-tertiary"
        />
      </div>
      <div id={listId} role="listbox" aria-label="Environments" className="min-h-0 overflow-y-auto p-1.5">
        {flat.length === 0 && <p className="px-2 py-2 text-label-secondary">No environment matches.</p>}
        {sections.map((s, si) => (
          <div key={si} role="group" aria-label={s.title || 'More choices'} className={cn(si > 0 && 'mt-1 border-t border-separator pt-1')}>
            {s.title && <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">{s.title}</p>}
            {s.items.map((i) => {
              index++
              const me = index
              return (
                <div
                  key={i.key}
                  id={`${listId}-${me}`}
                  role="option"
                  aria-selected={me === at}
                  onPointerMove={() => me !== at && setHighlight(me)}
                  onClick={() => take(i)}
                  className={cn('flex min-h-8 cursor-default items-center gap-2.5 rounded-[7px] px-2 py-1 select-none', me === at && 'bg-fill-strong')}
                >
                  <span className="flex shrink-0 text-label-secondary">{i.icon}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{i.label}</span>
                    {i.detail && i.env?.kind !== 'local' && <span className="truncate text-[11.5px] text-label-secondary">{i.detail}</span>}
                  </span>
                  {i.trailing}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Under the composer ─────────────────────────────────────────────────────

const chip =
  'no-drag flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-label-secondary outline-none transition-[background-color,color] duration-[var(--duration-press)] hover:bg-fill-strong hover:text-label focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] data-[popup-open]:bg-fill-strong data-[popup-open]:text-label'

/**
 * Under a new session's composer, as the Claude app has it: where it runs
 * (choose another here too), and in a git repository whether it works on a
 * branch of its own. On an SSH connection, the folder there.
 */
export function DraftBar() {
  const draft = useLive((s) => s.newDraft)
  const hosts = useLive((s) => s.settings.sshHosts)
  const env = draft?.env ?? null
  const cwd = env?.kind === 'local' ? env.cwd : null
  // Whether the folder's in a repository (and isn't a worktree already): only then is there a worktree to offer.
  useEffect(() => {
    let alive = true
    useLive.getState().setNewDraft({ repo: null })
    if (cwd) void window.gloom?.git.repo(cwd).then((repo) => alive && useLive.getState().setNewDraft({ repo }))
    return () => {
      alive = false
    }
  }, [cwd])
  if (!draft) return null
  const offers = !!cwd && !!draft.repo && !draft.repo.worktree
  const host = env?.kind === 'ssh' ? hosts.find((h) => h.id === env.host) : undefined
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5 px-1.5">
      <EnvironmentPicker side="top" align="start" className={chip} label={env ? `Environment: ${envLabel(env, hosts).name}` : 'Choose environment'}>
        {env ? <EnvIcon env={env} /> : <Laptop size={14} strokeWidth={1.75} aria-hidden />}
        <span className="truncate">{env ? (env.kind === 'ssh' ? (host?.name ?? env.host) : env.kind === 'cloud' ? `Cloud · ${lastPart(env.cwd)}` : lastPart(env.cwd)) : 'Choose Environment'}</span>
      </EnvironmentPicker>
      {env?.kind === 'ssh' && (
        <label className={cn(chip, 'cursor-text gap-1 hover:bg-transparent')}>
          <span className="sr-only">Folder on {host?.name ?? env.host}</span>
          <FolderOpen size={14} strokeWidth={1.75} aria-hidden />
          <input
            value={env.cwd}
            onChange={(e) => useLive.getState().setNewDraft({ env: { ...env, cwd: e.target.value || '~' } })}
            spellCheck={false}
            size={Math.max(4, Math.min(28, env.cwd.length + 1))}
            className="bg-transparent font-mono text-[12px] text-label outline-none"
          />
        </label>
      )}
      {offers && (
        <Tooltip label={draft.worktree ? 'Works on a branch of its own, in .claude/worktrees' : 'Works in the folder itself'}>
          <button type="button" aria-pressed={draft.worktree} onClick={() => useLive.getState().setNewDraft({ worktree: !draft.worktree })} className={cn(chip, draft.worktree && 'text-label')}>
            <GitBranch size={14} strokeWidth={1.75} aria-hidden className={cn(draft.worktree && 'text-accent-text')} />
            <span className={cn(!draft.worktree && 'line-through decoration-label-tertiary')}>Worktree</span>
          </button>
        </Tooltip>
      )}
      {env?.kind === 'cloud' && <span className="px-1.5 text-[12px] text-label-secondary">Your message is the task; it runs on claude.ai.</span>}
    </div>
  )
}

/** Above a new session's composer, when it runs in a folder Claude hasn't worked in: sending trusts it. */
export function TrustNote() {
  const env = useLive((s) => s.newDraft?.env)
  const library = useLibrary((s) => s.library)
  const sessions = useLibrary((s) => s.sessions)
  if (env?.kind !== 'local' || folderTrusted(library, Object.values(sessions), env.cwd)) return null
  return (
    <div role="note" className="glass-strong flex gap-2.5 rounded-[14px] px-3 py-2.5 text-[12.5px] leading-snug">
      <ShieldAlert size={16} strokeWidth={1.75} aria-hidden className="relative z-[2] mt-px shrink-0 text-[var(--warning)]" />
      <p className="relative z-[2] text-label">
        <span className="font-semibold">Claude hasn’t worked in {lastPart(env.cwd)} before.</span> Sending your first message trusts it: Claude can run its hooks and MCP servers and change its files.
      </p>
    </div>
  )
}
