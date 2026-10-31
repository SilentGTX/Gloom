// Where Gloom finds the programs it starts. Windows looks for a bare name like
// `git` in the folder a process starts in before it looks on PATH, so running
// git in a repository that carries its own git.exe would run that one. Every
// program Gloom starts in a folder it didn't choose goes by its full path.
import { existsSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

/** The first `exe` in PATH's absolute folders (a relative entry would mean the current folder). */
export function onPath(exe: string): string | null {
  for (const raw of (process.env.PATH ?? '').split(delimiter)) {
    const dir = raw.replace(/^"|"$/g, '')
    if (!dir || !isAbsolute(dir)) continue
    const candidate = join(dir, exe)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** A program of Windows' own, under System32 (`taskkill.exe`, `WindowsPowerShell\v1.0\powershell.exe`). */
export function systemExe(path: string): string {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', path)
}

let git: string | null | undefined
/** git, found once on PATH. */
export function gitExe(): string {
  git ??= onPath('git.exe')
  if (!git) throw new Error('Git isn’t installed, or isn’t on PATH.')
  return git
}
