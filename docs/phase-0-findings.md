# Phase 0 — what the spike found

Recorded 2026-10-30 on this PC with Agent SDK 0.3.314, against your `claude.exe` 2.1.186 and the
SDK's own 2.1.314. **The SDK covers everything v1 needs; the raw-CLI fallback isn't needed.** The
one real problem is your CLI's version (see the first section).

Re-run: `npm run spike -- <check>|all` (`GLOOM_CLAUDE_EXE=<path>` and `GLOOM_SPIKE_TAG=<tag>` to try
another CLI build). Results land in `tools/sdk-spike/results/` and raw streams in
`tools/fake-claude/fixtures/`. `npm run fake-claude:test` replays every stream through the real SDK;
all 29 replay message for message. `test/fixtures/transcripts/` holds spike transcripts for the
parser tests (a rewind branch, an interrupt, permissions, plan, question, queue, a worktree session).

## 1. Which `claude.exe` — needs your decision

| Build | Version | Notes |
| --- | --- | --- |
| Your terminal CLI, `~/.local/bin/claude.exe` | 2.1.186 | `autoUpdatesChannel: latest`, but it only updates when run in a terminal, and its login had expired, so it hasn't run in a while |
| The Claude app's own copy | 2.1.309 | `%LOCALAPPDATA%\Claude-Data\…\claude-code\2.1.309\` |
| Bundled with SDK 0.3.314 | 2.1.314 | 301 MB optional dependency |

2.1.186 works for everything in v1, but:
- its model aliases are a generation old: `haiku` = Haiku 4.5, `sonnet` = Sonnet 4.6. On 2.1.314,
  `haiku` = Haiku 5.5 and `default` = Opus 5.5;
- it rejects a newer SDK flag outright: `--resume-drops-turn` (the edit guard) made it exit with
  `unknown option`. The SDK passes flags without checking the CLI's version.

**Recommendation:** keep using your own `claude.exe` (same login, same version as your terminal), but
Gloom checks its version at start and offers **Update Claude Code** (runs `claude update`) when it is
older than the SDK expects; features that need a newer CLI stay off until then. Shipping the 301 MB
bundled CLI would pin the version but make the installer huge and drift from your terminal.

## 2. SDK checks

