import { createContext, forwardRef, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { Check, ChevronDown, ClipboardList, FilePen, FileText, Globe, MessageCircleQuestion, Search, SplitSquareHorizontal, SquareTerminal, Wrench } from 'lucide-react'
import { MODES, modeInfo, type CardAnswer, type LiveSummary, type ModeId, type OfferCard, type PermissionCard, type PlanCard, type PromptCard, type QuestionCard } from '@shared/live'
import { Button } from '../../components/ui/Button'
import { MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuTrigger, MenuItem } from '../../components/ui/Menu'
import { cn } from '../../lib/cn'
import { useLive } from '../../stores/live'
import { startNoting, stopNoting } from '../concept/noting'
import { Markdown } from './Markdown'

/** An answer from the keyboard snaps the card away; one from the pointer lets it go back into the composer. */
let answeredByKeyboard = false

/**
 * How a card is drawn: in glass above the composer (classic), or in the
 * concept, as a card of content at the foot of the conversation, its symbol
 * on an accent tile and its keys beside its buttons.
 */
const CardLook = createContext<{ inline: boolean; sessionId: string }>({ inline: false, sessionId: '' })

/**
 * Claude asking you something: a permission, its plan, or its own questions.
 * One card at a time, above the composer, where your answer goes (in the
 * concept, at the end of the conversation); Enter answers with the default,
 * Esc declines. More waiting say so.
 */
export function PromptCards({ sessionId, summary, inline = false }: { sessionId: string; summary: LiveSummary; inline?: boolean }) {
  const reduce = useReducedMotion()
  const card = summary.cards[0]
  const more = summary.cards.length - 1
  const answer = (a: CardAnswer, viaKeyboard: boolean) => {
    answeredByKeyboard = viaKeyboard
    stopNoting()
    void useLive.getState().answer(sessionId, a)
  }
  const look = useMemo(() => ({ inline, sessionId }), [inline, sessionId])
  // A card answered leaves the layout at once (popLayout): the next one takes its place while it goes.
  return (
    <CardLook.Provider value={look}>
      <AnimatePresence initial={false} mode="popLayout">
        {card && (
          <CardShell
            key={card.requestId}
            label={card.kind === 'permission' ? 'Permission request' : card.kind === 'plan' ? 'Plan for review' : card.kind === 'offer' ? 'A session of its own?' : 'Question from Claude'}
            reduce={!!reduce}
            inline={inline}
          >
            {card.kind === 'permission' && <Permission card={card} onAnswer={answer} />}
            {card.kind === 'plan' && <Plan card={card} onAnswer={answer} />}
            {card.kind === 'question' && <Questions card={card} onAnswer={answer} />}
            {card.kind === 'offer' && <Offer card={card} onAnswer={answer} />}
            {more > 0 && <p className="px-4 pb-3 text-[11.5px] text-label-secondary">{more === 1 ? 'One more request waits after this one.' : `${more} more requests wait after this one.`}</p>}
          </CardShell>
        )}
      </AnimatePresence>
    </CardLook.Provider>
  )
}

/**
 * The card's glass. It rises out of the composer and goes back into it; once
 * answered it can't be reached. Inline (the concept) it's a card on the page
 * that settles 10 px down as it goes.
 */
const CardShell = forwardRef<HTMLElement, { label: string; reduce: boolean; inline: boolean; children: ReactNode }>(function CardShell({ label, reduce, inline, children }, ref) {
  const present = useIsPresent()
  const lift = inline ? 10 : 14
  return (
    <motion.section
      ref={ref}
      aria-label={label}
      inert={!present}
      aria-hidden={!present || undefined}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: lift, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={answeredByKeyboard ? { opacity: 0, transition: { duration: 0 } } : reduce ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, y: lift, scale: 0.98, transition: { duration: 0.16, ease: [0.23, 1, 0.32, 1] } }}
      transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
      style={{ transformOrigin: '50% 100%' }}
      className={cn(
        'prompt-card flex flex-col text-label',
        inline ? 'concept-ask max-h-[min(70vh,680px)]' : 'glass-strong max-h-[min(62vh,620px)] rounded-[18px]'
      )}
    >
      <div className="relative z-[2] flex min-h-0 flex-1 flex-col">{children}</div>
    </motion.section>
  )
})

