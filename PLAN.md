# Gloom — build plan

## Context

Gloom is a desktop app for Claude Code, modelled on the Claude desktop app's Code tab, built because
the official sidebar allows only one level of session groups and mods cannot change it. Gloom's core
feature is **unlimited nested folders for sessions**, in a window that feels like an Apple product.

It runs the official `claude` CLI underneath through the Claude Agent SDK, so chats, tools, models
and your login behave exactly as in Claude Code. **Its behaviour copies Claude Code; its look does
not.** Gloom should look like an app Apple released: Liquid Glass, a dusk sky, its own identity
(direction set by you on 2026-10-30, after Phase 1 came out too close to the Claude app). Where
behaviour is copied, it comes from observing the Claude app, not from its code. Design and motion
follow **two Apple skills, used together in every phase that touches the UI**: `apple-hig`
(Apple's Human Interface Guidelines) for design, and `apple-design` (Apple's WWDC talks on fluid,
physical interfaces, translated for the web) for motion and interaction. The rest of Emil
Kowalski's set supports them: `emil-design-eng`, `animate`, `review-animations`,
`animation-performance`, `pick-ui-library`, `break-ui`, `ask-sonner`.

**Decided with you**
- Layout: two columns: **one sidebar | chat**. The sidebar holds your library and your folders,
  each opening to show its sessions nested inside (your Claude Design mockup, 2026-10-30; until
  then three columns, folder tree | session list | chat, like Apple Notes).
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
- **Both Apple skills, every UI phase** (your rule, set 2026-10-30 after Phase 2's first build had
  loaded only part of `apple-hig`):
  - Before building, load `apple-hig` with its foundation pages (accessibility, layout,
    typography, color, designing for macOS, the cross-platform translation) and the component
    pages for what's on screen.
  - Load `apple-design` for motion and interaction too.
  - After building, review the new screens against both, plus `review-animations`, and fix what
    they find. The phase's notes record the fixes and any deliberate departures.
