// The task list Claude keeps under its latest message, and the other things a
// turn can leave in the conversation through Gloom's tools: the next-step box
// at its end and chapter marks. All of it is read back from the tool calls in
// the transcript, so a session reopened later (or one the Claude app ran, whose
// tools have the same shapes) shows the same list, box and chapters. Pure,
// shared by main (the tools' answers) and the window.

export type StepStatus = 'pending' | 'in_progress' | 'completed'

export interface PlanStep {
  content: string
  status: StepStatus
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStatus = (v: unknown): v is StepStatus => v === 'pending' || v === 'in_progress' || v === 'completed'

/** The tool names that keep the list: Gloom's, and the Claude app's (its sessions open in Gloom too). */
export const PLAN_TOOLS = new Set(['mcp__gloom__update_plan', 'mcp__ccd_turn__update_plan'])
export const WRAP_TOOLS = new Set(['mcp__gloom__wrap_up', 'mcp__ccd_turn__wrap_up'])
export const CHAPTER_TOOLS = new Set(['mcp__gloom__mark_chapter', 'mcp__ccd_session__mark_chapter'])
export const WIDGET_TOOLS = new Set(['mcp__gloom__show_widget', 'mcp__visualize__show_widget'])

/**
 * One update_plan call applied to the list: `items` replaces it; `advance`
 * finishes the step under way and starts the next; `done` and `start` (1-based)
 * mark steps out of order. Anything malformed leaves the list as it was.
 */
export function applyPlan(steps: readonly PlanStep[], input: unknown): PlanStep[] {
  if (!isObj(input)) return [...steps]
  if (Array.isArray(input.items)) {
    const items = input.items.flatMap((i): PlanStep[] => (isObj(i) && typeof i.content === 'string' && i.content.trim() ? [{ content: i.content.trim().slice(0, 200), status: isStatus(i.status) ? i.status : 'pending' }] : []))
    return items.slice(0, 12)
  }
  const next = steps.map((s) => ({ ...s }))
  if (input.advance === true) {
    const at = next.findIndex((s) => s.status === 'in_progress')
    if (at >= 0) next[at].status = 'completed'
    const following = next.findIndex((s, i) => i > at && s.status === 'pending')
    if (following >= 0) next[following].status = 'in_progress'
  }
  if (Array.isArray(input.done)) for (const n of input.done) if (typeof n === 'number' && next[n - 1]) next[n - 1].status = 'completed'
  if (typeof input.start === 'number' && next[input.start - 1]) {
    for (const s of next) if (s.status === 'in_progress') s.status = 'pending'
    next[input.start - 1].status = 'in_progress'
  }
  return next
}

/** A turn's wrap_up checks the list off, as the Claude app's does: the work it planned is over. */
export function finishPlan(steps: readonly PlanStep[]): PlanStep[] {
  return steps.map((s) => ({ ...s, status: 'completed' }))
}

/** The list after every update_plan (and wrap_up) call in these, oldest first. */
export function planOf(calls: readonly { name: string; input: unknown }[]): PlanStep[] {
  let steps: PlanStep[] = []
  for (const c of calls) {
    if (PLAN_TOOLS.has(c.name)) steps = applyPlan(steps, c.input)
    else if (WRAP_TOOLS.has(c.name) && wrapUpOf(c.input)) steps = finishPlan(steps)
  }
  return steps
}

/** "Plan shown (4 steps)." / "Plan updated: step 2 of 4 is in progress." — what the tool answers. */
export function planAnswer(steps: readonly PlanStep[], replaced: boolean): string {
  if (!steps.length) return 'Plan cleared.'
  if (replaced) return `Plan shown (${steps.length} step${steps.length === 1 ? '' : 's'}).`
  const at = steps.findIndex((s) => s.status === 'in_progress')
  if (at >= 0) return `Plan updated: step ${at + 1} of ${steps.length} is in progress.`
  return steps.every((s) => s.status === 'completed') ? 'Plan updated: every step is done.' : 'Plan updated.'
}

/** A next-step box: what's now true, and the one question with its buttons. */
export interface WrapUp {
  recap: string
  ask: string | null
  actions: { label: string; action?: string }[]
  blocked: boolean
}

export function wrapUpOf(input: unknown): WrapUp | null {
  if (!isObj(input) || typeof input.recap !== 'string' || !input.recap.trim()) return null
  const actions = (Array.isArray(input.actions) ? input.actions : [])
    .flatMap((a): WrapUp['actions'] => (isObj(a) && typeof a.label === 'string' && a.label.trim() ? [{ label: a.label.trim().slice(0, 40), ...(typeof a.action === 'string' ? { action: a.action } : {}) }] : []))
    .slice(0, 2)
  const ask = typeof input.ask === 'string' && input.ask.trim() ? input.ask.trim().slice(0, 200) : null
  return { recap: input.recap.trim().slice(0, 600), ask, actions: ask ? actions : [], blocked: input.blocked === true }
}

/** A chapter's title (and its summary, shown on hover in the table of contents). */
export function chapterOf(input: unknown): { title: string; summary: string | null } | null {
  if (!isObj(input) || typeof input.title !== 'string' || !input.title.trim()) return null
  return { title: input.title.trim().slice(0, 80), summary: typeof input.summary === 'string' && input.summary.trim() ? input.summary.trim().slice(0, 200) : null }
}

/** An inline widget: SVG or HTML, and its name. */
export function widgetOf(input: unknown): { title: string; code: string; svg: boolean } | null {
  if (!isObj(input) || typeof input.widget_code !== 'string' || !input.widget_code.trim()) return null
  const code = input.widget_code
  return { title: typeof input.title === 'string' && input.title.trim() ? input.title.trim().slice(0, 80) : 'widget', code, svg: /^\s*<svg[\s>]/i.test(code) }
}
