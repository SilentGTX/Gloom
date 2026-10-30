# Gloom — build plan

## Context

Gloom is a desktop app for Claude Code, modelled on the Claude desktop app's Code tab, built because
the official sidebar allows only one level of session groups and mods cannot change it. Gloom's core
feature is **unlimited nested folders for sessions**, in a window that feels like an Apple product.

It runs the official `claude` CLI underneath through the Claude Agent SDK, so chats, tools, models
and your login behave exactly as in Claude Code. **Its behaviour copies Claude Code; its look does
not.** Gloom should look like an app Apple released: Liquid Glass, a dusk sky, its own identity
(direction set by you on 2026-10-30, after Phase 1 came out too close to the Claude app). Where
behaviour is copied, it comes from observing the Claude app, not from its code. Design and motion follow two installed skills:
`apple-hig` (Apple's Human Interface Guidelines) and Emil Kowalski's set (`apple-design`,
`emil-design-eng`, `animate`, `review-animations`, `animation-performance`, `pick-ui-library`,
`break-ui`, `ask-sonner`).

**Decided with you**
- Layout: three columns, like Apple Notes/Mail: **folder tree | session list | chat**.
- Window: Windows 11's real min/max/close buttons (no fake Mac buttons) over Gloom's dusk sky, with
  Liquid Glass on the floating layer (the sky replaced Mica, which it would hide).
- Version 1 includes: sidebar and chat, **permission prompts**, a **diff pane**, a **terminal pane**,
  **rewind and edit**, **worktrees**, a **context meter** and **usage limits**.
- **Gloom replaces the Claude app's Code tab.** Sessions made in the Claude app or a terminal must
  open and continue safely in Gloom; using both apps side by side doesn't have to be smooth.
- **Where Claude Code already has a behaviour, Gloom copies it** rather than inventing one: a
  session whose working folder is gone, how a worktree's work merges back, worktree locations and
  branch names, and updating while sessions run. Phase 0 records what Claude Code does.
- **v1 is done** when you do your normal Claude Code work in Gloom for a week without opening the
  Claude app's Code tab, apart from the features listed below.
- **Build rhythm:** every phase ends with something you can run and try; work stops for your OK
  before the next phase starts.
- **Updates like Sync's:** you install Gloom once; when a new build is out, an icon in the title bar
  installs it.

**Not in v1:** command palette (planned next), `@` file mentions, browser pane, artifacts, task
lists, side sessions, PRs, cloud sessions, multiple accounts, split view, fast mode, full-text
search across transcripts, dated library backups.

**Personal use.** If Gloom is ever shared with others, check Anthropic's rules for third-party apps
that use a Claude.ai login first.

## Stack

| Need | Choice | Source |
| --- | --- | --- |
| Shell | Electron + electron-vite, React 19, TypeScript, Tailwind v4 | your usual stack |
| Running Claude | **@anthropic-ai/claude-agent-sdk**, pointed at your installed `claude.exe` | Anthropic |
| Dialogs, menus, popovers, context menus, tooltips | **base-ui** | pick-ui-library |
| Springs, layout and enter/exit animation | **motion** | pick-ui-library |
| Toasts | **Sonner** | pick-ui-library |
| Drag sessions and folders | **dnd kit** | pick-ui-library |
| Long transcripts and session lists | **Virtuoso** | pick-ui-library |
| State | **zustand** | pick-ui-library |
| Class names and variants | **clsx + cva** | pick-ui-library |
| Code highlighting (chat, diffs) | **shiki**: JS regex engine, languages loaded on demand, run in a worker | pick-ui-library |
| Markdown | react-markdown + remark-gfm (never rehype-raw) | not on the list |
| Diff computation | `diff` (jsdiff) | not on the list |
| Terminal | @xterm/xterm + node-pty: native, rebuilt for Electron with @electron/rebuild and unpacked from the asar | not on the list |
| Manual order | fractional-indexing | not on the list |
| Ending process trees | tree-kill (`taskkill /T` on Windows) | not on the list |
| Icons | Lucide (the HIG's suggested SF Symbols stand-in) | apple-hig cross-platform.md |
| Watching transcript files | chokidar | not on the list |
| Tests | vitest; Playwright's Electron driver for end-to-end tests | not on the list |
| Installer | electron-builder (NSIS, one-click) | your Sync app |
| Updates | Sync's updater (check, download with sha256, silent NSIS `/S --force-run`), reading GitHub releases of the private repo | your Sync app |

## Architecture

```
D:\JS\Gloom
├─ src/main/                    Electron main process
│  ├─ claude/binary.ts          find claude.exe, read its version, check login
│  ├─ claude/session.ts         one SDK query per running session; idle close, process-tree kill
│  ├─ claude/reducer.ts         SDK messages → transcript items (shared with the file reader)
│  ├─ library/store.ts          folders, session placement, pins, archive, renames, trusted folders
│  ├─ git/diff.ts               working-tree changes for a session's folder
│  ├─ git/worktrees.ts          create, merge and remove session worktrees
│  ├─ pty/terminals.ts          node-pty terminals
│  ├─ commands.ts               every command + shortcut in one registry (menu, accelerators, later the palette)
│  ├─ notify.ts                 toasts, taskbar flash and badge
│  ├─ updater.ts                GitHub releases check, download, silent install (Sync's updater)
│  └─ window.ts                 hidden title bar, titleBarOverlay, sky base colour, accent colour
├─ src/worker/transcripts.ts    utility process: index, read and watch ~/.claude/projects
├─ src/preload/index.ts         typed `window.gloom` bridge
├─ src/shared/ipc.ts            IPC channel names + payload types
├─ src/renderer/src/
│  ├─ styles/tokens.css         colours, materials, type scale, motion tokens (light + dark)
│  ├─ stores/                   zustand: library, sessions, ui
│  ├─ components/ui/            base-ui wrappers styled with cva (Button, Menu, Dialog, Tooltip…)
│  ├─ features/folders/         folder tree (outline view)
│  ├─ features/sessions/        session list
│  ├─ features/chat/            transcript, tool rows, composer, prompt cards
│  ├─ features/diff/            diff pane
│  ├─ features/terminal/        terminal pane
│  └─ features/settings/        settings, first run
└─ tools/fake-claude/           replays recorded streams for UI work and tests
```

**Running Claude.** Gloom drives sessions through the Claude Agent SDK instead of hand-writing the
stream-json protocol. The SDK starts the CLI and gives a streaming-input query with permission
callbacks (`canUseTool`), `interrupt()`, `setPermissionMode()`, `setModel()` and resume.
- `pathToClaudeCodeExecutable`: your own `claude.exe`, found once (`~/.local/bin/claude.exe` on this
  PC) and overridable in Settings. An npm `claude.cmd` can't be started without a shell.
- `settingSources: ['user', 'project', 'local']` and `systemPrompt: { type: 'preset', preset: 'claude_code' }`.
  Without them the SDK skips your settings and CLAUDE.md and doesn't behave like Claude Code.
- `includePartialMessages`, `cwd`, `model`, `permissionMode`, and `resume` (keeps the session ID;
  `forkSession` only when forking on purpose).
- Every process starts with bypass allowed (`allowDangerouslySkipPermissions`), so the mode picker
  can switch a running session into Bypass.
- Effort changes live with `applyFlagSettings({ effortLevel })`. The stream never reports it back,
  so Gloom shows the level it set.
- Rewind and edit: `enableFileCheckpointing` + `rewindFiles(<user message UUID>)` for code (Gloom
  sets the UUIDs on the messages it sends; only Write/Edit changes, as with `/rewind`), and `resume`
  + `resumeSessionAt` to continue from an earlier message, with `resumeDropsTurn` on CLIs that know it.
- Context meter: `getContextUsage({ detail: 'summary' })` after each turn. Usage limits:
  `rate_limit_event` in every turn, plus the SDK's experimental usage call for the 5-hour and weekly
  percentages. Both answer in shapes that differ from the SDK's published types; parse defensively.
- Phase 0 found no need for the raw-CLI fallback. Details: `docs/phase-0-findings.md`.
- **CLI version (proposed, awaiting your OK):** your `claude.exe` was 2.1.186 while the SDK expects
  2.1.314, with older models and a flag it rejects. Gloom checks the version at start and offers
  **Update Claude Code** (`claude update`) when it's behind.

**Process lifecycle.** Each running session is one `claude` process, and each starts its own copy
of every MCP server. A process stays alive while a turn runs or a prompt card waits, closes after 10
idle minutes (Settings), and is resumed on the next send. At most 6 run at once; the oldest idle one
closes first. The cap only ever closes idle processes: if all 6 are mid-turn, a 7th starts anyway
and the count settles as turns end. On quit Gloom kills every whole process tree, since Windows
doesn't end child processes on its own; terminals too.

**Trusted folders.** `-p` skips Claude Code's workspace trust dialog, so a folder's project hooks
and `.mcp.json` servers would run without asking. New Session in a folder Gloom hasn't seen asks
"Trust this folder?" first; answers are kept in the library.

**Sessions on disk.** Gloom indexes `~/.claude/projects/*/*.jsonl`. Measured on this PC on
2026-10-30: 116 files, 60 of them old-format `agent-*.jsonl` subagent transcripts, so about 56 real
sessions. The largest is 496 MB and ten are over 30 MB; most of a big file is tool results with images.
- **Not sessions:** `agent-*.jsonl`, anything under `<id>/subagents/`, and entries marked `isSidechain`.
- **Index:** runs in a utility process, never the main process. It reads each file's tail (last
  256 KB, reading further back when needed) for the latest `custom-title`/`ai-title`, `last-prompt`,
  `cwd`, mode and timestamps, and the head for the created time. Results are cached by path, size
  and modified time, so only changed files are read again.
- **Identity:** a session is a file, keyed by file name. A fork starts with the parent's lines under
  the parent's `sessionId` (one file here does), and shows as its own session.
- **Reading:** the file is a tree linked by `parentUuid` (parallel tool calls, rewinds). Gloom
  renders the chain that ends at the newest message. Transcripts open from the bottom in pages and
  stop at the last compaction ("Show earlier"); images load when they scroll into view.
- **Format:** about 20 entry types, some internal (`atis-latch`, `bridge-session`,
  `api-request-blob`, `file-history-delta`). Gloom renders a known list, skips the rest and logs new
  types with the CLI version. The format is undocumented and the CLI updates itself (2.1.186 today),
  so expect it to change; Settings shows the CLI version.
- **Watching:** chokidar on the projects folder. On a change Gloom reads only the bytes added since
  its last read.
- **Live vs file:** while Gloom runs a session, the SDK stream is the truth and the watcher ignores
  that file. If a file grows while Gloom isn't running it, the session is **running elsewhere**: it
  gets a badge, and its composer stays locked until the file has been quiet for a minute or you
  press **Take over**.
- **Where they start:** sessions made in the Claude app or the terminal start in Unfiled, unless a
  folder's filing rule claims their working folder. Gloom never writes into Claude Code's files.
- **Missing working folder:** the CLI only finds a session from its own folder, so Gloom shows it
  read-only with **Recreate folder and continue**.
- **SSH sessions** (`ssh-<uuid>` folders: the Claude app's copies of sessions run on another
  machine) show read-only.
- **Titles:** the CLI writes `ai-title` for SDK sessions, so Gloom's sessions are named without an
  extra call. The Claude app's titles are `custom-title` entries.

**Gloom's data.** One JSON file in userData: atomic writes, a schema version, the previous file kept
as `.bak` and used if the current one is corrupt.
- `Folder { id, name, parentId | null, order, expanded, defaults?: { cwd, model, mode }, fileFrom?: string[] }`
- `sessions: { [fileName]: { folderId?, pinned?, archived?, title? } }`; `title` is your rename and
  wins over the CLI's. Renames stay in Gloom; the CLI's own title is untouched.
- `trustedFolders: string[]`
- `order` is a fractional-index string, so a move rewrites one entry.
- A session lives in exactly one folder, or in Unfiled.
- Moves reject cycles (a folder can't move into its own child). Deleting a folder deletes its whole
  subtree; every session inside goes to Unfiled, and a toast offers Undo for a few seconds.
  Transcripts are never deleted.
- A folder's defaults prefill New Session inside it (working folder, model, mode).
- **Filing rules:** `fileFrom` lists working paths a folder claims. An Unfiled session whose working
  folder is inside a claimed path files into that folder; the deepest claimed path wins. Rules run
  when a session first appears and when you add a rule (which files existing Unfiled sessions too),
  never on later changes, so a session you moved by hand stays put.
- Protection is the `.bak` alone; no dated backups or export in v1.
- Entries whose transcript file is gone are hidden and pruned after 30 days.

**Security.** Model output and transcripts are untrusted. contextIsolation and sandbox on, no
nodeIntegration, a strict CSP, IPC checks the sender, markdown never renders raw HTML, links open
in the browser only for http(s), and in-app navigation is blocked.

## Screens

**Window.** `titleBarStyle: 'hidden'` with `titleBarOverlay`, not `frame: false`, which would lose
the real caption buttons and Snap Layouts. The overlay's colours follow the theme through
`setTitleBarOverlay()`. The page paints the paper edge to edge; the floating sidebar carries the
dusk sky; an inactive window mutes the sky.
The app follows the system light/dark setting and Windows' accent colour
(`systemPreferences.getAccentColor()`, updated on `accent-color-changed`). A hidden title bar
doesn't draw the native menu bar, so a menu button at the top left (like the Claude app's) opens
every command; Phase 1 confirms the accelerators still fire. Splitters between the columns are
resizable and remembered. Narrow windows collapse the folder column first, then the session list
(both reachable from a toolbar button), and the diff pane turns into an overlay when the chat would
drop below 560 px.

**Updates.** When an update is ready, a download icon appears in the title bar, like Sync's.
Clicking it waits until no session is mid-turn (the Claude app defers its updates the same way),
saves the window and the open session, runs the installer silently and relaunches with both
restored. Stopped sessions resume on their next send.

**1. Folder tree (left).** An outline view, like Notes or Finder:
- **Smart folders at the top:** All Sessions, Recent (active in the last 7 days), Pinned, Unfiled; Archived at the bottom.
- **Your folders:** disclosure triangles; Alt-click or numpad `*` expands everything below; expansion state is remembered.
- **Keyboard from the start:** treeview semantics: arrows move, open and close; Home/End; type to find.
- **Editing:** F2 or a click on the selected row renames inline; New Folder, plus "New Folder Inside" for nesting.
- **Moving:** drag folders to reorder or nest them, and drop sessions onto a folder (dnd kit), with spring-animated reorders.
- **Context menu:** rename, new subfolder, folder defaults and filing rules…, move to…, delete.
- **Search** field at the top of the column: filters titles and last prompts across all folders as you type.
- **Counts:** each folder shows its session count in tabular numerals.

**2. Session list (middle).** The selected folder's sessions; with "include subfolders" on, nested ones too.
- **Each row:** title, last-prompt preview, project folder name, time (relative, then a date after a week),
  and a status dot (running / waiting for you / idle / running elsewhere).
- **Sorting:** by last activity, name or date created.
- **Selection:** multi-select (Ctrl and Shift) and drag to a folder; virtualized with Virtuoso.
- **Context menu:** rename, pin, archive, move to…, reveal working folder, copy session ID. Archive
  hides a session everywhere except Archived; its transcript is untouched.
- **New Session (Ctrl+N):** choose the working folder (prefilled from the folder's defaults), model
  and mode; in a git repo a **worktree** switch, on by default; a folder Gloom hasn't seen asks for
  trust first; it's placed in the selected folder.

**3. Chat (right).**
- **Transcript:** virtualized and opens at the bottom; older pages load on scroll up, stopping at the
  last compaction. User messages, assistant markdown with shiki code blocks, thinking collapsed, and
  tool calls as compact rows (icon + summary such as "Edited `foo.ts` +12 −3", "Ran `npm test`")
  that expand to the full input and output. Turn duration shows under each reply. Streaming text
  appears as it arrives; the text itself isn't animated.
- **Find in chat (Ctrl+F):** searches the loaded transcript, since the browser's find can't see
  virtualized rows.
- **Rewind and edit:** hovering a message of yours shows Edit and Rewind to here. Both ask what to
  restore, like the CLI's `/rewind`: conversation, code, or both. Code comes from Claude Code's own
  checkpoints, so only Claude's edits go back, not Bash's or yours. After an edit the transcript shows
  only the newest branch; the old turns stay in the file.
- **Composer:** auto-growing box, paste or attach images and files, model picker, mode picker
  (Ask / Accept edits / Plan / Auto / Bypass, switched live), effort, Send, and Stop (Esc). Sending
  while Claude works queues the message, as the CLI does. `/` lists the session's commands and skills
  (from the SDK's init message). A **context meter** shows how full the session's context is, with
  a Compact button; **usage limits** show your plan's 5-hour and weekly use, if the CLI reports them.
- **Prompt cards** appear above the composer, keyboard-driven (Enter, Esc). The session's dot in the
  list turns amber while one waits.
  - **Permission:** the tool and its input (the command, or a diff preview for edits) with
    **Allow once / Always allow / Deny**. "Always allow" offers the rule suggestions that come with
    the request and says where the rule is saved (this session, or the project's `.claude/settings.local.json`).
  - **Plan approval** (ExitPlanMode): the plan as markdown; Approve and pick the next mode, or Keep
    planning with a note.
  - **Question** (AskUserQuestion): each question with its options as buttons, plus Other.

**Attention.** When a session waits for you or finishes while Gloom isn't focused: a Windows toast
(clicking it opens the session), a flashing taskbar button, and an overlay badge with how many are waiting.

**Worktrees.** In a git repo every new session gets its own worktree and branch unless you switch
it off. As in the Claude app, worktrees live in `<repo>/.claude/worktrees/<name>` on a
`claude/<name>` branch; Gloom creates them with git and adds `.claude/worktrees/` to
`.git/info/exclude`, since nothing else keeps them out of `git status`. The chat header shows the
branch and a **Merge** action that lands the work on the branch it came from with a merge commit
(the app's own method wasn't observable in Phase 0); on conflicts it stops and offers to let
Claude resolve them in that session. Archiving removes a clean worktree and asks first when it has
uncommitted changes.

**4. Diff pane (toggle, right of the chat).** Two tabs, shiki-highlighted and virtualized for big diffs:
- **This session** (default): built from the patches in the session's Edit/Write tool results
  (`structuredPatch`). Works in any folder and shows only Claude's edits from this session.
- **Working tree:** `git status` plus `git diff`, untracked files included, for changes made by Bash,
  by you or by other sessions in the same repo.

**5. Terminal pane (toggle, below the chat).** An xterm terminal opened in the session's working
folder; several tabs allowed; the shell comes from Settings (PowerShell by default; pwsh, cmd, Git Bash).

**Settings.** Claude Code path, version and login status; default model, mode and effort; terminal
shell; text size; theme (system / light / dark); glass (follow Windows / always); idle timeout for
sessions; notifications on or off; Gloom's version and Check for updates. The updater reads the
private repo's releases with your `gh` login's token (`gh auth token`), or a token entered here if
`gh` isn't signed in.

**First run and empty states.** Claude Code not found (how to install it), not logged in (opens a
terminal running `claude` to log in), no sessions yet, empty folder, no search results.

## Design system (from the skills)

- **Two layers, as Apple draws them** (`apple-hig` liquid-glass.md):
  - **Content:** soft **lavender-gray paper** (#DFDEE3 light, #16151B dark: your pick) edge to
    edge across the whole window, under the sidebar too (`layout.md`). Content is never glass.
  - **The sidebar is one floating object** that carries Gloom's **dusk sky** inside its glass,
    with its shadow falling on the paper. The same panel slides in as the narrow-window sheet.
    **"Whisper" strength (your pick of four):** near-white frosted glass (80% fill) over the dusk at
    35% saturation, so only a breath of warmth shows low in the panel; in dark, near-neutral
    graphite glass (86%) over the night sky at 20%, measured to the same faint tint as light (RGB
    spread about 6). An unfocused window mutes it further. The saturation switches, never animates (only transform and opacity animate).
  - **Functional:** **Liquid Glass** only on the floating sidebar, the toolbar capsules, menus,
    tooltips and sheets: backdrop blur with a saturation boost, a top sheen, a 1px rim that is
    brightest top left, and a light that follows the pointer across capsules. Each pane's toolbar
    floats over its own top (title leading, actions trailing), all centred on one 48px title line.
- **Colour:** semantic tokens in a violet-tinted ink, light and dark, accent following Windows'
  (Gloom's dusk indigo when it has none). Informative text uses secondary labels (5.5:1 or better);
  tertiary is for placeholders. Selection lays the accent tint over a neutral base, so a gray accent
  still reads.
- **Accessibility states:** `prefers-reduced-transparency` makes the glass opaque (the sky stays: it
  is content); **View → Always Show Glass** overrides that for people who turned transparency off
  for other reasons. `prefers-contrast` gives the glass a solid rim and stronger text. Text size
  goes to 200%; chrome is sized in pixels so it holds its shape.
- **Type:** the system font (Segoe UI Variable) with size-specific tracking (tight headings, body near 0).
  Hierarchy comes from weight, size and leading together. Tabular numerals for counts and times.
  Sizes in rem with an app text-size setting. Mono: Cascadia Code / `ui-monospace`.
- **Motion tokens:**
  - **Curves:** `--ease-out: cubic-bezier(0.23,1,0.32,1)`, `--ease-in-out: cubic-bezier(0.77,0,0.175,1)`,
    `--ease-drawer: cubic-bezier(0.32,0.72,0,1)`. Never ease-in.
  - **Durations:** press 120 ms, tooltip 150 ms, menu 180 ms, panels 250 ms; everything under 300 ms.
  - **Springs:** `bounce: 0` by default, a little bounce only where a drag released momentum.
- **Motion rules:**
  - Feedback starts on pointer-down: plain buttons give to 0.97; glass controls swell to 1.08, as
    Apple's interactive glass does.
  - Popovers grow from their trigger; nothing appears from `scale(0)`.
  - Tooltips skip the delay once one is open.
  - Only `transform` and `opacity` animate.
  - Inside Virtuoso lists, rows only fade or slide in; no `layout` animations, which fight its measuring.
  - Panels enter and leave the same way.
  - Keyboard-triggered actions don't animate.
  - Reduced motion swaps slides and springs for cross-fades.
- **One signature element** (apple-hig improvement mode): the live status dot, a soft glow on running
  sessions that settles to still when the turn ends. No endless slow pulsing; the guidelines flag
  loops around 0.2 Hz.

## Phases

**Status, 2026-10-30: Phases 0 and 1 are done**, and Gloom 0.3.1 is released. Phase 3's installer,
release script and update window came early (see Phase 1's notes), so what's left of Phase 3 is the
viewer itself, which opens sessions from Phase 2's library. Phase 2 hasn't started.

0. **SDK spike.** A node script drives the SDK against your real `claude.exe` and checks: two turns in
   one process, interrupt, resume keeping the session ID, a permission request answered from code,
   plan approval and AskUserQuestion, live mode and model switches, whether effort can change live,
   cold-start time with your MCP servers, and whether `-p` writes `ai-title`. It also checks whether
   the Claude app lists a session it didn't create, file checkpoints and `resumeSessionAt` for
   rewind and edit, worktree support, and what the stream reports for context use and usage limits.
   It records what Claude Code does for the behaviours Gloom copies: a session whose working folder
   is gone, worktree locations, branch names and how their work merges back, and the Claude app
   updating while sessions run. Recorded streams become test fixtures and feed the **fake
   `claude`**, which replays them so UI work and tests cost no usage and give the same result every
   run. If the SDK falls short, the same checks run against the CLI directly.
   **Done 2026-10-30:** findings in `docs/phase-0-findings.md`; the spike is `tools/sdk-spike/`, the
   fake `claude` and its 29 recorded streams are in `tools/fake-claude/`.
1. **Scaffold.** electron-vite app, Tailwind v4 tokens, window chrome (hidden title bar, overlay
   buttons, Mica and its inactive look, accent), menu button and command registry, three-column
   shell with resizable splitters, light/dark. A private GitHub repo (SilentGTX/Gloom) holds the code.
   Plus a packaging smoke test: a hello-world NSIS installer that includes node-pty and opens
   PowerShell, so native-module trouble shows up on day one.
   **Done 2026-10-30.** Electron 45 + electron-vite 6 + React 19 + Tailwind 4, Base UI, motion, zustand.
   - Accelerators fire through the hidden application menu with real keystrokes. The e2e tests
     drive the menu items (Playwright's injected keys never reach the menu); a real-keystroke test
     is opt-in, since it takes the foreground.
   - The session-list toggle is Ctrl+Shift+B, not Ctrl+Alt+B: Ctrl+Alt is AltGr on many layouts.
   - Your Windows accent is a gray (#4C4A48) and Gloom follows it; Settings can offer Gloom's indigo.
   - **Redesigned the same day** after your review: Phase 1 looked too much like Claude Code. A
     first glass pass boxed everything in a sky frame, which looked odd; an `apple-hig`
     design-improvement pass recomposed it the way macOS 26 does, and you picked the final look
     from two screenshots: soft lavender-gray paper edge to edge, the sidebar one floating glass
     object with the dusk inside, a toolbar floating over each pane (see Design system). An `apple-hig` review fixed contrast (tertiary text was
     3:1), text size now reaches 200%, toggles say Show/Hide, and sheets manage focus. Transparency
     effects are off on this PC, so the glass shows opaque unless View → Always Show Glass is on.
   - Installer 110 MB, nearly all Electron (its exe alone is 238 MB). node-pty runs from
     `app.asar.unpacked` on its prebuilt N-API binaries: no compiler needed, no rebuild.
   - Electron 45 no longer downloads itself on install; `postinstall` runs `install-electron`.
   - **Updates came early** (planned for Phase 3), in 0.2.0, so you could watch one arrive:
     `src/main/updater.ts`, `npm run release`, and an indigo **Update** capsule in the chat toolbar,
     the one coloured control. The busy-deferral waits for Phase 4, when sessions run.
   - **0.3.0, at your request:** Sync's update window (`src/main/update-window.ts`): a 300×350
     frameless window that checks at launch, downloads with progress, installs and reopens Gloom;
     the Update button hands over to it too. And an app icon from the sparkles you liked in the
     "Updated" note: a dusk-indigo squircle with white sparkles (`src/shared/icon-art.ts`), on the
     app, the installer and the update window, whose sparkles twinkle while it works. The silent
     install itself still shows no window for its few seconds, as Sync's doesn't.
2. **Library.** Transcript indexer in a utility process (tail reads, cache, subagent files skipped),
   watcher, library store, folder tree (nesting, rename, drag, keyboard, context menu, smart folders,
   search, filing rules, subtree delete with Undo), session list (pin, archive, rename).
3. **Read-only viewer, first release.** Paged transcript renderer (newest chain, compaction cut, lazy
   images, find in chat). Gloom is now a usable organizer next to the Claude app; "Resume in
   terminal" opens `claude --resume <id>` in a new terminal window. The installer, the release
   script (publishes to GitHub releases) and the update window that every later phase reaches you
   through came early, in Phase 1 (see its notes).
4. **Live chat.** Session runner (streaming, stop, queued messages, resume, idle close, process-tree
   kill), composer with `/` commands, New Session with the trust prompt and folder defaults, model,
   mode and effort pickers, all three prompt cards (a live session can't do much without them),
   context meter and usage limits, attention (toasts, flash, badge), the running-elsewhere lock with
   Take over, Settings and first run.
5. **Diff and terminal panes.**
6. **Rewind, edit and worktrees.** Edit and rewind with the conversation / code / both choice;
   worktree sessions in git repos, Merge, cleanup on archive, and the missing-folder behaviour
   recorded in Phase 0.
7. **Polish pass with the skills.** An `apple-hig` review of every screen, then `review-animations`,
   `animation-performance`, and `break-ui` with worst-case data (500 sessions, folders 8 levels
   deep, 200-character titles, empty folders, your 496 MB transcript). Then reduced motion,
   transparency and contrast, a full keyboard audit, and a check of the security settings.
8. **Package.** Installer polish (the app icon came in 0.3.0).

## Verification

- **Acceptance:** the week as a daily driver described under "Decided with you". Each phase also
  ends with you trying its build before the next one starts.
- **Unit tests (vitest):** transcript parser against real `.jsonl` samples, including a fork, an
  `agent-*` file, a rewind branch and unknown entry types; tail indexer (cache hits and misses, a title
  found near the end); folder store (nest, move, cycle rejection, subtree delete sends sessions to
  Unfiled and Undo restores it, fractional order, recovery from a corrupt file); filing rules (deepest
  path wins, worktree paths inside a claimed repo, hand-moved sessions stay put); the stream reducer
  replaying the Phase 0 fixtures.
- **Performance:** index all of `~/.claude/projects` in under 3 s cold and 300 ms warm; open the
  496 MB transcript to a readable screen in under 1 s without loading the whole file.
- **End-to-end tests (Playwright's Electron driver, against the fake `claude`):** create nested
  folders, drag a session in, restart and check it stayed; start a session, send a prompt, approve a
  permission request, approve a plan, answer a question, see the edit in the diff pane, run a command
  in the terminal pane, rewind (conversation and code), start a worktree session and merge it;
  screenshots in light and dark. One smoke test runs against the real CLI on a cheap model, only when
  you or I run it explicitly, since it spends your usage.
- **Manual check against the Claude app:** a session made in the Claude app opens in Gloom with the
  same conversation and continues there, and the Claude app still opens it afterwards. A session
  running in a terminal shows as running elsewhere in Gloom, and Take over unlocks it.
- **Updates:** publish a test release, see the title-bar icon appear, click it, and Gloom relaunches
  on the new version.
- **Skill reviews:** each phase gets a quick `apple-hig` and `review-animations` look at its new
  screens; the full audit is Phase 7.
