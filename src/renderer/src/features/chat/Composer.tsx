import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { ArrowUp, CircleAlert, Lock, Paperclip, Square, X, Zap } from 'lucide-react'
import type { SessionMeta } from '@shared/library'
import type { CanSend, CommandInfo, LiveSummary } from '@shared/live'
import { Button } from '../../components/ui/Button'
import { Tooltip } from '../../components/ui/Tooltip'
import { cn } from '../../lib/cn'
import { setComposerSpace } from '../../lib/composer-space'
import { runCommand } from '../../lib/commands'
import { useNow } from '../../lib/now'
import { notify } from '../../lib/toast'
import { isBusy, useElsewhere, useLive, type Draft, type DraftImage } from '../../stores/live'
import { stopNoting, useNoting } from '../concept/noting'
import { useConcept } from '../concept/parts'
import { ContextMeter } from './ContextMeter'
import { insertMention, mentionAt, prepareFiles, rankFiles, type PreparedFiles } from './mentions'
import { EffortPicker, effortsFor, ModelPicker, ModePicker } from './pickers'
import { TurnFurniture } from './Furniture'
import { PromptCards } from './PromptCards'
import { EditBanner } from './Rewind'
import { CommandRow, FileRow, Suggestions } from './Suggestions'

/** Images Claude can read, and how big one may be. */
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const IMAGE_MAX = 5 * 1024 * 1024
/** The box grows with what you write up to this share of the window, then scrolls. */
const MAX_HEIGHT = 0.4

/** Puts the keyboard in the composer (after New Session, say). */
export function focusComposer(): void {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[data-composer]')?.focus())
}

function readImage(file: File): Promise<DraftImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve({ key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, name: file.name || 'Pasted image', mediaType: file.type, data: url.slice(url.indexOf(',') + 1) })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Adds files to the draft: images ride along as pictures; anything else goes
 * in as its path, which Claude reads with its own tools.
 */
