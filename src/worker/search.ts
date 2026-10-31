// Search inside conversations: which sessions said something, with a snippet
// around it, as the Claude app's full-text search does (message text, tool
// input and output; never images). A transcript is scanned as bytes for the
// words as JSON would write them, and only a line that matches is parsed, to
// check the words are in what it says rather than in an image's data or a key.
import { closeSync, openSync, readSync } from 'node:fs'

const CHUNK = 1 << 20
/** Text kept either side of the match in a snippet. */
const BEFORE = 50
const AFTER = 110
/** A line longer than this is skipped (nothing that long is text). */
const LINE_MAX = 64 << 20

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** What a transcript line says, as text: its messages, tool calls' input and their results. */
export function lineText(line: unknown): string {
  if (!isObj(line) || (line.type !== 'user' && line.type !== 'assistant') || line.isSidechain === true) return ''
  const message = line.message
  if (!isObj(message)) return ''
  const parts: string[] = []
  const walk = (content: unknown) => {
    if (typeof content === 'string') parts.push(content)
    else if (Array.isArray(content))
      for (const block of content) {
        if (!isObj(block)) continue
        if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
        else if (block.type === 'tool_use' && isObj(block.input)) parts.push(Object.values(block.input).filter((v): v is string => typeof v === 'string').join('\n'))
        else if (block.type === 'tool_result') walk(block.content)
      }
  }
  walk(message.content)
  return parts.join('\n')
}

/** A snippet around the first match of `lower` in `text`, on one line. */
export function snippet(text: string, lower: string): string | null {
  const at = text.toLowerCase().indexOf(lower)
  if (at < 0) return null
  const start = Math.max(0, at - BEFORE)
  const end = Math.min(text.length, at + lower.length + AFTER)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

/** A copy with ASCII letters lowered (enough for the bytes JSON writes; other scripts match as typed). */
function lowered(buf: Buffer): Buffer {
  const out = Buffer.from(buf)
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (c >= 65 && c <= 90) out[i] = c + 32
  }
  return out
}

/** The first line of `lines` (whole lines, each ending in a newline) that says `lower`, as a snippet. */
function findIn(lines: Buffer, needle: Buffer, lower: string): string | null {
  const low = lowered(lines)
  let from = 0
  for (let hit = low.indexOf(needle, from); hit >= 0; hit = low.indexOf(needle, from)) {
    const start = low.lastIndexOf(10, hit) + 1
    let end = low.indexOf(10, hit)
    if (end < 0) end = low.length
    try {
      const text = lineText(JSON.parse(lines.toString('utf8', start, end)))
      const found = text && snippet(text, lower)
      if (found) return found
    } catch {
      // A half-written line: nothing to say.
    }
    from = end + 1
  }
  return null
}

/** The first place a transcript says `query` (case-insensitive), as a snippet; null when it never does. */
export function searchFile(file: string, query: string): string | null {
  const lower = query.toLowerCase()
  // How the words look inside a JSON string: quotes, backslashes and line breaks escaped.
  const needle = Buffer.from(JSON.stringify(lower).slice(1, -1), 'utf8')
  if (!needle.length) return null
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch {
    return null
  }
  try {
    const chunk = Buffer.alloc(CHUNK)
    let carry: Buffer = Buffer.alloc(0)
    let position = 0
    for (;;) {
      const n = readSync(fd, chunk, 0, CHUNK, position)
      position += n
      if (n === 0) return carry.length ? findIn(carry, needle, lower) : null
      const data = carry.length ? Buffer.concat([carry, chunk.subarray(0, n)]) : chunk.subarray(0, n)
      const last = data.lastIndexOf(10)
      if (last < 0) {
        // One long line so far (a screenshot's runs to megabytes): keep reading, up to a point.
        carry = data.length > LINE_MAX ? Buffer.alloc(0) : Buffer.from(data)
        continue
      }
      const found = findIn(data.subarray(0, last + 1), needle, lower)
      if (found) return found
      carry = Buffer.from(data.subarray(last + 1))
    }
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}
