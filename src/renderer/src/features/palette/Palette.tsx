// The command palette (Ctrl+K, View › Command Palette…): type to find a
// command, a session or a folder; Enter runs the command, opens the session in
// the chat or shows the folder in the sidebar. A glass panel near the top of
// the window, which can't be reached under it while it's up. From the keyboard
// it comes and goes at once, as keyboard actions do in Gloom; from the menu it
// grows in, and a click outside fades it away.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Check, Folder as FolderIcon, Search } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
import { COMMANDS, formatAccelerator, GROUP_LABELS, type CommandId, type CommandSpec } from '@shared/commands'
import { displayTitle, projectName } from '@shared/library'
import { cn } from '../../lib/cn'
import { useCommandState } from '../../lib/command-state'
import { runCommand } from '../../lib/commands'
import { useNow } from '../../lib/now'
import { relativeTime } from '../../lib/time'
import { useLibrary } from '../../stores/library'
import { closePalette, usePalette } from '../../stores/palette'
import { useUi } from '../../stores/ui'
import { openSession, revealFolder } from './actions'
import { flatten, rankPalette, usable, type PaletteCommand, type PaletteFolder, type PaletteInput, type PaletteItem, type PaletteSession } from './rank'

/** Page Up and Page Down move this many results. */
const PAGE = 8
const EASE_OUT = [0.23, 1, 0.32, 1] as const

export function Palette({ blocked }: { blocked: boolean }) {
  const open = usePalette((s) => s.open)
  const instant = usePalette((s) => s.instant)
  // The update screen takes the window over: the palette goes with the rest of the app.
  useEffect(() => {
    // After this commit: closing commits at once (flushSync), which React won't do mid-commit.
    if (blocked && open) queueMicrotask(() => closePalette(true))
  }, [blocked, open])

  return (
    <AnimatePresence custom={instant}>
      {open && (
        // A click outside puts the palette away and goes no further: the shield stays while the panel fades.
        <motion.div
          key="shield"
          className="no-drag fixed inset-0 z-50"
          custom={instant}
          variants={SHIELD}
          initial={false}
          animate="shown"
          exit="hidden"
          onPointerDown={() => closePalette(false)}
          onMouseDown={(e) => e.preventDefault()}
        />
      )}
      {open && <Panel key="panel" instant={instant} />}
    </AnimatePresence>
  )
}

const SHIELD: Variants = {
  shown: { opacity: 1 },
  hidden: (instant: boolean) => ({ opacity: 0, transition: { duration: instant ? 0 : 0.15 } })
}

/** What the palette searches: the commands as the menu shows them now, every session, every folder. */
function useSources(): Omit<PaletteInput, 'query'> {
  const stateOf = useCommandState()
  const sessions = useLibrary((s) => s.sessions)
  const entries = useLibrary((s) => s.library.sessions)
  const folderList = useLibrary((s) => s.library.folders)
  const selection = useUi((s) => s.selection)
  const viewed = usePalette((s) => s.viewed)
  const picked = usePalette((s) => s.picked)

  const listed = (COMMANDS as readonly CommandSpec[]).filter((c) => !c.arrivesIn && c.id !== 'view.palette')
  const states = listed.map(stateOf)
  // What each command says and whether it's available: all that changes from render to render.
  const statesKey = states.map((s) => `${s.label}|${+s.disabled}|${+s.checked}`).join('\n')
  const commands = useMemo<PaletteCommand[]>(
    () =>
      listed.map((c, i) => ({
        id: c.id,
        label: states[i].label,
        submenu: c.submenu,
        names: [c.label, c.submenu ? `${c.submenu} ${c.label}` : ''].filter((name) => name && name !== states[i].label),
        keywords: [c.keywords, GROUP_LABELS[c.group]].filter(Boolean).join(' '),
        shortcut: c.accelerator ? formatAccelerator(c.accelerator) : undefined,
        disabled: states[i].disabled,
        checked: states[i].checked
      })),
    [statesKey] // `listed` never changes; `states` is what statesKey spells out.
  )
  const sessionList = useMemo<PaletteSession[]>(
    () =>
      Object.values(sessions).map((meta) => {
        const entry = entries[meta.id]
        return { id: meta.id, title: displayTitle(meta, entry), meta, archived: !!entry?.archived }
      }),
    [sessions, entries]
  )
  const folders = useMemo<PaletteFolder[]>(() => {
    const byId = new Map(folderList.map((f) => [f.id, f]))
    return folderList.map((folder) => {
      const path: string[] = []
      for (let up = folder.parentId ? byId.get(folder.parentId) : undefined; up && path.length < 64; up = up.parentId ? byId.get(up.parentId) : undefined) path.unshift(up.name)
      return { id: folder.id, name: folder.name, path }
    })
  }, [folderList])
  const current = selection.length === 1 ? selection[0] : null
  return useMemo(() => ({ commands, sessions: sessionList, folders, current, viewed, picked }), [commands, sessionList, folders, current, viewed, picked])
}