/** A key that answers the card, beside its button (Esc, ↩), in the concept. */
function KeyHint({ children }: { children: ReactNode }) {
  return useContext(CardLook).inline ? (
    <span aria-hidden className="text-[11px] font-normal opacity-70">
      {children}
    </span>
  ) : null
}

type Answer = (answer: CardAnswer, viaKeyboard: boolean) => void

/**
 * The card takes the keyboard when it appears, unless you're in the middle of
 * writing a message; Enter and Esc work from anywhere in it.
 */
function useCardKeys(primary: React.RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    const active = document.activeElement as HTMLTextAreaElement | null
    if (active?.matches('textarea[data-composer]') && active.value.trim()) return
    primary.current?.focus({ preventScroll: true })
  }, [primary])
}

function Header({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: string | null }) {
  const { inline } = useContext(CardLook)
  return (
    <header className={cn('flex items-start gap-2.5 px-4', inline ? 'pt-4' : 'pt-3.5')}>
      <span
        className={cn(
          'mt-[1px] flex size-6 shrink-0 items-center justify-center rounded-[7px] [&>svg]:size-[14px]',
          // The concept's one coloured tile: Claude asking.
          inline ? 'bg-accent text-white' : 'bg-fill-strong text-label'
        )}
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[0.9375rem] leading-snug font-semibold tracking-[-0.01em] break-words">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12.5px] leading-snug text-label-secondary break-words">{subtitle}</p>}
      </div>
    </header>
  )
}

function Actions({ children, start }: { children: ReactNode; start?: ReactNode }) {
  const { inline } = useContext(CardLook)
  return (
    <footer className={cn('flex flex-wrap items-center gap-2 px-4', inline ? 'pt-3 pb-4' : 'pt-2 pb-3.5')}>
      {start}
      <div className="flex-1" />
      {children}
    </footer>
  )
}

// ─── Permission ──────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const base = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/** The CLI's own sentence when it sends one, else one from the tool. */
function permissionTitle(card: PermissionCard): string {
  if (card.title) return card.title
  const input = card.input
  switch (card.toolName) {
    case 'Bash':
    case 'PowerShell':
      return 'Allow Claude to run this command?'
    case 'Write':
      return `Allow Claude to write ${base(str(input.file_path)) || 'a file'}?`
    case 'Edit':
    case 'MultiEdit':
      return `Allow Claude to edit ${base(str(input.file_path)) || 'a file'}?`
    case 'Read':
      return `Allow Claude to read ${base(str(input.file_path)) || 'a file'}?`
    case 'WebFetch':
      return `Allow Claude to open ${str(input.url).replace(/^https?:\/\//, '').split('/')[0] || 'a web page'}?`
    case 'WebSearch':
      return 'Allow Claude to search the web?'
    default: {
      if (card.toolName.startsWith('mcp__')) {
        const [, server, ...tool] = card.toolName.split('__')
        return `Allow Claude to use ${tool.join(' ').replace(/_/g, ' ')} from ${server.replace(/_/g, ' ')}?`
      }
      return `Allow Claude to use ${card.displayName ?? card.toolName}?`
    }
  }
}

function toolIcon(name: string): ReactNode {
  if (name === 'Bash' || name === 'PowerShell') return <SquareTerminal strokeWidth={2} />
  if (name === 'Write' || name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') return <FilePen strokeWidth={2} />
  if (name === 'Read') return <FileText strokeWidth={2} />
  if (name === 'WebFetch' || name === 'WebSearch') return <Globe strokeWidth={2} />
  if (name === 'Grep' || name === 'Glob') return <Search strokeWidth={2} />
  return <Wrench strokeWidth={2} />
}

/** A line diff, enough for a preview: lines kept, removed and added. */
export function lineDiff(before: string, after: string): string[] {
  const a = before.split('\n').slice(0, 400)
  const b = after.split('\n').slice(0, 400)
  const n = a.length
  const m = b.length
  // Longest common subsequence, table from the end.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(' ' + a[i])
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push('-' + a[i++])
    else out.push('+' + b[j++])
  }
  while (i < n) out.push('-' + a[i++])
  while (j < m) out.push('+' + b[j++])
  return out
}

