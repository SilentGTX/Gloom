// Export, as the Claude app's session menu has it: a zip in your Downloads
// folder holding the conversation's transcript, its subagents' transcripts
// and what Gloom knows of the session, nothing uploaded. Windows' own tar.exe
// writes the zip (it takes the format from the file name).
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, copyFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { displayTitle, type SessionEntry, type SessionMeta } from '@shared/library'
import { systemExe } from './exec'

const run = promisify(execFile)

/** A file name from a title: no characters Windows refuses, not too long. */
export function exportName(title: string, at: Date): string {
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '') || 'Session'
  const day = at.toISOString().slice(0, 10)
  return `${safe} ${day}.zip`
}

/** A name in `folder` that isn't taken yet: "x.zip", "x (2).zip"… */
function freeName(folder: string, name: string): string {
  if (!existsSync(join(folder, name))) return name
  const stem = name.replace(/\.zip$/, '')
  for (let n = 2; ; n++) if (!existsSync(join(folder, `${stem} (${n}).zip`))) return `${stem} (${n}).zip`
}

/** Writes the zip; resolves to its path and size. */
export async function exportSession(meta: SessionMeta, entry: SessionEntry | undefined): Promise<{ path: string; size: number }> {
  if (!meta.file || !existsSync(meta.file)) throw new Error('That session’s transcript is gone.')
  const stage = mkdtempSync(join(tmpdir(), 'gloom-export-'))
  try {
    const root = join(stage, meta.id)
    mkdirSync(root)
    copyFileSync(meta.file, join(root, basename(meta.file)))
    // Subagents' transcripts live in <id>/subagents beside it (older ones are agent-*.jsonl, not tied to one session).
    const subagents = join(dirname(meta.file), meta.id, 'subagents')
    if (existsSync(subagents) && statSync(subagents).isDirectory()) {
      mkdirSync(join(root, 'subagents'))
      for (const name of readdirSync(subagents)) if (name.endsWith('.jsonl')) copyFileSync(join(subagents, name), join(root, 'subagents', name))
    }
    const metadata = {
      id: meta.id,
      title: displayTitle(meta, entry),
      workingFolder: meta.cwd,
      branch: meta.gitBranch,
      created: new Date(meta.created).toISOString(),
      lastActivity: new Date(meta.updated).toISOString(),
      startedFrom: meta.entrypoint,
      claudeCodeVersion: meta.version,
      exportedBy: `Gloom ${app.getVersion()}`
    }
    writeFileSync(join(root, 'session.json'), JSON.stringify(metadata, null, 2))
    const downloads = app.getPath('downloads')
    mkdirSync(downloads, { recursive: true })
    const path = join(downloads, freeName(downloads, exportName(metadata.title, new Date())))
    await run(systemExe('tar.exe'), ['-a', '-c', '-f', path, '-C', stage, meta.id], { windowsHide: true, timeout: 120_000 })
    return { path, size: statSync(path).size }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}