function Panel({ instant }: { instant: boolean }) {
  const reduce = useReducedMotion()
  const id = useId()
  const listId = `${id}-results`
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const sources = useSources()
  const groups = useMemo(() => rankPalette({ ...sources, query }), [sources, query])
  const items = useMemo(() => flatten(groups), [groups])
  const choices = useMemo(() => items.filter(usable), [items])
  /** The result Enter uses: the first that can be used, until the arrows or the pointer pick another. */
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const active = choices.find((item) => item.key === activeKey) ?? choices[0]
  /** The active result moved by key, so the list scrolls to keep it in view. */
  const follow = useRef(false)
  const pointer = useRef({ x: NaN, y: NaN })
  const now = useNow(30_000)
  const optionId = (item: PaletteItem) => `${id}-${items.indexOf(item)}`

  // The field has the keyboard from the first frame (the window under it is inert).
  useLayoutEffect(() => {
    field.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const box = list.current
    if (!follow.current || !active || !box) return
    follow.current = false
    if (active === choices[0]) {
      box.scrollTop = 0
      return
    }
    const row = box.querySelector<HTMLElement>(`[data-key="${CSS.escape(active.key)}"]`)
    // The first result of a group brings its heading into view with it.
    const group = row?.closest('[role="group"]')
    if (group?.querySelector('[role="option"]') === row) group?.firstElementChild?.scrollIntoView({ block: 'nearest' })
    row?.scrollIntoView({ block: 'nearest' })
  }, [active, choices])

  const search = (text: string) => {
    setQuery(text)
    setActiveKey(null)
    if (list.current) list.current.scrollTop = 0
  }

  const move = (by: number) => {
    if (!choices.length) return
    const at = active ? choices.indexOf(active) : 0
    follow.current = true
    setActiveKey(choices[Math.max(0, Math.min(choices.length - 1, at + by))].key)
  }

  const pick = (item: PaletteItem, viaKeyboard: boolean) => {
    if (!usable(item)) return
    usePalette.getState().notePicked(item.key)
    // Gone at once, however it was picked: what it does is what you see next.
    closePalette(true)
    if (item.kind === 'command') runCommand(item.command.id as CommandId, viaKeyboard)
    else if (item.kind === 'session') openSession(item.session.id, item.session.archived)
    else revealFolder(item.folder.id, viaKeyboard)
  }

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    // Keys stay with the palette: the window's own handlers (Esc in the composer stops a turn) don't hear them.
    e.stopPropagation()
    if (e.nativeEvent.isComposing) return
    switch (e.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'PageDown':
        move(PAGE)
        break
      case 'PageUp':
        move(-PAGE)
        break
      case 'Enter':
        if (active) pick(active, true)
        break
      // Esc clears what you typed first, as a search field does; then it closes.
      case 'Escape':
        if (query) search('')
        else closePalette(true)
        break
      // The field is the palette's one stop.
      case 'Tab':
        break
      default:
        return
    }
    e.preventDefault()
  }

  // The pointer picks what it moves onto; a list scrolling under a still pointer doesn't.
  const point = (item: PaletteItem) => (e: PointerEvent) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) return
    pointer.current = { x: e.clientX, y: e.clientY }
    if (usable(item) && item.key !== active?.key) setActiveKey(item.key)
  }

  const variants: Variants = {
    enter: reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 },
    shown: { opacity: 1, scale: 1, transition: { duration: 0.18, ease: EASE_OUT } },
    hidden: (gone: boolean) =>
      gone ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: reduce ? 1 : 0.98, pointerEvents: 'none', transition: { duration: 0.12, ease: EASE_OUT } }
  }
  const typed = query.trim()
  const count = choices.length

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(64px,14vh)] z-50 flex justify-center px-4">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Command Palette"
        custom={instant}
        variants={variants}
        initial={instant ? false : 'enter'}
        animate="shown"
        exit="hidden"
        onKeyDown={onKey}
        className="no-drag glass-strong pointer-events-auto flex max-h-[calc(100vh-max(64px,14vh)-16px)] w-full max-w-[600px] origin-top flex-col rounded-[16px] text-label"
      >
        <div className="relative z-[2] flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2.5 px-4">
            <Search size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-label-secondary" />
            <input
              ref={field}
              value={query}
              onChange={(e) => search(e.target.value)}
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={active ? optionId(active) : undefined}
              aria-label="Search commands, sessions and folders"
              placeholder="Search commands, sessions and folders"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent py-3.5 text-[1.0625rem] tracking-[-0.01em] text-label outline-none select-text placeholder:text-label-secondary"
            />
          </div>
          {(items.length > 0 || typed) && <div aria-hidden className="h-px shrink-0 bg-separator" />}
          {items.length > 0 ? (
            <div ref={list} id={listId} role="listbox" aria-label="Results" className="max-h-[26.5rem] min-h-0 flex-1 overflow-y-auto p-1.5">
              {groups.map((group, g) => (
                <div key={group.key} role="group" aria-labelledby={`${id}-${group.key}`}>
                  <div
                    id={`${id}-${group.key}`}
                    aria-hidden
                    className={cn('px-2.5 pb-1 text-[0.75rem] font-semibold tracking-[var(--tracking-caption)] text-label-secondary', g ? 'pt-3' : 'pt-1.5')}
                  >
                    {group.label}
                  </div>
                  {group.items.map((item) => (
                    <Row key={item.key} item={item} id={optionId(item)} active={item.key === active?.key} now={now} onPoint={point(item)} onPick={() => pick(item, false)} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            typed && <p className="pt-3 pr-4 pb-4 pl-[44px] text-[0.8125rem] text-label-secondary">No results for “{typed}”</p>
          )}
          <div role="status" className="sr-only">
            {typed ? (count ? `${count} ${count === 1 ? 'result' : 'results'}` : 'No results') : ''}
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/** Where a folder is: all of it when it's shallow, else the outermost folder and the one it's in. */
function whereIs(path: readonly string[]): string {
  return path.length > 2 ? `${path[0]} › … › ${path.at(-1)}` : path.join(' › ')
}

function Row({ item, id, active, now, onPoint, onPick }: { item: PaletteItem; id: string; active: boolean; now: number; onPoint(e: PointerEvent): void; onPick(): void }) {
  const disabled = !usable(item)
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      data-key={item.key}
      data-highlighted={active ? '' : undefined}
      onPointerMove={onPoint}
      // The field keeps the keyboard.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      // Names line up with what you type; symbols with the field's magnifier.
      className={cn('palette-row relative flex min-h-8 items-center gap-4 rounded-[8px] py-1 pr-2.5 pl-[38px] text-[0.8125rem]', active && 'is-active', disabled && 'is-disabled')}
    >
      {item.kind === 'command' ? (
        <>
          {item.command.checked && <Check size={14} strokeWidth={2.25} aria-hidden className="absolute left-2.5" />}
          {/* Relative: the hidden "(on)" stays inside what the ellipsis cuts off, rather than widening the list. */}
          <span className="relative min-w-0 flex-1 truncate">
            {item.command.submenu && <span className="palette-quiet">{item.command.submenu} › </span>}
            {item.command.label}
            {item.command.checked && <span className="sr-only"> (on)</span>}
          </span>
          {item.command.shortcut && <kbd className="palette-quiet shrink-0 font-sans text-[0.75rem] tabular">{item.command.shortcut}</kbd>}
        </>
      ) : item.kind === 'session' ? (
        <>
          <span className="min-w-0 flex-1 truncate">{item.session.title}</span>
          <span className="palette-quiet max-w-[45%] shrink-0 truncate text-[0.75rem] tabular">
            {[item.session.archived && 'Archived', projectName(item.session.meta), relativeTime(item.session.meta.updated, now)].filter(Boolean).join(' · ')}
          </span>
        </>
      ) : (
        <>
          <FolderIcon size={15} strokeWidth={1.75} aria-hidden className="palette-folder absolute left-2.5" />
          <span className="min-w-0 flex-1 truncate">{item.folder.name}</span>
          {item.folder.path.length > 0 && (
            // Shortened, the whole path shows on hover and is what a screen reader hears.
            <span className="palette-quiet relative max-w-[50%] shrink-0 truncate text-[0.75rem]" title={item.folder.path.length > 2 ? `in ${item.folder.path.join(' › ')}` : undefined}>
              <span aria-hidden={item.folder.path.length > 2 || undefined}>in {whereIs(item.folder.path)}</span>
              {item.folder.path.length > 2 && <span className="sr-only">in {item.folder.path.join(' › ')}</span>}
            </span>
          )}
        </>
      )}
    </div>
  )
}