function DiffPreview({ path, lines }: { path?: string; lines: string[] }) {
  return (
    <div className="code-card overflow-hidden">
      {path && <p className="truncate border-b border-separator px-3 py-1.5 font-mono text-[11.5px] text-label-secondary" title={path}>{path}</p>}
      <pre className="code-text max-h-72 overflow-auto py-1.5">
        {lines.map((l, i) => (
          <div key={i} className={cn('px-3 whitespace-pre-wrap break-all', l[0] === '+' && 'bg-[var(--added-fill)]', l[0] === '-' && 'bg-[var(--removed-fill)]')}>
            <span aria-hidden className="mr-2 inline-block w-2 text-label-tertiary select-none">{l[0] === ' ' ? '' : l[0] === '+' ? '+' : '−'}</span>
            {l.slice(1) || ' '}
          </div>
        ))}
      </pre>
    </div>
  )
}

/** What the tool would do: the command, the edit as a diff, the new file, or its input. */
function PermissionPreview({ card }: { card: PermissionCard }) {
  const input = card.input
  switch (card.toolName) {
    case 'Bash':
    case 'PowerShell':
      return (
        <div className="flex flex-col gap-1.5">
          {str(input.description) && <p className="text-[12.5px] text-label-secondary">{str(input.description)}</p>}
          <pre className="code-card code-text max-h-56 overflow-auto px-3 py-2 whitespace-pre-wrap break-all select-text">{str(input.command)}</pre>
        </div>
      )
    case 'Edit':
      return <DiffPreview path={str(input.file_path)} lines={lineDiff(str(input.old_string), str(input.new_string))} />
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : []
      return <DiffPreview path={str(input.file_path)} lines={edits.flatMap((e, i) => [...(i ? [' …'] : []), ...lineDiff(str((e as Record<string, unknown>)?.old_string), str((e as Record<string, unknown>)?.new_string))])} />
    }
    case 'Write':
      return <DiffPreview path={str(input.file_path)} lines={str(input.content).split('\n').slice(0, 200).map((l) => '+' + l)} />
    case 'WebFetch':
      return (
        <div className="code-card px-3 py-2 text-[12.5px]">
          <p className="truncate font-mono text-[12px]">{str(input.url)}</p>
          {str(input.prompt) && <p className="mt-1 text-label-secondary">{str(input.prompt)}</p>}
        </div>
      )
    default: {
      const text = JSON.stringify(input, null, 2)
      return text && text !== '{}' ? <pre className="code-card code-text max-h-56 overflow-auto px-3 py-2 whitespace-pre-wrap break-all select-text">{text}</pre> : null
    }
  }
}

