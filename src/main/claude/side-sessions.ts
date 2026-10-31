// Side sessions, as the Claude app runs them: a session Claude starts for a
// task of its own while it stays with you. Claude can start one now (you asked
// for separate work), offer one and wait for your "New Session" or "Do It
// Here", or propose one as a card you may start. A session it started is
// linked to it (named, filed beside it); when that session ends a turn, Gloom
// tells the one that started it what it said, in a <side-sessions-event>
// message, once that one is idle.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { LibraryOp, SessionEntry, SessionMeta } from '@shared/library'
import type { LiveEvent, LiveSummary, ModeId } from '@shared/live'
import type { StartRequest } from './gloom-tools'

/** What a report quotes of the session's latest reply, as the Claude app's note does. */
const NOTE_CHARS = 400

/** A session Claude proposed (own initiative) or offered, waiting for you. */
export interface Proposal {
  taskId: string
  from: string
  title: string
  prompt: string | null
  background: string | null
  context: 'fresh' | 'fork'
  useWorktree: boolean | null
  model: string | null
  name: string | null
}

export interface SideHost {
  /** The session's entry and index row. */
  meta(id: string): SessionMeta | undefined
  entry(id: string): SessionEntry | undefined
  summary(id: string): LiveSummary | undefined
  /** A new session (in a worktree when asked), resolving to its ID; forked sessions start from `forkFrom`. */
  create(request: { cwd: string; model: string | null; mode: ModeId; worktree: boolean; forkFrom: string | null; title: string }): Promise<string>
  send(id: string, text: string): void
  /** The latest reply text the session's process showed. */
  lastReply(id: string): string | null
  applyLibrary(op: LibraryOp): void
  /** Asks you in the session's chat: New Session or Do It Here. */
  offer(from: string, title: string): Promise<'new' | 'here'>
  event(event: LiveEvent): void
}

/** "Build the palette" → "build-the-palette": a handle a family refers to it by. */
export function handleFor(title: string, taken: (name: string) => boolean): string {
  const base = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'session').slice(0, 24).replace(/-+$/, '')
  if (!taken(base)) return base
  for (let n = 2; ; n++) {
    const name = `${base.slice(0, 24 - String(n).length - 1)}-${n}`
    if (!taken(name)) return name
  }
}

export class SideSessions {
  private readonly proposals = new Map<string, Proposal>()
  /** Children by parent, and names, for this launch (the library keeps startedBy and name across launches). */
  private readonly names = new Map<string, string>()

  constructor(private readonly host: SideHost) {}

  /** start_session: now, as an offer, or as a proposal; or a proposal you told it to start. */
  async start(from: string, request: StartRequest): Promise<string> {
    if (request.proposalId) {
      const proposal = this.proposals.get(request.proposalId)
      if (!proposal || proposal.from !== from) throw new Error('No such proposal from this session (it was started or dismissed).')
      this.proposals.delete(request.proposalId)
      const id = await this.launch({ ...proposal, prompt: request.prompt ?? proposal.prompt, background: request.background ?? proposal.background })
      return this.started(id)
    }
    if (request.initiation === 'offer') {
      const taskId = randomUUID()
      this.proposals.set(taskId, this.proposal(taskId, from, request))
      this.host.event({ type: 'proposal', id: from, proposal: { taskId, title: request.title, kind: 'offer' } })
      const choice = await this.host.offer(from, request.title)
      if (choice === 'here') {
        this.proposals.delete(taskId)
        return 'The user chose Do It Here: carry on with the task in this session.'
      }
      return `The user chose New Session. Call start_session again with proposal_id "${taskId}", a prompt (the task, the files or area, what done looks like) and background (for "fresh"), and nothing else.`
    }
    if (request.initiation === 'own_initiative') {
      const taskId = randomUUID()
      this.proposals.set(taskId, this.proposal(taskId, from, request))
      this.host.event({ type: 'proposal', id: from, proposal: { taskId, title: request.title, kind: 'proposal' } })
      return `Proposed as a card (task_id=${taskId}). Nothing runs until the user starts it.`
    }
    const id = await this.launch(this.proposal('', from, request))
    return this.started(id)
  }

  /** A proposal card's Start, clicked in the window. */
  async startProposal(taskId: string): Promise<string> {
    const proposal = this.proposals.get(taskId)
    if (!proposal) throw new Error('That proposal was started or withdrawn already.')
    if (!proposal.prompt) throw new Error('Claude hasn’t written that session’s brief yet.')
    this.proposals.delete(taskId)
    return this.launch(proposal)
  }