- **Updates like Sync's:** you install Gloom once; when a new build is out, a download arrow in the
  title bar installs it. Gloom's own window becomes the update window while it does, with nothing
  of the app showing (no second window).

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
| Code highlighting (chat, diffs) | **shiki**: JS regex engine, languages loaded on demand, run in a worker, an Xcode-like theme in CSS variables | pick-ui-library |
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
│  ├─ update-screen.ts          the update screen's steps: launch check, download, install, relaunch
│  └─ window.ts                 hidden title bar, titleBarOverlay, sky base colour, accent colour
├─ src/worker/transcripts.ts    utility process: index, read and watch ~/.claude/projects
├─ src/worker/indexer.ts        head and tail reads, the cache, appended bytes
├─ src/shared/library.ts        folders, placement and filing rules as pure operations
├─ src/preload/index.ts         typed `window.gloom` bridge
├─ src/shared/ipc.ts            IPC channel names + payload types
├─ src/renderer/src/
│  ├─ styles/tokens.css         colours, materials, type scale, motion tokens (light + dark)
│  ├─ stores/                   zustand: library, sessions, ui
│  ├─ components/ui/            base-ui wrappers styled with cva (Button, Menu, Dialog, Tooltip…)
│  ├─ features/sidebar/         the one sidebar: library and folders with their sessions nested
│  ├─ features/folders/         folder actions, menu, filing rules
│  ├─ features/sessions/        session actions and menu
│  ├─ features/chat/            transcript, tool rows, composer, prompt cards
│  ├─ features/update/          the Update button and the update screen
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
every command; Phase 1 confirms the accelerators still fire. The splitter beside the sidebar is
resizable and remembered. A narrow window folds the sidebar into a sheet over the chat (the chat
toolbar's sidebar button brings it back), and the diff pane turns into an overlay when the chat
would drop below 560 px.

**Updates.** A check runs at launch and every half hour while Gloom is open (and when you come
back to Gloom with one overdue). When it finds a newer release, a download arrow appears in the
title bar, like Sync's: just the arrow, in Gloom's indigo, in its own glass capsule, with "Update
Ready" as its tooltip. Clicking it turns the window, at its size, into the update screen: the app
goes from view and the window shows Sync's update window (the icon, what it's doing, the
download's progress, the version), installs silently and reopens Gloom. At launch the same screen
is the window's first frame while the check runs, and fades to the app when there's nothing new.
Phase 4 adds the rest: clicking waits until no session is mid-turn (the Claude app defers its
updates the same way), saves the window and the open session, and relaunches with both restored.
Stopped sessions resume on their next send.

**1. Sidebar (left).** One outline, like Finder's sidebar with its folders opened in place:
- **Library at the top:** All Sessions, Recent (active in the last 7 days), Pinned, Unfiled, each
  opening to show its sessions, with counts. **Archived** waits at the foot; it shows the archive in
  place of the library.
- **Your folders:** nested without limit; an open folder shows its subfolders, then its own
  sessions, with a guide line down the left. A click opens or closes one; Alt-click or numpad `*`
  does everything below. What's open is remembered.
- **Each session row:** title, time (relative, then a date after a week), the last prompt, and a
  status dot (running / waiting for you / idle / running elsewhere). The selected one, the session
  the chat shows, is filled with Gloom's dusk indigo. A session shows in every group it belongs to.
- **Keyboard from the start:** treeview semantics: arrows move and select sessions, Shift extends,
  Ctrl only moves; Left and Right open, close and step in and out; Home/End; type to find; F2
  renames; Delete archives (the next session takes over, as in Mail) or deletes a folder.
- **Editing:** F2 or the context menu renames; New Folder, plus "New Folder Inside" for nesting.
- **Moving:** drag folders to reorder or nest them, and drop sessions onto a folder or onto any
  session inside it (dnd kit); Unfiled, Pinned and Archived take sessions too.
- **Context menus:** a folder's: rename, new subfolder, folder defaults and filing rules…, move
  to…, delete. A session's: rename, pin, archive, move to…, resume in terminal, reveal working
  folder, copy session ID. Archive hides a session everywhere except Archived; its transcript is
  untouched.
- **Search** field at the top: results from every folder, archived matches apart.
- **Sorting** (View › Sort Sessions By): last activity, name or date created; pinned ones lead.
- **Selection:** multi-select (Ctrl and Shift) and drag to a folder.
- **New Session (Ctrl+N):** the pencil at the top of the sidebar. Choose the working folder
  (prefilled from the folder's defaults), model and mode; in a git repo a **worktree** switch, on by
  default; a folder Gloom hasn't seen asks for trust first; it's placed in the folder you're in.

**2. Chat (right).**
- **Toolbar:** the session's title with what it's doing beside it ("Active now"); trailing, one
  capsule with the sidebar's show/hide, Resume in Terminal and ⓘ, which opens the session's
  details as a card (working folder, folder, started, last active, started from, branch, session
  ID, with Reveal Working Folder and Copy Session ID).
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

**3. Diff pane (toggle, right of the chat).** Two tabs, shiki-highlighted and virtualized for big diffs:
- **This session** (default): built from the patches in the session's Edit/Write tool results
  (`structuredPatch`). Works in any folder and shows only Claude's edits from this session.
- **Working tree:** `git status` plus `git diff`, untracked files included, for changes made by Bash,
  by you or by other sessions in the same repo.

**4. Terminal pane (toggle, below the chat).** An xterm terminal opened in the session's working
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

**Status, 2026-10-30: Phases 0, 1, 2 and 3 are done**, and Gloom 0.5.0 (Phase 3, the viewer) is
released. **Small changes before Phase 4, at your request, released as Gloom 0.5.1:** the window
becomes the update screen instead of opening a second window, and the Update button is just a
download arrow (Phase 1's notes, "After 0.5.0"). **One sidebar** (below) is out as Gloom 0.6.0,
and **your new icon**, the gloomy cloud, as Gloom 0.6.1 (Phase 1's notes, "After 0.6.0"). The
sidebar's click and motion fixes are out as Gloom 0.6.2. **Next: Phase 4**, live chat, on your OK.

**One sidebar instead of two** (your Claude Design mockup, 2026-10-30). The folder tree and the
session list merge into the one floating glass sidebar, so the window has two columns, sidebar and
chat, instead of three:
- **Library:** All Sessions, Recent, Pinned and Unfiled, each with a disclosure that opens to show
  its sessions, with counts.
- **Folders:** your folders, opening to show their sessions nested inside. A session row keeps its
  title, time and last prompt, and the selected one is tinted with the accent.
- **Archived** sits at the bottom, as now.
- **Chat toolbar:** the title with the session's state beside it ("Active now"). On the right, one
  capsule holds the sidebar toggle, the terminal (Resume in Terminal) and ⓘ, which opens the
  session's details as a card (working folder, folder, started, last active, started from,
  session ID, with Reveal Working Folder and Copy Session ID).

**Done 2026-10-30, released as Gloom 0.6.0.** Built with both Apple skills
loaded (`apple-hig` with its foundation pages and the sidebar, outline view, toolbar, popover and
disclosure pages; `apple-design` for motion).
- **The tree:** `src/renderer/src/features/sidebar/` (`tree.ts` works out the rows, pure and
  tested; `rows.tsx`, `Sidebar.tsx`). An open folder shows its subfolders, then its own sessions;
  a folder's count is its own sessions, the ones that show when it opens. A session shows in every
  group it belongs to; selecting one marks all its rows. Library groups' open state is kept with
  the window's settings, folders' in the library, as before.
- **Selection** is the session the chat shows, and it takes **Gloom's dusk indigo** (#5b5bd6, your
  mockup's colour) whatever Windows' accent is (yours is gray), muted in a window you've stepped
  away from. Arrows select as in Mail; Ctrl+arrows only move; Delete archives and the next session
  in the group takes over.
- **Groups** open and close with a click anywhere on the row; renaming moved to F2 and the context
  menu (a click on a selected folder used to rename it). **Archived** shows the archive in place
  of the library (Done or Escape goes back). **Search** shows Results, archived matches apart.
- **Drag:** a session can drop onto any session inside a folder, for that folder (a tall open
  folder is one big target; its guide line lights up), and a drop where the sessions already are
  is refused rather than recorded as a move.
- **Chat toolbar:** the title at 15 px as in the mockup, "Active now" (else "Active 33m ago"), and
  one capsule: Show/Hide Sidebar (Ctrl+B), Resume in Terminal, ⓘ Session Info (also File ›
  Session Info, Ctrl+I, since every toolbar item needs a menu command). With the sidebar away, the
  menu and New Session ride at the leading edge.
- **View › Sort Sessions By** replaced the session list's sort button. **Include Subfolders** and
  **Show or Hide Session List** (Ctrl+Shift+B) are gone: a folder's sessions are inside it now.
  The window's saved settings move over (version 3): the sidebar keeps the folder column's width,
  at least the new 288 px default.
- **Motion:** a row or an open group's contents grows into its room and shrinks back out of it,
  in the layout itself, so the rows and headings below, and the scroll, move with it in the same
  frame and nothing passes over anything. A second click mid-way turns it around. The sidebar
  slides out the way it came; keyboard toggles snap; reduced motion fades.
- **Toasts** now centre over the chat (Sonner left-aligned our capsule inside its 356 px box, so
  they sat off-centre; you spotted it).
- **Review** with both skills; fixes made: no white ring on the selected row (the fill shows where
  you are, as on the Mac); library and folder rows grow with text size instead of clipping at
  200%; Archived, when shown, takes the selection's colour; the drag image no longer catches
  clicks while it flies to its drop.
- **Departures**, deliberate:
  - sessions nested in nested folders go past the two levels Apple suggests for a sidebar (Gloom's
    reason to exist);
  - the sidebar toggle sits in the trailing capsule, as in your mockup (Apple puts it at the
    leading edge);
  - the selection keeps its colour when the keyboard is elsewhere (your mockup); only an inactive
    window mutes it;
  - opening and closing animate height, not only transforms: 0.6.0 wiped the contents open over
    rows sliding by transform, and closing your 91-session Unfiled let the "Folders" heading,
    which didn't slide, run ahead into the sessions (you spotted it).
- **Found on the way:** dnd kit swallows clicks for 50 ms after a drag, and rows read mid-spring
  are where they were, not where they'll be; the end-to-end tests now wait a beat for both.
- **Tests:** unit tests for the tree (groups, nesting, sets, guides, search, Archived) and the
  layout; the end-to-end tests rewritten for the sidebar, plus Archived and the info card. The
  window captures in `screenshots.spec.ts` are updated but weren't run: they copy the screen
  where Gloom's window is, so they need it in front, and you were using the PC.
- **After 0.6.0, at your request:** every click opens or closes a group, however fast (clicks close
  together counted as a double click and were dropped for about half a second); the opening and
  closing above replaced 0.6.0's wipe. Released as Gloom 0.6.2, after a check of the packaged
  build (fast clicks on a group toggle it every time).
- Built in its own worktree (`D:\JS\Gloom-sidebar`) while 0.5.1 was being made in the main
  checkout, then merged with it. Released as 0.6.0 after a check of the packaged build: it opens
  on the update screen, then the sidebar, a session and its info card, from inside the app archive.

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
   - **After 0.5.0, at your request:** no second window. Gloom's own window, at the size it is,
     becomes the update window: the app goes from view and the window shows the same page (icon,
     status, progress, version at the bottom), and the whole of it drags. At launch it is the
     window's first frame while the check runs; from the Update button it fades in over the app.
     When it's done the light comes up behind the icon as it fades, and the app is there (or back,
     if the update failed). `src/main/update-screen.ts` holds the steps,
     `src/renderer/src/features/update/UpdateScreen.tsx` draws them; the app is inert underneath
     and focus comes back where it was. Developer → Preview Update Screen plays it. The Update
     button is now just the download arrow in Gloom's indigo, in its own glass capsule, with
     "Update Ready" as its tooltip. While Gloom runs the check stays every half hour; coming back
     to Gloom when one is overdue (the PC slept) runs it then.
   - **After 0.6.0, at your request:** your artwork replaces the sparkles. `icon.png`, the gloomy
     cloud on its tile, is on the app, the installer and the uninstaller; the update screen shows
     `update.png`, the same cloud without the tile, breathing while it works, with the light
     behind it in the cloud's violet. `scripts/make-icons.mts` resizes both, averaging in linear
     light so the glowing eyes and prompt stay bright down to 16 px. The "Updated" note keeps its
     sparkle: there it means "new", not "Gloom". Released as Gloom 0.6.1 after a check of the
     packaged build: Gloom.exe carries the icon, and the update screen shows the cloud from inside
     the app archive.
2. **Library.** Transcript indexer in a utility process (tail reads, cache, subagent files skipped),
   watcher, library store, folder tree (nesting, rename, drag, keyboard, context menu, smart folders,
   search, filing rules, subtree delete with Undo), session list (pin, archive, rename).
   **Done 2026-10-30, released as Gloom 0.4.0.**
   - **Index:** `src/worker/indexer.ts` in the "Gloom Transcripts" utility process, watched with
     chokidar. Your 91 transcripts (1.5 GB, the biggest 520 MB) index in **38 ms cold and 5 ms
     warm**, against the 3 s and 300 ms targets: the CLI re-appends its title and last prompt as it
     goes, always within 32 KB of the end. The cache is `transcript-index.json` in userData.
     Gloom follows `CLAUDE_CONFIG_DIR` when it's set, as the CLI does.
   - **Library:** `src/shared/library.ts` (pure operations, shared with the window), saved by
     `src/main/library/store.ts` as `library.json` with a `.bak`. Main owns it; the window sends
     operations and gets every change back.
   - **Sidebar:** smart folders, your folders nested without limit, Archived at the bottom. One tab
     stop; arrows, Home/End, type to find, F2, Delete (with Undo), numpad `*`, Enter on to the list;
     Alt-click a disclosure for everything below. A click on the selected folder renames it, as in
     Finder. New Folder (Ctrl+Shift+N, or the + by "Folders") makes a top-level folder; "New Folder
     Inside" is in the folder's context menu.
   - **Drag:** sessions onto a folder, onto Unfiled (out of folders), Pinned (pins) or Archived
     (archives, with Undo); folders above, below or into another. Resting on a closed folder opens
     it. A drop that can't land flies back.
   - **Session list:** pinned sessions lead under their own heading; rows show the title, when, the
     last prompt, the project, and the folder when it isn't the one you're in. Ctrl/Shift-click and
     Shift+arrows select; Ctrl+A; F2 renames; Delete archives with Undo; Left goes back to the
     sidebar. View options sort (last activity, name, date created) and include subfolders.
   - **Search** (Ctrl+Shift+F; Ctrl+F stays for find in chat) looks through every folder's titles,
     prompts and project names. Archived sessions only show when Archived is selected.
   - **Filing rules** (a folder's context menu): pick from your projects or any folder. As the plan
     says, a new rule files the Unfiled sessions it covers, and later changes never move a session.
   - **Pulled forward from Phase 4:** the status dot for a session running elsewhere (its
     transcript grew in the last minute). The composer lock and Take over stay in Phase 4.
   - **Until the viewer:** the chat pane shows the selected session's details, with Reveal Working
     Folder and Copy Session ID. Folder defaults (working folder, model, mode) wait for New Session
     in Phase 4.
   - **Undo:** Ctrl+Z (Edit → Undo, named for what it undoes: "Undo Archive") takes back folder and
     session changes, newest first; it undoes typing when a field has focus. Toasts offer the same
     Undo for changes that take something out of view; they sit under the title bar.
   - **Design and motion pass** with `apple-hig` and `apple-design`: rows select on press (a press
     on a selected row keeps the selection for dragging); selected rows keep full contrast on any
     accent; Shift+F10 opens the list's context menu at its row; a drop travels into its folder,
     which acknowledges it, and a refused one flies back; the list fades under its toolbar when
     scrolled. Deliberate departures: the sidebar nests without limit (Gloom's reason to exist,
     where Apple suggests two levels), and Move To lists where things are now, dimmed, so the
     folder tree keeps its shape.
   - Tests: 39 new unit tests (indexer, operations and their Undo, filing rules, store recovery) and
     6 end-to-end tests; the end-to-end tests now run against a throwaway Claude folder, never yours.
   - Released as 0.4.0 after a check of the packaged build: its indexer runs from inside the app
     archive.
3. **Read-only viewer, first release.** Paged transcript renderer (newest chain, compaction cut, lazy
   images, find in chat). Gloom is now a usable organizer next to the Claude app; "Resume in
   terminal" opens `claude --resume <id>` in a new terminal window. The installer, the release
   script (publishes to GitHub releases) and the updater that every later phase reaches you
   through came early, in Phase 1 (see its notes).
   **Starts with both Apple skills loaded**, `apple-hig` and `apple-design` (see "Decided with you"),
   and ends with their review of the transcript, tool rows and find bar before it's released.
   **Done 2026-10-30, released as Gloom 0.5.0.**
   - **Reading:** `src/worker/reader.ts`, in the same "Gloom Transcripts" process as the index. The
     newest page is read back from the end of the file along the chain of parent links, so a
     branch a rewind left behind drops out. Parallel tool calls hang their results off side
     branches (only the last is on the chain), so results are matched to calls by ID from every
     line read. A page ends at the start of a turn once it shows 150 entries (inside one huge turn,
     at a response past 800 entries or 24 MB parsed). A compaction ends the chain; Show Earlier
     reads on from the conversation before it, and says so when a fork's file doesn't hold it.
     Your 520 MB transcript's newest page reads in about 20 ms and shows in about half a second.
   - **The model:** `src/shared/transcript.ts` turns each line into entries (prompts, one per
     reply block, notices, command output, compactions) and tool results with what the tool
     reported (diff hunks and +/− counts, stdout and stderr, exit state, answers, to-dos).
     Images and long text stay in the file: entries carry a reference (line offset, length, path
     into the line), read when a row is drawn or Show All is clicked. Unknown entry types are
     logged once with the CLI version.
   - **Following:** the open transcript is followed as Claude Code writes it. Lines that continue
     the chain are appended, results arriving on side branches fill in their calls, and a rewind
     or a rewritten file sends the newest page again, merged with what's loaded. A session
     running elsewhere shows the live dot by its title and a spinner on calls still waiting.
   - **The window:** Virtuoso, opening at the bottom; older pages load as you scroll up, and the
     view stays pinned to the bottom while you're there. Your prompts sit in bubbles on the
     trailing side (pasted blocks fold into a chip, images in a strip of fixed height, so nothing
     moves when they load). Replies are markdown (react-markdown + remark-gfm, no raw HTML); code
     is highlighted by shiki in a web worker with its JavaScript engine, a curated set of 61
     languages loaded on demand, and an Xcode-like palette in CSS variables. Thinking folds,
     tool calls are one line each ("Edited server.ts +3 −1", "Ran npm test", "Failed" in words),
     and each finished turn says how long it took and on which model. A click on an image zooms
     it out of its thumbnail.
   - **Find (Ctrl+F, F3 and Shift+F3):** a glass bar at the top trailing corner. It searches the
     loaded transcript as you type, including folded thinking and tool output (which opens to
     show the match), marks matches with the CSS Highlight API, and the current match pops once,
     as in Safari.
   - **Resume in Terminal** (chat toolbar, File menu, session menu) runs `claude --resume <id>`
     in a new PowerShell window in the session's folder, through `Start-Process`, so Windows'
     default terminal opens it. It says why when it can't: the folder is gone, or the session ran
     on another machine.
   - **Review** with `apple-hig` and `apple-design`. Fixes made:
     - a focus ring on the transcript when the keyboard is on it;
     - press feedback on tool rows and disclosures;
     - a `--warning` colour, instead of borrowing a syntax colour;
     - a retried request reads "retried 2 times";
     - the lightbox grows out of its thumbnail and goes back into it.
   - **Departures**, deliberate:
     - the jump-to-latest button sits at the bottom of the chat, as in Messages; End does the same;
     - thinking the model didn't show gets no row (it was a "Thought for 1s" line between every
       call).
   - **Not run:** `review-animations` only runs when you start it (`/review-animations`).
   - **Found on the way:** an IntersectionObserver inside the virtualized list never reported
     images in view, so an image loads when its row is drawn (the list only draws rows near the
     screen).
   - **Tests:** 21 new unit tests (the reader: chain, parallel results, rewinds, compactions,
     paging, references, following; the rows and Find) and 4 end-to-end tests on a made-up session
     (`test/support/demo.ts`), plus viewer captures in light and dark. The packaged build was
     checked: the reader and the highlighting worker run from inside the app archive.
4. **Live chat.** Session runner (streaming, stop, queued messages, resume, idle close, process-tree
   kill), composer with `/` commands, New Session with the trust prompt and folder defaults, model,
   mode and effort pickers, all three prompt cards (a live session can't do much without them),
   context meter and usage limits, attention (toasts, flash, badge), the running-elsewhere lock with
   Take over, Settings and first run.
5. **Diff and terminal panes.**
6. **Rewind, edit and worktrees.** Edit and rewind with the conversation / code / both choice;
   worktree sessions in git repos, Merge, cleanup on archive, and the missing-folder behaviour
   recorded in Phase 0.
7. **Polish pass with the skills.** An `apple-hig` and `apple-design` review of every screen, then
   `review-animations`, `animation-performance`, and `break-ui` with worst-case data (500 sessions,
   folders 8 levels deep, 200-character titles, empty folders, your 496 MB transcript). Then reduced
   motion, transparency and contrast, a full keyboard audit, and a check of the security settings.
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
- **Updates:** publish a test release, see the download arrow appear (at the next launch, or within
  half an hour), click it, watch the window become the update screen, and Gloom relaunches on the
  new version.
- **Skill reviews:** every UI phase is built with both Apple skills loaded (`apple-hig` with its
  foundation pages, and `apple-design`). It ends with a review of its new screens against both,
  plus `review-animations`. The full audit is Phase 7.