function Permission({ card, onAnswer }: { card: PermissionCard; onAnswer: Answer }) {
  const allow = useRef<HTMLButtonElement>(null)
  const deny = useRef<HTMLButtonElement>(null)
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const { inline, sessionId } = useContext(CardLook)
  // The concept takes the note in the composer, where you write to Claude anyway.
  const tell = () => (inline ? startNoting({ sessionId, requestId: card.requestId }) : setNoting(true))
  useCardKeys(card.defaultToNo ? deny : allow)
  // The CLI's description often repeats what the title or the preview already says ("hello.txt"): then it goes.
  const said = [str(card.input.description), base(str(card.input.file_path))].filter(Boolean)
  const description = card.description && !said.includes(card.description) ? card.description : null
  const subtitle = description ?? card.reason ?? (card.blockedPath ? `It affects ${card.blockedPath}.` : null)
  const answer = (decision: 'once' | 'always' | 'deny', viaKeyboard: boolean, always?: number) =>
    onAnswer({ kind: 'permission', requestId: card.requestId, decision, always, note: decision === 'deny' && note.trim() ? note : undefined }, viaKeyboard)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      answer('deny', true)
    } else if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault()
      answer('deny', true)
    }
  }
  return (
    <div onKeyDown={onKeyDown} className="flex min-h-0 flex-col">
      <Header icon={toolIcon(card.toolName)} title={permissionTitle(card)} subtitle={subtitle} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2.5">
        <PermissionPreview card={card} />
        {noting && (
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Tell Claude what to do instead"
            aria-label="What Claude should do instead"
            className="no-drag mt-2.5 h-8 w-full rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 text-[13px] text-label outline-none shadow-[inset_0_0_0_0.5px_var(--separator-strong)] placeholder:text-label-tertiary focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          />
        )}
      </div>
      <Actions
        start={
          <>
            <Button ref={deny} size="text" tone="secondary" onClick={(e) => answer('deny', e.detail === 0)}>
              {noting && note.trim() ? 'Deny and Tell Claude' : 'Deny'}
              <KeyHint>Esc</KeyHint>
            </Button>
            {!noting && (
              <Button size="text" className="concept-tell text-accent-text" onClick={tell}>
                Tell Claude What to Do…
              </Button>
            )}
          </>
        }
      >
        {card.always.length === 1 && (
          <Button size="text" tone="secondary" title={card.always[0].detail} onClick={(e) => answer('always', e.detail === 0, 0)}>
            {card.always[0].label}
          </Button>
        )}
        {card.always.length > 1 && (
          <MenuRoot>
            <MenuTrigger className="no-drag flex h-[28px] items-center gap-1 rounded-[var(--radius-control)] bg-fill-strong px-2.5 text-[13px] text-label outline-none hover:bg-fill-pressed focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]">
              Always Allow
              <ChevronDown size={12} strokeWidth={2.25} aria-hidden />
            </MenuTrigger>
            <MenuPopup align="end">
              {card.always.map((a, i) => (
                <MenuItem key={i} label={a.label} detail={a.detail} onClick={() => answer('always', false, i)} />
              ))}
            </MenuPopup>
          </MenuRoot>
        )}
        <Button ref={allow} size="text" tone="primary" onClick={(e) => answer('once', e.detail === 0)}>
          Allow Once
          {!card.defaultToNo && <KeyHint>↩</KeyHint>}
        </Button>
      </Actions>
      {card.always.length === 1 && <p className="-mt-2 px-4 pb-3 text-right text-[11px] text-label-secondary">{card.always[0].detail}</p>}
    </div>
  )
}

// ─── Plan ────────────────────────────────────────────────────────────────────

/** The modes a plan can be approved into: anything but planning on. */
const AFTER_PLAN = MODES.filter((m) => m.id !== 'plan')

