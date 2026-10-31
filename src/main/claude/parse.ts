// Checks what the window sends about live sessions before it reaches a
// process. The window is our own page, but nothing malformed goes to the CLI.
import { isAbsolute } from 'node:path'
import { isEffort, isMode, type CardAnswer, type ImageAttachment, type NewSessionRequest, type RewindRequest, type SendRequest, type SetRequest } from '@shared/live'

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Claude Code's session IDs are UUIDs. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
/** What one message may carry: about what the API takes. */
const TEXT_MAX = 2_000_000
const IMAGES_MAX = 20
const IMAGE_MAX = 10 * 1024 * 1024

function str(v: unknown, what: string, max = 4096): string {
  if (typeof v !== 'string' || v.length > max) throw new Error(`bad ${what}`)
  return v
}

export function sessionId(v: unknown): string {
  if (typeof v !== 'string' || !SESSION_ID.test(v)) throw new Error('bad session ID')
  return v
}

function model(v: unknown): string | null {
  if (v === null) return null
  const s = str(v, 'model', 200)
  if (!/^[\w.:[\]-]+$/.test(s)) throw new Error('bad model')
  return s
}

export function parseNewSession(raw: unknown): NewSessionRequest {
  if (!isRecord(raw)) throw new Error('bad request')
  if (!isMode(raw.mode)) throw new Error('bad mode')
  if (raw.effort !== null && !isEffort(raw.effort)) throw new Error('bad effort')
  return { cwd: str(raw.cwd, 'folder', 1024), model: model(raw.model), mode: raw.mode, effort: raw.effort, worktree: raw.worktree === true }
}

/** A rewind: the message (a UUID, its checkpoint), and what goes back. */
export function parseRewind(raw: unknown): RewindRequest {
  if (!isRecord(raw)) throw new Error('bad rewind')
  if (raw.conversation !== true && raw.code !== true) throw new Error('nothing to rewind')
  return { messageId: sessionId(raw.messageId), conversation: raw.conversation === true, code: raw.code === true }
}

export function parseSend(raw: unknown): SendRequest {
  if (!isRecord(raw)) throw new Error('bad message')
  const images = Array.isArray(raw.images) ? raw.images : []
  if (images.length > IMAGES_MAX) throw new Error(`A message can carry ${IMAGES_MAX} images at most.`)
  const parsed: ImageAttachment[] = images.map((img) => {
    if (!isRecord(img) || typeof img.mediaType !== 'string' || !MEDIA_TYPES.has(img.mediaType)) throw new Error('bad image')
    const data = str(img.data, 'image', IMAGE_MAX * 1.4)
    if (!/^[A-Za-z0-9+/=]*$/.test(data.slice(0, 256))) throw new Error('bad image')
    return { mediaType: img.mediaType, data }
  })
  const text = str(raw.text, 'message', TEXT_MAX)
  if (!text.trim() && parsed.length === 0) throw new Error('empty message')
  return { id: sessionId(raw.id), text, images: parsed }
}

export function parseSet(raw: unknown): SetRequest {
  if (!isRecord(raw)) throw new Error('bad request')
  if ('model' in raw) return { model: model(raw.model) }
  if ('mode' in raw && isMode(raw.mode)) return { mode: raw.mode }
  if ('effort' in raw && (raw.effort === null || isEffort(raw.effort))) return { effort: raw.effort }
  if ('fast' in raw && typeof raw.fast === 'boolean') return { fast: raw.fast }
  if ('outputStyle' in raw) return { outputStyle: raw.outputStyle === null ? null : str(raw.outputStyle, 'output style', 200) }
  if ('folders' in raw && Array.isArray(raw.folders) && raw.folders.length <= 100)
    return {
      folders: raw.folders.map((f) => {
        const folder = str(f, 'folder', 1024)
        if (!isAbsolute(folder)) throw new Error('bad folder')
        return folder
      })
    }
  throw new Error('bad request')
}

/** An MCP server's name, as its process listed it. */
export function serverName(v: unknown): string {
  const name = str(v, 'server', 200)
  if (!name.trim()) throw new Error('bad server')
  return name
}

export function parseAnswer(raw: unknown): CardAnswer {
  if (!isRecord(raw)) throw new Error('bad answer')
  const requestId = str(raw.requestId, 'request', 200)
  const note = raw.note === undefined ? undefined : str(raw.note, 'note', 20_000)
  switch (raw.kind) {
    case 'permission': {
      const decision = raw.decision
      if (decision !== 'once' && decision !== 'always' && decision !== 'deny') throw new Error('bad decision')
      const always = typeof raw.always === 'number' && Number.isInteger(raw.always) && raw.always >= 0 ? raw.always : undefined
      return { kind: 'permission', requestId, decision, always, note }
    }
    case 'plan':
      if (raw.approve === true) {
        if (!isMode(raw.mode)) throw new Error('bad mode')
        return { kind: 'plan', requestId, approve: true, mode: raw.mode }
      }
      return { kind: 'plan', requestId, approve: false, note: note ?? '' }
    case 'offer':
      if (raw.choice !== 'new' && raw.choice !== 'here') throw new Error('bad choice')
      return { kind: 'offer', requestId, choice: raw.choice }
    case 'question': {
      if (raw.declined === true) return { kind: 'question', requestId, declined: true }
      if (!isRecord(raw.answers)) throw new Error('bad answers')
      const answers = Object.fromEntries(Object.entries(raw.answers).map(([q, a]) => [str(q, 'question', 2000), str(a, 'answer', 20_000)]))
      return { kind: 'question', requestId, answers }
    }
    default:
      throw new Error('bad answer')
  }
}