async function attach(sessionId: string, files: File[]): Promise<void> {
  const images: DraftImage[] = []
  const paths: string[] = []
  for (const file of files) {
    if (IMAGE_TYPES.has(file.type)) {
      if (file.size > IMAGE_MAX) {
        notify(`${file.name} is over 5 MB, too big to send.`)
        continue
      }
      images.push(await readImage(file))
    } else {
      const path = window.gloom?.pathForFile(file)
      if (path) paths.push(path)
    }
  }
  const s = useLive.getState()
  const draft = s.draft(sessionId)
  const text = paths.length ? [draft.text.trimEnd(), paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ')].filter(Boolean).join(draft.text.trim() ? ' ' : '') + ' ' : draft.text
  s.setDraft(sessionId, { text, images: [...draft.images, ...images] })
}

/**
 * The composer, floating over the transcript's foot: prompt cards above it,
 * then what you write, with the session's mode, model and effort beside Send.
 * Enter sends; Shift+Enter starts a new line; while Claude works a message
 * waits its turn, and Esc stops the turn.
 */
export function Composer({ sessionId, meta }: { sessionId: string; meta: SessionMeta | undefined }) {
  const stack = useRef<HTMLDivElement>(null)
  const summary = useLive((s) => s.sessions[sessionId])
  const concept = useConcept()
  const claude = useLive((s) => s.claude)
  const now = useNow(5_000)
  const elsewhere = useElsewhere(meta, now) && !isBusy(summary)
  const [can, setCan] = useState<CanSend | null>(null)

  // The space it takes, for the transcript to scroll clear of it.
  useLayoutEffect(() => {
    const el = stack.current
    if (!el) return
    // On the chat, not the whole document: a change restyles only what's under it.
    const root = el.closest('main') ?? document.documentElement
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--composer-space', `${el.offsetHeight}px`)
      setComposerSpace(el.offsetHeight)
      window.dispatchEvent(new Event('gloom:composer'))
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.setProperty('--composer-space', '0px')
      setComposerSpace(0)
    }
  }, [])

  const cwd = summary?.cwd ?? meta?.cwd
  // Asked again after the folder is made again.
  const [recreated, setRecreated] = useState(0)
  useEffect(() => {
    let alive = true
    setCan(null)
    void window.gloom?.live.check(sessionId).then((result) => alive && setCan(result))
    return () => {
      alive = false
    }
  }, [sessionId, cwd, claude?.path, !!summary, recreated])
  // Claude Code only finds a session from its own folder, so it carries on once the folder is back
  // (a worktree comes back from its branch).
  const recreate = async () => {
    const ok = await window.gloom?.live.recreate(sessionId).catch(() => false)
    if (ok) setRecreated((n) => n + 1)
    else notify('Couldn’t make the folder again.')
  }
  const action = (kind: Extract<CanSend, { ok: false }>['kind']) =>
    kind === 'not-installed'
      ? { label: 'Settings…', run: () => useLive.getState().setSettingsOpen(true) }
      : kind === 'missing-folder' && cwd
        ? { label: 'Recreate Folder', run: () => void recreate() }
        : undefined

  return (
    <div ref={stack} data-pane="composer" className={cn('pointer-events-none absolute inset-x-0 bottom-0 z-[4] px-4 @[560px]:px-6', concept ? 'pb-5' : 'pb-4')}>
      <div className="composer-edge" aria-hidden />
      <div className="pointer-events-auto relative mx-auto flex w-full max-w-[720px] flex-col gap-2">
        {/* Under the latest message: the task list Claude keeps, and its next-step box once a turn ends. */}
        <TurnFurniture sessionId={sessionId} />
        {/* The concept puts Claude's requests at the end of the conversation instead. */}
        {summary && !concept && <PromptCards sessionId={sessionId} summary={summary} />}
        {can && !can.ok ? (
          <Notice icon={<CircleAlert size={15} strokeWidth={1.75} />} text={can.reason} path={can.path} action={action(can.kind)} />
        ) : elsewhere ? (
          <Notice icon={<Lock size={15} strokeWidth={1.75} />} text="Running in another app. Messages wait until it’s been quiet for a minute." action={{ label: 'Take Over', run: () => useLive.getState().takeOver(sessionId) }} />
        ) : (
          <>
            {summary && <Problems summary={summary} />}
            <EditBanner sessionId={sessionId} />
            <Box sessionId={sessionId} summary={summary} ready={can?.ok === true} />
          </>
        )}
      </div>
    </div>
  )
}