function Plan({ card, onAnswer }: { card: PlanCard; onAnswer: Answer }) {
  const approve = useRef<HTMLButtonElement>(null)
  const [next, setNext] = useState<ModeId>('acceptEdits')
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  useCardKeys(approve)
  const keep = (viaKeyboard: boolean) => onAnswer({ kind: 'plan', requestId: card.requestId, approve: false, note }, viaKeyboard)
  return (
    <div
      className="flex min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          if (noting) setNoting(false)
          else setNoting(true)
        }
      }}
    >
      <Header icon={<ClipboardList strokeWidth={2} />} title="Claude’s Plan" subtitle="Approve it to let Claude start, or keep planning together." />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2.5">
        <div className="code-card px-3.5 py-2.5">
          <Markdown text={card.plan} className="text-[0.875rem]" />
        </div>
        {noting && (
          <textarea
            autoFocus
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                keep(true)
              }
            }}
            placeholder="What should change?"
            aria-label="What should change in the plan"
            className="no-drag mt-2.5 w-full resize-none rounded-[var(--radius-control)] bg-[var(--field)] px-2.5 py-1.5 text-[13px] text-label outline-none shadow-[inset_0_0_0_0.5px_var(--separator-strong)] placeholder:text-label-tertiary focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
          />
        )}
      </div>
      <Actions
        start={
          <Button size="text" tone="secondary" onClick={(e) => (noting ? keep(e.detail === 0) : setNoting(true))}>
            {noting ? 'Keep Planning' : 'Keep Planning…'}
          </Button>
        }
      >
        <span className="text-[12px] text-label-secondary">Then</span>
        <MenuRoot>
          <MenuTrigger className="no-drag flex h-[28px] items-center gap-1 rounded-[var(--radius-control)] bg-fill-strong px-2.5 text-[13px] text-label outline-none hover:bg-fill-pressed focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]">
            {modeInfo(next).label}
            <ChevronDown size={12} strokeWidth={2.25} aria-hidden />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuRadioGroup<ModeId> value={next} onChange={setNext}>
              {AFTER_PLAN.map((m) => (
                <MenuRadioItem key={m.id} value={m.id} label={m.label} detail={m.detail} destructive={m.id === 'bypassPermissions'} />
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </MenuRoot>
        <Button ref={approve} size="text" tone="primary" onClick={(e) => onAnswer({ kind: 'plan', requestId: card.requestId, approve: true, mode: next }, e.detail === 0)}>
          Approve Plan
        </Button>
      </Actions>
    </div>
  )
}

// ─── Questions ───────────────────────────────────────────────────────────────

function Questions({ card, onAnswer }: { card: QuestionCard; onAnswer: Answer }) {
  const first = useRef<HTMLButtonElement>(null)
  const submit = useRef<HTMLButtonElement>(null)
  /** Per question: the labels picked, and what you wrote under Other. */
  const [picked, setPicked] = useState<Record<number, string[]>>({})
  const [other, setOther] = useState<Record<number, string>>({})
  const single = card.questions.length === 1 && !card.questions[0].multiSelect
  /** The option the pointer or keyboard is on, for its preview. */
  const [focused, setFocused] = useState<{ q: number; o: number } | null>(null)
  const preview = focused ? card.questions[focused.q]?.options[focused.o]?.preview : undefined
  useCardKeys(first)

  const answers = useMemo(() => {
    const out: Record<string, string> = {}
    card.questions.forEach((q, i) => {
      const labels = [...(picked[i] ?? []), ...(other[i]?.trim() ? [other[i].trim()] : [])]
      if (labels.length) out[q.question] = labels.join(', ')
    })
    return out
  }, [card.questions, picked, other])
  const complete = card.questions.every((q) => answers[q.question])
  const send = (viaKeyboard: boolean, given = answers) => onAnswer({ kind: 'question', requestId: card.requestId, answers: given }, viaKeyboard)

  const pick = (i: number, label: string, multi: boolean, viaKeyboard: boolean) => {
    if (single) {
      send(viaKeyboard, { [card.questions[0].question]: label })
      return
    }
    const now = picked[i] ?? []
    setPicked({ ...picked, [i]: multi ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label] })
    if (!multi) setOther({ ...other, [i]: '' })
  }

  return (
    <div
      className="flex min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onAnswer({ kind: 'question', requestId: card.requestId, declined: true }, true)
        }
      }}
    >
      <Header icon={<MessageCircleQuestion strokeWidth={2} />} title={card.questions.length === 1 ? card.questions[0].question : 'Claude has some questions'} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2.5">
        {card.questions.map((q, i) => (
          <fieldset key={i} className={cn('flex flex-col gap-1', i > 0 && 'mt-3.5')}>
            <legend className="mb-1 flex items-baseline gap-2">
              {q.header && <span className="rounded-[5px] bg-fill-strong px-1.5 py-px text-[11px] font-semibold tracking-[var(--tracking-caption)] text-label-secondary">{q.header}</span>}
              {card.questions.length > 1 && <span className="text-[13px] font-medium">{q.question}</span>}
              {q.multiSelect && <span className="text-[11.5px] text-label-secondary">Choose any</span>}
            </legend>
            {q.options.map((o, j) => {
              const on = (picked[i] ?? []).includes(o.label)
              return (
                <button
                  key={j}
                  ref={i === 0 && j === 0 ? first : undefined}
                  type="button"
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={(e) => pick(i, o.label, q.multiSelect, e.detail === 0)}
                  onFocus={() => setFocused({ q: i, o: j })}
                  onPointerEnter={() => setFocused({ q: i, o: j })}
                  className={cn(
                    'no-drag flex items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left outline-none transition-[background-color,transform] duration-[var(--duration-press)] ease-out',
                    'hover:bg-fill-strong active:scale-[0.99] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent-ring)] motion-reduce:active:scale-100',
                    on ? 'bg-[var(--accent-fill)]' : 'bg-fill'
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-[3px] flex size-[14px] shrink-0 items-center justify-center border',
                      q.multiSelect ? 'rounded-[4px]' : 'rounded-full',
                      on ? 'border-transparent bg-accent text-[var(--on-accent)]' : 'border-separator-strong'
                    )}
                  >
                    {on && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{o.label}</span>
                    {o.description && <span className="block text-[12px] leading-snug text-label-secondary">{o.description}</span>}
                  </span>
                </button>
              )
            })}
            <input
              value={other[i] ?? ''}
              onChange={(e) => {
                setOther({ ...other, [i]: e.target.value })
                if (!q.multiSelect && e.target.value) setPicked({ ...picked, [i]: [] })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && complete) {
                  e.preventDefault()
                  send(true)
                }
              }}
              placeholder="Other…"
              aria-label={`Another answer to: ${q.question}`}
              className="no-drag h-8 rounded-[10px] bg-[var(--field)] px-2.5 text-[13px] text-label outline-none shadow-[inset_0_0_0_0.5px_var(--separator-strong)] placeholder:text-label-tertiary focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
            />
          </fieldset>
        ))}
        {/* What the option you're on would look like, as Claude drew it. */}
        {preview && (
          <div aria-live="polite" className="mt-3 max-h-[220px] overflow-auto rounded-[10px] bg-fill px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-label">
            {preview}
          </div>
        )}
      </div>
      <Actions
        start={
          <Button size="text" tone="secondary" onClick={(e) => onAnswer({ kind: 'question', requestId: card.requestId, declined: true }, e.detail === 0)}>
            Skip
          </Button>
        }
      >
        {(!single || other[0]?.trim()) && (
          <Button ref={submit} size="text" tone="primary" disabled={!complete} onClick={(e) => send(e.detail === 0)}>
            Answer
          </Button>
        )}
      </Actions>
    </div>
  )
}

