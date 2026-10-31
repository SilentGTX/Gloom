// SSH sessions, as the Claude app runs them: Claude Code runs on another
// machine over ssh (your own ssh, with its config and keys), its conversation
// streamed into Gloom like a local one, its transcript copied back after each
// turn into ~/.claude/projects/ssh-<connection>/, where the Claude app keeps
// its copies too. Pure helpers, shared by main and the tests.

/** A string as one word for a POSIX shell: in single quotes, its own single quotes closed and escaped. */
export function shellWord(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * What ssh runs on the other machine: into the session's folder, then Claude
 * Code with the SDK's arguments and the variables it needs. `~` at the start
 * of the folder stays the remote home.
 */
export function remoteCommand(cwd: string, claude: string, args: readonly string[], env: Record<string, string>): string {
  const dir = cwd === '~' ? '~' : cwd.startsWith('~/') ? `~/${shellWord(cwd.slice(2))}` : shellWord(cwd)
  const vars = Object.entries(env).map(([k, v]) => `${k}=${shellWord(v)}`)
  return `cd ${dir} && exec ${vars.length ? `env ${vars.join(' ')} ` : ''}${shellWord(claude)} ${args.map(shellWord).join(' ')}`
}

/** The folder Claude Code keeps a working folder's sessions in: every character but letters and digits becomes "-". */
export function projectFolder(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/** The variables a remote Claude Code needs from what the SDK sets (its entry point, the SDK's own, Gloom's). */
export function forwardedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined && /^(CLAUDE_CODE_|CLAUDE_AGENT_SDK)/.test(k)) out[k] = v
  return out
}

/** A connection's handle in folder names: its id, letters, digits and dashes. */
export function connectionFolder(id: string): string {
  return `ssh-${id.replace(/[^a-zA-Z0-9-]/g, '-')}`
}
