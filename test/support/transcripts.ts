// Synthetic Claude Code transcripts for tests, in the shapes the indexer reads:
// a queued prompt, the user message, an assistant reply, the CLI's title and
// last prompt. Field order follows the real files.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FakeSession {
  id: string
  cwd: string
  prompt: string
  /** The CLI's title (ai-title). */
  title?: string
  /** The Claude app's title (custom-title), which wins. */
  customTitle?: string
  created?: string
  updated?: string
  /** Kilobytes of tool output between the first prompt and the end. */
  padKb?: number
  /** What started it: 'cli' (a terminal, the default), 'claude-desktop' (the Claude app)… */
  entrypoint?: string
}

/** How Claude Code names a project's folder: every separator and dot becomes a dash. */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[:\\/.]/g, '-')
}

export function transcriptLines(s: FakeSession): string[] {
  const created = s.created ?? '2026-10-01T10:00:00.000Z'
  const updated = s.updated ?? '2026-10-01T10:05:00.000Z'
  const common = { cwd: s.cwd, sessionId: s.id, version: '2.1.314', gitBranch: 'main', entrypoint: s.entrypoint ?? 'cli' }
  const lines = [
    { type: 'queue-operation', operation: 'enqueue', timestamp: created, sessionId: s.id, content: s.prompt },
    { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: s.prompt }, uuid: 'u1', timestamp: created, ...common }
  ]
  if (s.padKb) {
    const chunk = 'x'.repeat(1000)
    for (let i = 0; i < s.padKb; i++) {
      lines.push({
        parentUuid: 'u1',
        isSidechain: false,
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', content: chunk }] },
        uuid: `p${i}`,
        timestamp: created,
        ...common
      } as never)
    }
  }
  lines.push({ parentUuid: 'u1', isSidechain: false, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }, uuid: 'a1', timestamp: updated, ...common } as never)
  if (s.title) lines.push({ type: 'ai-title', aiTitle: s.title, sessionId: s.id } as never)
  if (s.customTitle) lines.push({ type: 'custom-title', customTitle: s.customTitle, sessionId: s.id } as never)
  lines.push({ type: 'last-prompt', lastPrompt: s.prompt, leafUuid: 'a1', sessionId: s.id } as never)
  return lines.map((l) => JSON.stringify(l))
}

/** Writes a transcript where Claude Code would; returns its path. */
export function writeTranscript(projectsDir: string, s: FakeSession, project = projectDirName(s.cwd)): string {
  const dir = join(projectsDir, project)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${s.id}.jsonl`)
  writeFileSync(file, transcriptLines(s).join('\n') + '\n')
  return file
}

export function appendEntries(file: string, entries: object[]): void {
  appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
}