// ─── Offer ───────────────────────────────────────────────────────────────────

/**
 * Claude offers a task you named a session of its own (start_session's
 * "offer"): New Session starts it beside this one; Do It Here keeps the work in
 * this conversation. Enter takes New Session, Esc keeps it here.
 */
function Offer({ card, onAnswer }: { card: OfferCard; onAnswer: Answer }) {
  const primary = useRef<HTMLButtonElement>(null)
  useCardKeys(primary)
  const choose = (choice: 'new' | 'here', viaKeyboard: boolean) => onAnswer({ kind: 'offer', requestId: card.requestId, choice }, viaKeyboard)
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          choose('here', true)
        }
      }}
    >
      <Header icon={<SplitSquareHorizontal strokeWidth={2} />} title={card.title} subtitle="Claude can start this as a session of its own, beside this one, and tell you here when it finishes a turn." />
      <Actions>
        <Button size="text" tone="secondary" onClick={(e) => choose('here', e.detail === 0)}>
          Do It Here <KeyHint>Esc</KeyHint>
        </Button>
        <Button ref={primary} size="text" tone="primary" onClick={(e) => choose('new', e.detail === 0)}>
          New Session <KeyHint>↩</KeyHint>
        </Button>
      </Actions>
    </div>
  )
}

export type { PromptCard }
