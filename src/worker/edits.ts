// Claude's edits in a transcript, for the diff pane's This Session. The whole
// file is read once, forward, but only lines that carry a patch are decoded:
// a big transcript is mostly screenshots, which never are. What's been read is
// kept, so a growing transcript costs only its new lines.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { editOpOf, type EditOp } from '@shared/diff'

const CHUNK = 1024 * 1024
/** An edit's line is never this long; anything longer (a screenshot) is passed over without decoding. */
const LINE_MAX = 32 * 1024 * 1024
/** Transcripts whose edits are kept read, newest first. */
const KEEP = 4

const MARKER = Buffer.from('"structuredPatch"')

interface Scan {
  /** Just past the last complete line read. */
  end: number
  ops: EditOp[]
}

const scans = new Map<string, Scan>()

/** Every edit in the transcript, oldest first. */
export function readEdits(file: string): EditOp[] {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    let scan = scans.get(file)
    // A file that shrank was rewritten: read it again from the start.
    if (!scan || size < scan.end) scan = { end: 0, ops: [] }
    scan.end = scanFrom(fd, scan.end, size, (line) => {
      try {
        const e = JSON.parse(line) as unknown
        const op = e && typeof e === 'object' && !Array.isArray(e) ? editOpOf(e as Record<string, unknown>) : null
        if (op) scan.ops.push(op)
      } catch {
        // A line still being written, or not JSON: not an edit.
      }
    })
    scans.delete(file)
    scans.set(file, scan)
    while (scans.size > KEEP) scans.delete(scans.keys().next().value!)
    return scan.ops
  } finally {
    closeSync(fd)
  }
}

/** Calls `fn` with each complete line in [start, end) that holds the marker. Returns the offset past the last complete line. */
function scanFrom(fd: number, start: number, end: number, fn: (line: string) => void): number {
  let pos = start
  let lineStart = start
  let pieces: Buffer[] = []
  let length = 0
  let skipping = false
  while (pos < end) {
    const buf = Buffer.allocUnsafe(Math.min(CHUNK, end - pos))
    const n = readSync(fd, buf, 0, buf.length, pos)
    if (n <= 0) break
    let from = 0
    for (;;) {
      const nl = buf.indexOf(10, from)
      if (nl === -1 || nl >= n) {
        // The line goes on into the next chunk.
        if (!skipping) {
          length += n - from
          if (length > LINE_MAX) {
            skipping = true
            pieces = []
          } else pieces.push(buf.subarray(from, n))
        }
        break
      }
      if (!skipping) {
        const piece = buf.subarray(from, nl)
        const line = pieces.length ? Buffer.concat([...pieces, piece]) : piece
        if (line.indexOf(MARKER) !== -1) fn(line.toString('utf8'))
      }
      pieces = []
      length = 0
      skipping = false
      from = nl + 1
      lineStart = pos + from
    }
    pos += n
  }
  return lineStart
}