| Check | Result on 2.1.186 | Same on 2.1.314? |
| --- | --- | --- |
| Two turns in one process | One process, same session ID, a fresh `system/init` each turn | yes |
| Interrupt | `interrupt()` ends the turn in ~6 ms: `result` `error_during_execution`, `terminal_reason: aborted_streaming`, a `[Request interrupted by user]` user message; partial text kept; next prompt works in the same process | yes, plus an interrupt receipt |
| Sending while Claude works | The CLI queues it and runs it as its own turn after the current one | yes; also emits `command_lifecycle` queued / started / completed |
| Resume | Keeps the session ID and the same file; history remembered | — |
| Permission answered from code | `canUseTool` gets `displayName`, `description`, `blockedPath`, `toolUseID`, and **suggestions** (see §3) | — |
| Plan approval | ExitPlanMode arrives through `canUseTool` with `{ plan }` (2.1.314 adds `planFilePath`); deny with a note = keep planning; allow with `updatedPermissions: [{type:'setMode', mode, destination:'session'}]` = approve and pick the next mode | yes |
| AskUserQuestion | Through `canUseTool`; answer with `updatedInput.answers = { [question]: label }` | yes, no extra env var needed |
| Live model switch | `setModel()` applies from the next turn | yes |
| Live mode switch | `setPermissionMode()` applies from the next turn, **Bypass included** (process started with `allowDangerouslySkipPermissions`) | yes |
| Live effort | `applyFlagSettings({ effortLevel })` is accepted (the CLI logs "Settings changed from flagSettings"); the stream never reports the level back, on either build | yes |
| File rewind | `enableFileCheckpointing` + `rewindFiles(userMessageUuid, { dryRun })`: preview gives files and +/−; real rewinds restore. **The UUIDs Gloom puts on its user messages are the checkpoint IDs.** Only Write/Edit changes are covered, as with `/rewind` | yes (Haiku 5.5 tends to edit through Bash, which isn't covered) |
| Edit an earlier message | `resume` + `resumeSessionAt: <last entry of the kept turn>` continues from there in the same session and file; the old turn stays in the file as a branch; `getSessionMessages()` returns only the newest chain | yes, and `resumeDropsTurn` works there |
| Worktrees | `--worktree <name>` (via `extraArgs`) works in SDK mode | same naming |
| Cold start | Ready 0.8 s after spawn, first token 1.7–1.9 s (Haiku); no MCP servers configured beyond your claude.ai connectors | 0.9 s / 2.7 s |
| Pre-warmed process | `startup()` then `query()`: first token 0.9 s instead of 1.7 s | — |
| Titles | The CLI writes `ai-title` entries in SDK mode, for every session | yes |
| Context meter | `getContextUsage({ detail: 'summary' })` → `totalTokens`, `rawMaxTokens`, `percentage`, `autoCompactThreshold`, `categories[]`. **The SDK's published type uses other (snake_case) names; parse defensively.** Your `modelSettings` cut Haiku 5.5's window to 100k, and the call reports that | same shape, adds `kind` per category |
| Usage limits | Every turn: `rate_limit_event` (status, `rateLimitType: five_hour`, `resetsAt`). On demand: the experimental `usage_…()` call → 5-hour 25%, weekly 33%, per-model weekly (Fable) with reset times | — |
| Expired login | `api_retry` ×2 with `error_status: 401`, then a synthetic assistant message and a `result` with `api_error_status: 401`. `claude auth status` still says logged in | — |

## 3. Details the session runner and reducer need

- **One assistant message per content block.** Thinking, text and each tool_use arrive as separate
  `assistant` messages sharing `message.id`; merge by id.
- Other messages seen: `system/status` (`requesting`, or a `permissionMode` change), `system/thinking_tokens`,
  `system/api_retry`, `rate_limit_event`; on 2.1.314 also `system/commands_changed` and
  `command_lifecycle`. Frames the CLI marks `sdk_host_only` (2.1.314's `session_state_changed`) never
  reach the host.
- **A dead CLI rejects more than the iterator.** When the process exits early the SDK throws
  "Claude Code process exited with code 1"; any query promise left without a handler crashes Node.
  The runner catches inside its read loop and never leaves one unawaited.
- **A missing working folder gives a misleading SDK error** ("native binary … failed to launch …
  libc"). Gloom checks the folder exists before starting.
- **Permission suggestions are typed updates**, each with a destination: `setMode acceptEdits`
  ("allow edits for this session"), `addDirectories` (this folder), `addRules` (a command rule,
  for `session` / `localSettings` / …). In the spike, "Always allow" on a `mkdir` in the working
  folder suggested *switching to Accept edits*, after which a delete went through without asking.
  The card spells out what each option does.
- **Shell tool on Windows:** 2.1.186 used `PowerShell`, 2.1.314 `Bash` (Git Bash). Tool rows handle both.
- **Plan mode may change the model:** on 2.1.186, plan-mode turns ran on Sonnet 4.6 although the
  session model was Haiku, and went back after approval. The header shows the model from the
  assistant messages, not the one requested.
- ExitPlanMode is a deferred tool on 2.1.186 (loaded through ToolSearch first); the plan is also
  saved to `~/.claude/plans/<slug>.md`.
- The SDK tags its sessions `entrypoint: sdk-ts`. The terminal's `--resume` picker hides those, but
  `claude --resume <id>` opens them.

## 4. Claude Code behaviours Gloom copies

From the CLI, and from the Claude app's Settings, log (`%LOCALAPPDATA%\Claude\logs\main.log`),
session list and transcripts — observed, not reverse-engineered.

- **Worktree location:** `<repo>/.claude/worktrees/<name>`, in both the CLI and the app.
- **Branch names:** the app uses `claude/<name>` (its "Branch prefix" setting, default `claude`); the
  CLI uses `worktree-<name>` and three random words when unnamed. Gloom follows the app, creating the
  worktree itself with `git worktree add` rather than the CLI's flag.
- **Neither ignores the worktree folder**, so it shows as untracked in the main checkout's
  `git status`. Gloom adds `.claude/worktrees/` to `.git/info/exclude`.
- **Worktrees outlive the session:** neither the CLI (in SDK mode) nor anything else removes them.
- **Merging back:** the app brings a worktree branch up to date by a fetch + **merge**. How it lands
  the branch back wasn't observable (no worktree sessions on this PC yet).
- **Missing working folder:** the CLI only finds a session from its own folder; from anywhere else
  it answers "No conversation found with session ID". So such a session can only continue in that
  folder: Gloom shows it read-only, with **Recreate folder and continue**.
- **Updates with sessions running:** the app checks hourly but defers while sessions are working
  ("Host busy … Host quiet"). After a download it waits about 10 minutes, then a "stealth relaunch":
  saves window position and navigation, installs, relaunches and restores both (a minimized window
  comes back minimized).
- **Sessions it didn't create:** the app keeps its own list (`local_<uuid>` IDs) and showed none of
  the spike's sessions. Sessions started in Gloom won't appear in the Claude app.
- **Titles:** the app writes its titles into the transcripts as `custom-title` entries (52 of its 58
  sessions); SDK sessions get `ai-title` entries.

## 5. Transcripts on disk

61 session files (1.53 GB), 60 old `agent-*.jsonl`, 44 under `<id>/subagents/`; a full parse took
4.7 s; the largest is now 519.6 MB.

- Entry types: `user`, `assistant`, `system`, `attachment`, `last-prompt`, `custom-title`,
  `ai-title`, `mode`, `agent-name`, `queue-operation`, `file-history-snapshot`,
  `file-history-delta`, `bridge-session`, `cost-state`, `atis-latch`, `isolation-latch`,
  `api-request`, `api-request-blob`, `api-request-shape`.
- `parentUuid` chains run through `attachment` and `system` entries too, not just messages.
- `entrypoint`: `claude-desktop` (the app), `sdk-cli` (`claude -p`), `sdk-ts` (the SDK).
- **SSH sessions:** `~/.claude/projects/ssh-<uuid>/` holds local copies of sessions that ran on the
  Mac mini (working folders like `/Users/budinoff/home-lab`). Gloom shows them read-only.
- Drive-letter case varies between folders (`d--JS-Blissful`, `D--JS-blissful-girls`); paths
  compare case-insensitively on Windows.

## 6. Left open

- How the Claude app merges a finished worktree back (merge commit, squash or rebase). Until one is
  observed, Gloom's **Merge** makes a merge commit on the branch the worktree came from.
- What the Claude app shows for a session whose folder is gone. Gloom copies the CLI (above).