/** A capsule in the composer's place, saying why you can't write here, with what you can do about it. */
function Notice({ icon, text, path, action }: { icon: React.ReactNode; text: string; path?: string; action?: { label: string; run(): void } }) {
  return (
    <div role="status" className="glass-strong flex min-h-11 items-center gap-2.5 rounded-[18px] py-1.5 pr-1.5 pl-3.5 text-[13px] text-label">
      <span className="relative z-[2] shrink-0 text-label-secondary">{icon}</span>
      <span className="relative z-[2] flex min-w-0 flex-1 flex-col">
        <span>{text}</span>
        {path && <PathLine path={path} />}
      </span>
      {action && (
        <Button size="text" tone="secondary" className="relative z-[2] rounded-full" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

/**
 * A path on one line, cut in the middle when it doesn't fit: paths differ at
 * their ends, so the folder's own name always shows. The whole path on hover.
 */
function PathLine({ path }: { path: string }) {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) + 1
  return (
    <span title={path} className="flex min-w-0 text-[12px] text-label-secondary select-text">
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{path.slice(0, cut)}</span>
      {/* Never gives way to the folders before it; cut only when it alone is too long. */}
      <span className="max-w-full shrink-0 overflow-hidden text-ellipsis whitespace-nowrap">{path.slice(cut)}</span>
    </span>
  )
}

/** What went wrong in the last turn, and the one thing to do about it. */
function Problems({ summary }: { summary: LiveSummary }) {
  const usage = useLive((s) => s.usage)
  const [details, setDetails] = useState(false)
  const error = summary.error
  if (usage?.status === 'rejected') {
    const reset = usage.fiveHour?.resetsAt ?? usage.weekly?.resetsAt
    const at = reset ? new Date(reset).toLocaleString(undefined, { weekday: reset - Date.now() > 86_400_000 ? 'short' : undefined, hour: 'numeric', minute: '2-digit' }) : null
    return <Banner text={`You’ve reached your plan’s usage limit.${at ? ` It resets ${at}.` : ''}`} />
  }
  if (!error) return null
  return (
    <Banner
      text={error.message}
      action={
        error.kind === 'login'
          ? { label: 'Log In…', run: () => void window.gloom?.claude.inTerminal('login') }
          : error.detail
            ? { label: details ? 'Hide Details' : 'Details', run: () => setDetails(!details) }
            : undefined
      }
      detail={details ? error.detail : undefined}
    />
  )
}

function Banner({ text, action, detail }: { text: string; action?: { label: string; run(): void }; detail?: string }) {
  return (
    <div role="alert" className="glass-strong rounded-[14px] px-3.5 py-2 text-[13px] text-label">
      <div className="relative z-[2] flex items-center gap-2">
        <CircleAlert size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-[var(--warning)]" />
        <span className="min-w-0 flex-1">{text}</span>
        {action && (
          <button type="button" onClick={action.run} className="no-drag shrink-0 rounded-[6px] px-1.5 font-medium text-accent-text outline-none hover:bg-fill-strong focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]">
            {action.label}
          </button>
        )}
      </div>
      {detail && <pre className="code-text relative z-[2] mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-label-secondary select-text">{detail}</pre>}
    </div>
  )
}

/** Gloom's own slash command: the pet. Listed beside the CLI's, and never sent to the CLI. */
const PET_SLASH = '/pet'
const PET_COMMAND: CommandInfo = { name: 'pet', description: 'Show or hide the pet', argumentHint: '' }

/** The commands that start with what you've typed after the slash. */
function useCommands(sessionId: string, query: string | null): CommandInfo[] {
  const [all, setAll] = useState<CommandInfo[] | null>(null)
  useEffect(() => setAll(null), [sessionId])
  useEffect(() => {
    if (query === null || all) return
    let alive = true
    void window.gloom?.live.commands(sessionId).then((list) => alive && setAll(list))
    return () => {
      alive = false
    }
  }, [sessionId, query === null, all])
  return useMemo(() => {
    if (query === null || !all) return []
    const q = query.toLowerCase()
    const list = all.some((c) => c.name === PET_COMMAND.name) ? all : [PET_COMMAND, ...all]
    const starts = list.filter((c) => c.name.toLowerCase().startsWith(q))
    const contains = list.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))
    return [...starts, ...contains].slice(0, 50)
  }, [all, query])
}

/**
 * The files and folders `@` offers: asked for when the box gets the keyboard,
 * so they're there by the time you type an `@`, and again as each `@` starts,
 * for files made since (main keeps a listing a few seconds). The last ones
 * show while new ones come.
 */
function useFiles(sessionId: string, focused: boolean, mentionStart: number | null): PreparedFiles | null {
  const [files, setFiles] = useState<{ id: string; prepared: PreparedFiles } | null>(null)
  const last = useRef<{ id: string; focused: boolean; start: number | null } | null>(null)
  useEffect(() => {
    const before = last.current
    last.current = { id: sessionId, focused, start: mentionStart }
    const other = before?.id !== sessionId
    const gained = focused && (other || !before.focused)
    const started = mentionStart !== null && (other || mentionStart !== before.start)
    if (!gained && !started) return
    window.gloom?.live.files(sessionId).then(
      (listing) => last.current?.id === sessionId && setFiles({ id: sessionId, prepared: prepareFiles(listing) }),
      (error: unknown) => console.warn('Gloom: listing files:', error)
    )
  }, [sessionId, focused, mentionStart])
  return files?.id === sessionId ? files.prepared : null
}

/**
 * Fast mode, as the Claude app's composer switch: a button that stays held in
 * while it's on (Apple's toggle outside a list). Faster output on models that
 * offer it, billed at fast-mode rates; it holds for the session's process and
 * the next. When the service can't serve it, the button says why.
 */
function FastToggle({ sessionId, summary }: { sessionId: string; summary: LiveSummary | undefined }) {
  const on = !!summary?.fast
  const cooling = on && summary?.fastState === 'cooldown'
  const blocked = on ? (summary?.fastUnavailable ?? null) : null
  const tip = blocked ?? (cooling ? 'Fast mode is cooling down after a limit; standard speed meanwhile' : on ? 'Fast mode is on: faster output, at fast-mode rates' : 'Fast mode: faster output, at fast-mode rates')
  return (
    <Tooltip label={tip}>
      <button
        type="button"
        aria-pressed={on}
        aria-label="Fast mode"
        onClick={() => void useLive.getState().set(sessionId, { fast: !on })}
        className={cn(
          'no-drag flex h-7 items-center gap-1 rounded-full px-2 text-[12.5px] outline-none select-none transition-[transform,background-color,color] duration-[var(--duration-press)] ease-out focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)] active:scale-[0.97] motion-reduce:active:scale-100',
          on ? 'bg-[var(--accent-fill)] font-medium text-accent-text' : 'text-label-secondary hover:bg-fill-strong hover:text-label',
          (blocked || cooling) && 'opacity-60'
        )}
      >
        <Zap size={13} strokeWidth={1.75} aria-hidden fill={on ? 'currentColor' : 'none'} />
        <span className="@max-[520px]:hidden">Fast</span>
      </button>
    </Tooltip>
  )
}

/** Where a collapsed selection is; a selection that spans text has no caret. */
const caretOf = (el: HTMLTextAreaElement) => (el.selectionStart === el.selectionEnd ? el.selectionStart : null)

/** The glass box you write in. */
function Box({ sessionId, summary, ready }: { sessionId: string; summary: LiveSummary | undefined; ready: boolean }) {
  const draft = useLive((s) => s.drafts[sessionId]) ?? EMPTY
  const settings = useLive((s) => s.settings)
  const models = useLive((s) => s.models)
  const area = useRef<HTMLTextAreaElement>(null)
  const files = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const busy = isBusy(summary)
  const canSend = ready && (!!draft.text.trim() || draft.images.length > 0)
  // "Tell Claude What to Do…" on the concept's card: what you write here denies the request with it.
  const noting = useNoting((s) => (s.card?.sessionId === sessionId && summary?.cards.some((c) => c.requestId === s.card?.requestId) ? s.card : null))
  const concept = useConcept()
  useEffect(() => {
    // The card went (answered, or the turn stopped): the box is for messages again.
    const card = useNoting.getState().card
    if (card?.sessionId === sessionId && !noting) stopNoting()
  }, [noting, sessionId])

  const model = summary ? summary.model : settings.model
  const mode = summary?.mode ?? settings.mode
  const effort = summary ? summary.effort : settings.effort
  const efforts = effortsFor(model, models)
  // Fast mode, for a model that offers it (or a session already running fast, to turn it off).
  const fastOffered = !!summary?.fast || models.some((m) => m.fast && (m.value === model || m.value === summary?.activeModel))
  // A suggested next prompt (Settings › General): shown in the empty box, Tab takes it.
  const suggestion = !noting && !busy && !draft.text && !draft.images.length && summary?.suggestion ? summary.suggestion : null

  // "/com" at the start, before any space: the slash commands that match.
  const slash = /^\/(\S*)$/.exec(draft.text)?.[1] ?? null
  const [menuClosed, setMenuClosed] = useState(false)
  const commands = useCommands(sessionId, menuClosed ? null : slash)
  const menuOpen = !menuClosed && slash !== null && commands.length > 0
  useEffect(() => {
    if (slash === null) setMenuClosed(false)
  }, [slash])

  // "@src/co" where the caret is: the files and folders that match (mentions.ts).
  const [caret, setCaret] = useState<number | null>(null)
  const mention = useMemo(() => (caret === null || slash !== null ? null : mentionAt(draft.text, caret)), [draft.text, caret, slash])
  // The caret is only known while the box has the keyboard.
  const listing = useFiles(sessionId, caret !== null, mention?.start ?? null)
  const query = mention?.query ?? null
  const found = useMemo(() => (query !== null && listing ? rankFiles(listing, query) : []), [listing, query])
  // Esc puts the list away until what's typed after the `@` changes, as in Claude Code.
  const mentionKey = mention ? `${mention.start}:${mention.query}` : null
  const [dismissed, setDismissed] = useState<string | null>(null)
  const filesOpen = mentionKey !== null && found.length > 0 && dismissed !== mentionKey
  const pendingCaret = useRef<number | null>(null)

  // The row Tab or Enter takes: the first, each time what's typed changes, until the arrows or the pointer move it.
  const listKey = slash !== null ? `/${slash}` : (mentionKey ?? '')
  const [pointed, setPointed] = useState({ key: '', index: 0 })
  const highlight = pointed.key === listKey ? Math.min(pointed.index, Math.max(0, (menuOpen ? commands.length : found.length) - 1)) : 0
  const setHighlight = (index: number) => {
    if (index !== highlight || pointed.key !== listKey) setPointed({ key: listKey, index })
  }

  // The box grows with what you write, up to a share of the window.
  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * MAX_HEIGHT))}px`
  }, [draft.text])
  // After a pick, the caret goes after what it put in.
  useLayoutEffect(() => {
    const at = pendingCaret.current
    if (at === null || !area.current) return
    pendingCaret.current = null
    area.current.setSelectionRange(at, at)
  }, [draft.text])

  const setText = (text: string) => useLive.getState().setDraft(sessionId, { ...useLive.getState().draft(sessionId), text })
  const send = () => {
    // /pet is Gloom's own: it shows or hides the pet, and never goes to the CLI.
    if (!noting && draft.text.trim() === PET_SLASH) {
      setText('')
      runCommand('view.togglePet')
      return
    }
    if (!canSend) return
    if (noting) {
      const note = draft.text.trim()
      if (!note) return
      stopNoting()
      setText('')
      void useLive.getState().answer(sessionId, { kind: 'permission', requestId: noting.requestId, decision: 'deny', note })
      return
    }
    void useLive.getState().send(sessionId)
  }
  const stop = () => void useLive.getState().stop(sessionId)
  const complete = (command: CommandInfo) => {
    setText(`/${command.name} `)
    setMenuClosed(true)
    area.current?.focus()
  }
  const pick = (path: string) => {
    if (!mention) return
    const next = insertMention(draft.text, mention, path)
    pendingCaret.current = next.caret
    setCaret(next.caret)
    setText(next.text)
    area.current?.focus()
  }

  // The list that's up takes the arrows, Tab, Enter and Esc.
  const list = menuOpen
    ? { size: commands.length, take: () => complete(commands[highlight] ?? commands[0]), close: () => setMenuClosed(true) }
    : filesOpen
      ? { size: found.length, take: () => pick(found[highlight] ?? found[0]), close: () => setDismissed(mentionKey) }
      : null

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (list) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlight((highlight + (e.key === 'ArrowDown' ? 1 : -1) + list.size) % list.size)
        return
      }
      // Shift+Tab still moves the keyboard back, out of the box.
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault()
        list.take()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        list.close()
        return
      }
    }
    if (e.key === 'Tab' && !e.shiftKey && suggestion) {
      e.preventDefault()
      setText(suggestion)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape' && noting) {
      // Back to writing a message; the card still waits.
      e.preventDefault()
      stopNoting()
    } else if (e.key === 'Escape' && busy) {
      e.preventDefault()
      stop()
    } else if (e.key === 'Escape' && useLive.getState().editing[sessionId]) {
      // Esc stops rewording; what you were writing before comes back.
      e.preventDefault()
      useLive.getState().endEdit(sessionId, true)
    }
  }

  // A pasted picture rides along; files copied in Explorer go in as their paths, as dropped ones do.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...e.clipboardData.files]
    if (!pasted.length) return
    e.preventDefault()
    void attach(sessionId, pasted)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    setDragging(false)
    if (!e.dataTransfer.files.length) return
    e.preventDefault()
    void attach(sessionId, [...e.dataTransfer.files])
  }
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void attach(sessionId, [...e.target.files])
    e.target.value = ''
  }

  return (
    <div
      className={cn('composer relative rounded-[20px] transition-shadow duration-[var(--duration-menu)]', concept ? 'concept-composer' : 'glass-strong', dragging && 'is-dropping')}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {menuOpen && (
        <Suggestions id="slash-commands" label="Commands" items={commands} keyOf={(c) => c.name} highlight={highlight} onPick={complete} onHover={setHighlight}>
          {(c) => <CommandRow command={c} />}
        </Suggestions>
      )}
      {filesOpen && (
        <Suggestions id="mention-files" label="Files" items={found} keyOf={(path) => path} highlight={highlight} onPick={pick} onHover={setHighlight}>
          {(path) => <FileRow path={path} />}
        </Suggestions>
      )}

      <div className="relative z-[2]">
        {summary && summary.queued.length > 0 && <QueuedList sessionId={sessionId} summary={summary} />}
        {draft.images.length > 0 && <Attachments sessionId={sessionId} draft={draft} />}
        <textarea
          ref={area}
          data-composer
          rows={1}
          value={draft.text}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(caretOf(e.target))
          }}
          onSelect={(e) => setCaret(caretOf(e.currentTarget))}
          onFocus={(e) => setCaret(caretOf(e.currentTarget))}
          onBlur={() => setCaret(null)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={noting ? 'Tell Claude what to do instead' : suggestion ?? (summary?.state === 'new' ? 'What should Claude do?' : 'Message Claude')}
          aria-label={noting ? 'What Claude should do instead' : 'Message'}
          aria-description={suggestion ? `Suggested: ${suggestion}. Press Tab to use it.` : undefined}
          aria-autocomplete={slash !== null || mention !== null ? 'list' : undefined}
          aria-controls={menuOpen ? 'slash-commands' : filesOpen ? 'mention-files' : undefined}
          aria-activedescendant={menuOpen ? `slash-commands-${highlight}` : filesOpen ? `mention-files-${highlight}` : undefined}
          spellCheck
          className="no-drag block max-h-[40vh] w-full resize-none bg-transparent px-4 pt-3 pb-1 text-[0.9375rem] leading-[1.5] text-label outline-none placeholder:text-label-tertiary"
        />
        <div className="flex items-center gap-0.5 px-2 pb-2">
          <Tooltip label="Attach Files">
            <Button shape="round" aria-label="Attach files" onClick={() => files.current?.click()}>
              <Paperclip size={16} strokeWidth={1.75} />
            </Button>
          </Tooltip>
          <input ref={files} type="file" multiple hidden onChange={onPick} />
          <ModePicker value={mode} onChange={(m) => void useLive.getState().set(sessionId, { mode: m })} />
          <ModelPicker value={model} models={models} onChange={(m) => void useLive.getState().set(sessionId, { model: m })} />
          {efforts.length > 0 && <EffortPicker value={effort} efforts={efforts} onChange={(v) => void useLive.getState().set(sessionId, { effort: v })} />}
          {fastOffered && <FastToggle sessionId={sessionId} summary={summary} />}
          <div className="flex-1" />
          {suggestion && (
            <span aria-hidden className="mr-1 hidden items-center gap-1 text-[11.5px] text-label-tertiary sm:flex">
              <kbd className="rounded-[4px] px-1 font-sans text-[10.5px] shadow-[inset_0_0_0_0.5px_var(--separator-strong)]">Tab</kbd>
              to use
            </span>
          )}
          <ContextMeter sessionId={sessionId} summary={summary} />
          {busy && (
            <Tooltip label="Stop" shortcut="Esc">
              <Button shape="round" aria-label="Stop" onClick={stop} className="text-label">
                <Square size={13} strokeWidth={0} fill="currentColor" />
              </Button>
            </Tooltip>
          )}
          <Tooltip label={noting ? 'Deny, and Tell Claude This' : busy ? 'Send When Claude Finishes' : 'Send'} shortcut="Enter">
            <button
              type="button"
              aria-label={noting ? 'Deny, and tell Claude this' : busy ? 'Send when Claude finishes' : 'Send'}
              disabled={!canSend}
              onClick={send}
              className="no-drag ml-1 flex size-[28px] shrink-0 items-center justify-center rounded-full bg-[var(--signal)] text-white outline-none transition-[transform,opacity,filter] duration-[var(--duration-press)] ease-out enabled:hover:brightness-110 enabled:active:scale-[0.92] disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-ring)] motion-reduce:enabled:active:scale-100"
            >
              <ArrowUp size={16} strokeWidth={2.25} />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

const EMPTY: Draft = { text: '', images: [] }

/** Messages sent while Claude works, in the order they'll go. */
function QueuedList({ sessionId, summary }: { sessionId: string; summary: LiveSummary }) {
  return (
    <ul aria-label="Queued messages" className="flex flex-col gap-1 px-3 pt-2.5">
      {summary.queued.map((q) => (
        <li key={q.id} className="flex items-center gap-2 rounded-[10px] bg-fill py-1 pr-1 pl-2.5 text-[13px]">
          <span className="shrink-0 text-[11.5px] font-medium text-label-secondary">{q.sent ? 'Sent' : 'Queued'}</span>
          <span className="min-w-0 flex-1 truncate text-label">{q.text || (q.images === 1 ? 'An image' : `${q.images} images`)}</span>
          <Tooltip label={q.sent ? 'Take Back' : 'Don’t Send'}>
            <Button size="small" shape="round" aria-label={q.sent ? 'Take this message back' : 'Don’t send this message'} onClick={() => void useLive.getState().unqueue(sessionId, q.id)}>
              <X size={13} strokeWidth={2} />
            </Button>
          </Tooltip>
        </li>
      ))}
    </ul>
  )
}

/** Pictures going with the message: fixed-size thumbnails, each with a way to take it off. */
function Attachments({ sessionId, draft }: { sessionId: string; draft: Draft }) {
  const remove = (key: string) => useLive.getState().setDraft(sessionId, { ...draft, images: draft.images.filter((i) => i.key !== key) })
  return (
    <ul aria-label="Attached images" className="flex gap-2 overflow-x-auto px-3 pt-3">
      {draft.images.map((img) => (
        <li key={img.key} className="group/att relative shrink-0">
          <img src={`data:${img.mediaType};base64,${img.data}`} alt={img.name} className="size-16 rounded-[10px] object-cover shadow-[inset_0_0_0_0.5px_var(--separator-strong)]" />
          <button
            type="button"
            aria-label={`Remove ${img.name}`}
            onClick={() => remove(img.key)}
            className="no-drag absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-[var(--label)] text-[var(--surface)] opacity-0 shadow outline-none transition-opacity duration-[var(--duration-tooltip)] group-hover/att:opacity-100 focus-visible:opacity-100"
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        </li>
      ))}
    </ul>
  )
}