  dismiss(from: string, taskId: string): string {
    const proposal = this.proposals.get(taskId)
    if (!proposal || proposal.from !== from) return 'Nothing to withdraw: it was started, dismissed, or never proposed here.'
    this.proposals.delete(taskId)
    this.host.event({ type: 'proposal-gone', id: from, taskId })
    return 'Withdrawn.'
  }

  /** Whether a proposal still waits (the window greys out a card that doesn't). */
  pending(taskId: string): boolean {
    return this.proposals.has(taskId)
  }

  /** hand_off_to_session: a fork of the conversation, told the remaining plan. */
  async handOff(from: string, title: string, plan: string): Promise<string> {
    const id = await this.launch({ taskId: '', from, title, prompt: `Carry on with this task, handed off from the conversation above so it could answer something else:\n\n${plan}`, background: null, context: 'fork', useWorktree: false, model: null, name: null })
    return `Handed off to session "${title}" (${this.names.get(id)}, ${id}). Stop that task here and answer the user's new message.`
  }

  /** send_message: to a session by its ID or the name it was started under. */
  send(from: string, to: string, text: string): string {
    const id = this.resolve(to)
    if (!id) throw new Error(`No session called "${to}". list_sessions {linked: true} lists the ones this session started.`)
    if (id === from) throw new Error('That’s this session.')
    this.host.send(id, text)
    return `Sent to ${this.names.get(id) ?? id}.`
  }

  /**
   * A session's turn ended: the session that started it hears what it said, as
   * the Claude app's <side-sessions-event> (queued behind a turn under way).
   */
  turnEnded(id: string, ok: boolean, waiting: boolean): void {
    const parent = this.host.entry(id)?.startedBy
    if (!parent || !this.host.meta(parent)?.cwd) return
    const name = this.host.entry(id)?.name ?? this.names.get(id) ?? id.slice(0, 8)
    const title = this.host.meta(id)?.title ?? name
    const reply = (this.host.lastReply(id) ?? '').trim()
    const quoted = reply.length > NOTE_CHARS ? `${reply.slice(0, NOTE_CHARS)}…` : reply
    const how = waiting ? 'is waiting for the user' : ok ? 'ended a turn' : 'stopped with an error'
    this.host.send(
      parent,
      `<side-sessions-event>\nSession "${title}" (${name}, ${id}) ${how}.${quoted ? ` Its latest report:\n${quoted}` : ''}\nThis is that session's report, not proof: check its work before you tell the user it's done.\n</side-sessions-event>`
    )
  }

  private proposal(taskId: string, from: string, r: StartRequest): Proposal {
    return { taskId, from, title: r.title, prompt: r.prompt, background: r.background, context: r.context, useWorktree: r.useWorktree, model: r.model, name: r.name }
  }

  private resolve(to: string): string | null {
    if (this.host.meta(to) || this.host.summary(to)) return to
    for (const [id, name] of this.names) if (name === to) return id
    return null
  }

  private started(id: string): string {
    return `Started session "${this.host.meta(id)?.title ?? 'New Session'}" as ${this.names.get(id)} (${id}). It works on its own; when it ends a turn, a <side-sessions-event> message here says what it reported.`
  }

  /** Makes the session (beside the one that asked, in its folder), links it, and sends it its brief. */
  private async launch(p: Proposal): Promise<string> {
    const parent = this.host.meta(p.from)
    const summary = this.host.summary(p.from)
    const cwd = summary?.cwd ?? parent?.cwd
    if (!cwd || !existsSync(cwd)) throw new Error('This session’s working folder is gone, so a session can’t start beside it.')
    const id = await this.host.create({
      cwd,
      model: p.model ?? summary?.model ?? null,
      mode: summary?.mode ?? 'default',
      worktree: p.context === 'fresh' && p.useWorktree !== false && p.useWorktree !== null ? true : false,
      forkFrom: p.context === 'fork' ? p.from : null,
      title: p.title
    })
    const taken = new Set([...this.names.values()])
    const name = handleFor(p.name || p.title, (n) => taken.has(n))
    this.names.set(id, name)
    const folderId = this.host.entry(p.from)?.folderId ?? null
    this.host.applyLibrary({ type: 'linkSession', id, startedBy: p.from, name, title: p.title || null })
    if (folderId) this.host.applyLibrary({ type: 'moveSessions', ids: [id], folderId })
    const brief = p.context === 'fork' ? (p.prompt ?? '') : [p.prompt, p.background ? `\nBackground:\n${p.background}` : ''].filter(Boolean).join('\n')
    if (brief.trim()) this.host.send(id, brief)
    this.host.event({ type: 'linked', id, parent: p.from, name })
    return id
  }
}
