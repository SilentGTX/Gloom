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

**Not in v1:** command palette (planned next; out after v1 as Gloom 0.11.0, see "9. Command
palette"), `@` file mentions (out after v1 as Gloom 0.12.0, see "10. `@` file mentions"),
browser pane, artifacts, task lists, side sessions, PRs, cloud sessions, split view, fast mode
and full-text search across transcripts (all built after v1 with the rest of the Claude app's
Code tab, see "12. Parity with the Claude app"), multiple accounts, dated library backups.

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
| Updates | Sync's updater (check, download with sha256, silent NSIS `/S --force-run`), reading GitHub releases of the private repo; `update.json` signed with an Ed25519 release key | your Sync app |

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
│  ├─ commands.ts               every command + shortcut in one registry (menu, accelerators, the palette)
│  ├─ files.ts                  what `@` lists: a session's files, from git or a walk of its folder
│  ├─ notify.ts                 toasts, taskbar flash and badge
│  ├─ updater.ts                GitHub releases check, download, silent install (Sync's updater)
│  ├─ release-key.ts            the public half of the key every release is signed with
│  ├─ protocol.ts               app://gloom/, the page's own scheme
│  ├─ storage.ts                settings kept under file:// move to app://gloom, once
│  ├─ update-screen.ts          the update screen's steps: launch check, download, install, relaunch
│  ├─ versions.ts               updates unpacked beside the running copy; the newest runs at launch
│  ├─ handover.ts               the new version takes the window over from the old one
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
│  ├─ features/palette/         the command palette (Ctrl+K): commands, sessions and folders
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
- **CLI version (built in Phase 4):** Gloom runs your own `claude.exe` (2.1.186 here) while the SDK
  expects 2.1.314. Settings › Claude Code shows the version and offers **Update Claude Code…**
  (`claude update`, in a terminal) when it's behind. Everything in Phase 4 works on 2.1.186; the
  flag it rejects (`--resume-drops-turn`) is Phase 6's.

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
in the browser only for http(s), and in-app navigation is blocked. The page comes from Gloom's own
`app://gloom`, and Electron's fuses are set (Phase 8): no running as Node, no `--inspect`, the app
archive checked against Gloom.exe. Updates install only when signed with Gloom's release key.

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
download's progress, the version). The update unpacks beside the running copy and the new version
takes the window over without it closing (Phase 1's notes, "After 0.6.2"); where it can't, the
installer runs silently and reopens Gloom. At launch the same screen is the window's first frame
while the check runs, and fades to the app when there's nothing new.
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
- **Each session row:** title, time (relative, then a date after a week) and the last prompt. A
  running session's title shimmers, light sweeping across it as in Claude Code (in another app
  now; in Gloom from Phase 4, where waiting for you gets its own mark). The selected one, the session
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
- **Sorting** (View › Sort Sessions By): date created, newest first (the default, so a session
  keeps its place while it runs), last activity or name; pinned ones lead.
- **Five at a time:** an open group shows its first five sessions, then **Show More** for five
  more (as Claude Code does); closing the group starts it over. Subfolders always show, search
  results and Archived show everything, and the open session always shows, however far down.
- **Selection:** multi-select (Ctrl and Shift) and drag to a folder.
- **New Session (Ctrl+N):** the pencil at the top of the sidebar. Choose the working folder
  (prefilled from the folder's defaults), model and mode; in a git repo a **worktree** switch, on by
  default; a folder Gloom hasn't seen asks for trust first; it's placed in the folder you're in.

**2. Chat (right).**
- **Toolbar:** the session's title with what it's doing beside it ("Active now"), and a worktree
  session's branch with Merge; trailing, one capsule with the sidebar's show/hide, the terminal
  and diff panes and ⓘ, which opens the session's details as a card (working folder, folder,
  started, last active, started from, branch, session ID, with Resume in Terminal, Reveal Working
  Folder and Copy Session ID).
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
  (from the SDK's init message); `@` lists the working folder's files and folders, and Claude Code
  reads what you mention (see "10. `@` file mentions"). A **context meter** shows how full the
  session's context is, with a Compact button; **usage limits** show your plan's 5-hour and weekly
  use, if the CLI reports them.
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
  for other reasons, and switches to the clear glass below. `prefers-contrast` gives the glass a
  solid rim and stronger text. Text size goes to 200%; chrome is sized in pixels so it holds its
  shape.
- **Clear glass (View → Always Show Glass; your ask, out as Gloom 0.11.1):** Blissful's Apple
  glass, the recipe its tooltips use: a 10% white tint (60% in light), a 12px blur, a short soft
  shadow (Tailwind's shadow-lg), no rim and no sheen, so the dusk shows through the sidebar on any
  PC. The search field takes Blissful's search bar tint as a fill (never glass on glass), lifted
  under the pointer. Two departures, both for legibility: the sidebar's secondary ink is 0.76 in
  the dark (the ember under clear glass took the usual 0.66 to 4.1:1 at the sidebar's foot; now
  4.8:1), and menus, popovers, tooltips and sheets even out the light behind them (`contrast()` and
  `brightness()` in their backdrop filter): on the paper they match Blissful's panels, and over a
  white screenshot in the dark, or a black one in the light, secondary text still reads at 4.7:1
  (Blissful's recipe measured 1.6:1 there). Increase Contrast keeps the frosted glass and its rim.
  Tokens: `tokens.css` › `:root[data-glass='on']`; test: `glass.spec.ts`.
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
- **One signature element** (apple-hig improvement mode): the live title, light sweeping across a
  running session's title (unless it's the selected one), once every 1.8 s, as in Claude Code, and
  still once the turn ends. Well
  clear of the slow loops around 0.2 Hz the guidelines flag; it rests at 4.5:1 or better between
  sweeps, and holds still under reduced motion. (It replaced a glowing status dot in front of the
  title, at your request.)

## Phases

**Status, 2026-10-30: Phases 0, 1, 2 and 3 are done**, and Gloom 0.5.0 (Phase 3, the viewer) is
released. **Small changes before Phase 4, at your request, released as Gloom 0.5.1:** the window
becomes the update screen instead of opening a second window, and the Update button is just a
download arrow (Phase 1's notes, "After 0.5.0"). **One sidebar** (below) is out as Gloom 0.6.0,
and **your new icon**, the gloomy cloud, as Gloom 0.6.1 (Phase 1's notes, "After 0.6.0"). The
sidebar's click and motion fixes are out as Gloom 0.6.2. **Updates that don't close the window**,
the cloud on a violet tile and the shimmering title of a running session are out as Gloom 0.6.3
(Phase 1's notes and the sidebar's, "After 0.6.2"). Show More and a sidebar that keeps its order
are out as Gloom 0.6.5, and a fix for clicks lost while a group opens as Gloom 0.6.6. **Phase 4,
live chat, is out as Gloom 0.7.0** (2026-10-31). **Phases 5 and 6**, the diff and terminal panes,
then rewind, edit and worktrees, were built the same night at your request and are out together
as **Gloom 0.8.0** (2026-10-31), and a fix for the blank window the Effort menu left as Gloom 0.8.1
(Phase 4's notes). **Phase 7, the polish pass, is out as Gloom 0.9.0** (2026-10-31; its notes
below). **Phase 8, packaging, is out as Gloom 0.10.0** (2026-10-31; its notes below). All eight
phases are done; next is the week as your daily driver (Decided with you). **The command palette,
planned next, is out as Gloom 0.11.0** (2026-10-31; its notes below, "9. Command palette").
**Clear glass**, your ask (View › Always Show Glass is Blissful's Apple glass), is out as Gloom
0.11.1 (2026-10-31; its notes in "Design system", above). **`@` file mentions**, the next item,
is out as Gloom 0.12.0 (2026-10-31; its notes below, "10. `@` file mentions"). A fix for
Update Claude Code…, Log In… and Resume in Terminal, which opened nothing, is out as Gloom 0.12.1
(Phase 4's notes).

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
- **After 0.6.2, at your request:** a running session's title shimmers, as in Claude Code (not on
  the selected row, which the indigo already marks), and the dot in front of it is gone; "Now"
  beside it stays, and a screen reader hears "Running in another app". The info card keeps its
  small dot beside "Running in the Claude app". Released as Gloom 0.6.3.
- **After 0.6.4, at your request:** a group shows five sessions, then Show More for five more. And
  sessions keep their places: sorting by last activity swapped two running sessions every time
  either wrote, so the default is now date created, newest first (your setting moved over; Last
  Activity is still in View › Sort Sessions By). Released as Gloom 0.6.5, after a check of the
  packaged build (Show More, a session that comes alive keeping its place, and node-pty).
- **Found in 0.6.5's packaged build:** a click on Show More (or a session) while its group was
  still opening could go nowhere. Pressing a row focuses it, and the half-open group's contents
  were `overflow: hidden`, which a browser can still scroll: focus scrolled the row into view and
  slid the session above it under the pointer before the press let go. They're `overflow: clip`
  now, which can't be scrolled; a test checks that focusing a row in an opening group leaves it
  where it is (it moved 74 px before). Released as Gloom 0.6.6: the same quick clicks that lost
  their way on the packaged 0.6.5 land every time on the packaged 0.6.6.
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
   - **After 0.6.2, at your request:** on the taskbar the icon looked odd beside Claude's. Its
     dark tile was 1.13:1 against the dark taskbar (Claude's orange is 5.3:1), and it filled only
     88% of its image, so Windows drew it at about 21 px against Claude's 24. You picked the
     cloud on a violet tile from three mock-ups: `scripts/make-icons.mts` draws a rounded square
     edge to edge (#a78bfa to #6d28d9) and puts `update.png` on it; `icon.png` is gone. Released
     as Gloom 0.6.3.
   - **After 0.6.2, at your request: updates without the window closing**, the way Discord
     installs them. A release also carries the app as a zip, which unpacks beside the running copy
     into `versions\<version>` in the install folder (`src/main/versions.ts`), so nothing has to
     close. The screen says "Starting Gloom x", the new version opens its window on top of the old
     one, in the same place and on the same screen, the old one quits, and the screen gives way to
     the new app with "Updated to Gloom x" (`src/main/handover.ts`). The new version shows only the
     screen until the old one has gone, because the app's settings live in storage the old one
     holds; it opens fully clear and turns opaque once Windows' opening zoom is over, and the
     cloud breathes in time with the clock, so the swap can't be seen. Checked with two packaged
     builds: there was a Gloom window on screen at every moment, about 3 s from launch to the new
     version. At launch the installer's copy starts the newest version that has shown its window
     before, and once one has, Gloom's own shortcuts (Start menu, desktop, taskbar) point straight
     at it, so launches don't go through the old copy (about 0.4 s). A version that never comes up
     is removed and Gloom stays as it was; old versions go once a newer one has settled in. Where
     an update can't unpack beside it (no zip, or a folder it can't write), the installer runs as
     before. `GLOOM_UPDATE_FROM=<folder>` tries an update from a folder. Found on the way:
     Electron's fs keeps any `app.asar` it touches open, which locked the new folder, so this uses
     `original-fs`. Released as Gloom 0.6.3, whose packaged build was checked; your copy installs
     0.6.3 the old way, since 0.6.2 runs that update, and the ones after it in place.
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
   **Done 2026-10-31, released as Gloom 0.7.0.** Built with both Apple skills loaded
   (`apple-hig` with its foundation pages and the text field, pop-up button, sheet, modality, alert,
   settings, progress, gauge, notification, onboarding, launching, feedback and loading pages;
   `apple-design` for motion).
   - **Running sessions:** `src/main/claude/runner.ts` drives one session's `claude` through the
     Agent SDK in streaming-input mode (a new session gets its ID up front, `sessionId`; later starts
     `resume` it). `src/main/claude/sessions.ts` keeps them all: six processes at most (the
     longest-idle closes first, never one mid-turn), idle ones close after Settings' time (10 minutes),
     and the whole process tree goes with `taskkill /T` (MCP servers too). Quitting mid-turn asks first.
   - **What you see:** each finished line shows the moment the stream has it; the transcript file
     takes over under the same UUIDs (your CLI writes it about 100 ms behind). The reply streams in
     (text as it comes, thinking folded, a tool's name as its call forms) above "Thinking · 12s",
     and calls still waiting say what they're doing ("Writing hello.txt"). A new session shows in
     the chat and the sidebar at once, before it has a transcript.
   - **Composer:** glass, floating over the transcript's foot. Enter sends, Shift+Enter starts a
     line. While Claude works a message waits as a Queued chip (× takes it back); Esc or Stop
     (File › Stop, Ctrl+.) ends the turn and puts what was queued back in the box. `/` lists the
     session's commands. Paste or drop images (5 MB each); other files go in as their paths. The
     mode, model and effort pop-ups switch a running session live. A ring by Send shows how full the
     context is; its card has Compact Now and your plan's 5-hour and weekly use.
   - **Prompt cards** above the composer, one at a time, Enter to answer and Esc to decline:
     **permission** (the command, the edit as a diff, or the new file; Deny, Always Allow saying what
     it allows and where it's saved, Allow Once; "Tell Claude What to Do…" denies with a note and lets
     Claude carry on), **Claude's plan** (Keep Planning with a note, or Approve Plan into a mode,
     Accept Edits by default) and **questions** (options as buttons, Other, Skip).
   - **New Session** (Ctrl+N, the pencil, or a folder's New Session Here…): working folder (your
     recent ones, or Choose Folder…), model, mode, effort and where it goes. A folder's Defaults for
     New Sessions… (or its parents') fill it in. A folder Claude hasn't worked in asks for your trust
     first: Trust and Start.
   - **Attention:** in the background, a card waiting or a turn ending sends a Windows notification
     (never the command itself; a click opens the session), flashes the taskbar button, and its badge
     counts the sessions waiting for you. In the sidebar a working session's title shimmers and a
     waiting one says "Waiting".
   - **When it can't send:** a session growing in another app says so in the composer's place, with
     Take Over; one whose folder is gone, or that ran on another machine, says why. Without Claude
     Code the window says how to install it, or to choose claude.exe.
   - **Settings** (File › Settings…, Ctrl+,): new sessions' model, mode and effort; when idle
     sessions close; notifications; appearance (Windows, Light, Dark) and glass; Claude Code's path,
     version, Update Claude Code… and Log In… (each in a terminal); Gloom's version and Check for
     Updates.
   - **Updates wait for Claude:** Update clicked mid-turn says "Updates When Claude Finishes" and
     installs once no session is working; the window and the open session come back.
   - **Review** with both skills. Fixes made: primary actions (Send, Allow Once, Approve Plan, Start
     Session, Done) take Gloom's indigo, since Windows' gray accent made them read as disabled; an
     answered card leaves the layout at once, so the next one doesn't stack under it, and can't be
     reached while it goes; the working line isn't a live region (its ticking clock would be read out
     every second); the streaming reply no longer re-renders the transcript above it; one sheet at a
     time.
   - **Departures**, deliberate: the composer and its cards sit at the window's foot, a chat's place
     as in Messages (the toolbar's "Waiting for you", the sidebar, notifications and the badge say it
     elsewhere); Settings is a sheet in the window rather than its own window; mode, model and effort
     live in the composer, not in the menu.
   - **Found on the way:** the SDK's messages and the transcript's lines share UUIDs, prompts
     included, so the file can take over from the stream line by line; the fake claude writes no
     transcript, so the tests see only what came from the stream.
   - **Tests:** the runner against the fake (two turns, the queue, Stop, permission, plan, question),
     the stream and the merge with the file; end-to-end, the three cards, Stop with a queue, New
     Session with trust, a notification in the background, the running-elsewhere lock and a missing
     folder; and one opt-in turn on your real claude.exe (`GLOOM_REAL_CLI=1`, a few cents of Haiku).
   - Released as 0.7.0 after a check of the packaged build: a session runs two turns in one process
     from inside the app archive (on the fake claude).
   - **Found after 0.8.0 (you):** opening the Effort menu left a blank window. Its "Effort" label
     sat outside any group, which Base UI answers by throwing as the menu opens, and with nothing
     to catch it React unmounted the whole window. It broke every time, in the composer, New
     Session and Settings; no test had opened that menu. The label is inside its radio group now,
     and a test opens the menu in all three places (a one-off sweep opened every other pop-up too:
     all fine). Error boundaries guard the window, the chat under its toolbar, the sidebar, the
     diff and the terminal: a part that fails to draw says so with Try Again and Copy Details
     (Reload Window for the whole window), and the rest keeps working. Released as **Gloom 0.8.1**
     after a check of the packaged build.
   - **Found after 0.12.0 (you):** Update Claude Code… did nothing, and nor did Log In… or Resume
     in Terminal, which open their terminal the same way (`src/main/terminal.ts`). Gloom starts a
     hidden PowerShell that opens the visible one, and started it detached: on Windows that leaves
     PowerShell with no console at all, so its Start-Process opened nothing and it still exited
     as if all was well. Likely broken since Resume in Terminal arrived in Phase 3; every test ran
     Resume as a dry run, so none saw it. It isn't detached now (the window it opens never was
     Gloom's child, so it stays open after Gloom quits either way). `test/e2e/terminal.spec.ts`
     presses Update Claude Code… for real, with the window hidden (`GLOOM_TERMINAL_HIDDEN`) and
     Windows' whoami standing in for claude, and finds the terminal it opened; it fails on the old
     code. The packaged check does the same on the build that goes out. Released as **Gloom
     0.12.1** at your "Ship 0.12.1", after the packaged check passed on the build and again on the
     build that went out; a throwaway copy of 0.12.0 took the signed 0.12.1 and handed over.
5. **Diff and terminal panes.**
   **Done 2026-10-31.** Built with both Apple skills loaded (`apple-hig` with its foundation pages and
   the split view, tab view, segmented control, toolbar, list, scroll view and disclosure pages;
   `apple-design` for motion).
   - **Diff pane** (View › Show Diff, Ctrl+Shift+D, or the toolbar's diff button): beside the chat on
     the trailing side, resizable and remembered; when the chat would drop below 560 px it floats
     over the chat as a sheet instead. A segmented control in its toolbar switches between:
     - **This Session:** Claude's edits, from the transcript. Claude Code no longer records a file as
       it was before an edit (`originalFile` is null in your transcripts), so Gloom composes each
       file's patches into one diff, from before the session's first edit to after its last, with
       what the patches have shown as context (`src/shared/diff.ts`). An edit put back shows as
       nothing. The transcripts process reads it (`src/worker/edits.ts`): a big transcript once,
       decoding only the lines that carry a patch, then only what's appended.
     - **Working Tree:** what git sees, `git diff HEAD` plus untracked files, with the branch
       (`src/main/git/diff.ts`); git runs without taking its index lock. A folder that isn't a
       repository, no git, or a folder that's gone each say so.
     - Files in path order, so they hold still while Claude works, each under a header that stays at
       the top while its lines scroll by: a click folds it (Alt-click folds all), right-click for
       Reveal in File Explorer and Copy Path. Lines are highlighted by shiki, wrap, and are drawn in
       chunks as they scroll into view; the unchanged lines between hunks are counted. A new file
       reads as plain code (its header says Added) rather than a screen of green. It refreshes as
       the session works and when you come back to Gloom, and with F5 (View › Refresh Diff).
   - **Terminal pane** (View › Show Terminal, Ctrl+\`, or the toolbar's terminal button; File › New
     Terminal, Ctrl+Shift+\`): under the chat, resizable. xterm over node-pty (Windows' ConPTY), in
     the session's working folder; sessions in the same folder share their terminals. Tabs (arrows
     move between them), + for another; `exit` closes a tab whose shell ended cleanly, as Terminal
     does, and the last tab closing puts the pane away. Hiding the pane keeps the shells and their
     screens. The shell is in Settings › Terminal: Windows PowerShell (the default), PowerShell 7,
     Command Prompt or Git Bash, whichever are installed. Copy and paste as Windows terminals do
     (Ctrl+C with a selection, Ctrl+V, a right-click). Every other key goes to the shell (Ctrl+R is
     its history search, not Reload); Gloom keeps only its pane, sidebar, search, text size,
     settings and quit shortcuts. A flood of output is paced: the shell pauses while the screen is
     more than 2 MB behind. Its own light and dark palettes, every colour 4.5:1 or better.
   - **Toolbar:** the capsule is now Sidebar · Terminal · Diff · ⓘ, the pane buttons held in while
     their pane shows. Resume in Terminal moved into the ⓘ card (it's still in the File and session
     menus): the toolbar's terminal button is the pane's now.
   - **Review** with both skills. Fixes made: each segment has a tooltip, and View › Show in Diff
     switches them too (every toolbar item in a menu); the list of changes takes the keyboard
     (arrows, Page Up/Down) with a focus ring; the bright terminal colours were raised to 4.5:1 on
     the light sheet; a new file lost its green.
   - **Departures**, deliberate: the terminal sits at the window's foot, where Apple advises against
     controls (it's content you open, like Xcode's debug area); terminals belong to a folder rather
     than a session.
   - **Found on the way:** a transcript is blank for a few frames as it opens (Virtuoso hides its list
     until it has reached the bottom); opening the diff pane doesn't cause it.
   - **Tests:** the composer against a direct diff on 500 random edit sequences (unique and repeated
     lines, edits put back) and the git parser; end-to-end, the session diff, Working Tree on a real
     repository, the narrow sheet, a shell typing and closing, a hidden pane keeping its screen; and
     opt-in real keystrokes (Ctrl+R to the shell, Ctrl+\` and Ctrl+Shift+D to Gloom from inside it).
6. **Rewind, edit and worktrees.** Edit and rewind with the conversation / code / both choice;
   worktree sessions in git repos, Merge, cleanup on archive, and the missing-folder behaviour
   recorded in Phase 0.
   **Done 2026-10-31**, straight after Phase 5 at your request ("do phase 6 and then push and make
   new version"). Built with both Apple skills (`apple-hig`'s foundation pages, plus the alert,
   modality, sheet and undo pages; `apple-design` for motion).
   - **Checked first on your claude.exe (2.1.186):** a process started just for it can preview and
     rewind files to a message an earlier process sent (the dry run takes about 1.3 s), and
     `resumeSessionAt` set to the entry before a message carries on from there
     (`npm run spike -- rewind-resume`; one opt-in real-CLI test drives it all through Gloom's own
     runner). Every session Gloom runs now has checkpoints on (`enableFileCheckpointing`), so its
     Write and Edit changes can go back; the UUID Gloom gives each message you send is its
     checkpoint. Sessions run before 0.8 have none, and the sheet says so.
   - **Rewind to Here** (hover one of your messages, or tab to it): a sheet asks what to restore,
     Conversation and Code, Conversation Only or Code Only, with the files and lines the code part
     would put back (Claude Code's own preview). The conversation part shows at once (your message
     and what came after it leave the view) and your message comes back to the composer, as
     Claude Code does; the next message carries on from before it, and the old turns stay in the
     file as a branch. Until you send something, Undo (in the toast, or Edit › Undo Rewind) takes
     it back. Newer CLIs also get `--resume-drops-turn`, and if one refuses the fork Gloom carries
     on plainly and says so, as the SDK asks.
   - **Edit** (the pencil beside Rewind): your message goes into the composer with a banner saying
     what sending will do, and a checkbox to restore the code Claude changed since (on when there's
     any). Sending rewinds, then sends your new words; Esc or × gives your draft back. The first
     message of a conversation can't be edited (there's nothing before it), and says so.
   - **Worktrees:** New Session in a git repository has "Work on a branch of its own", on by
     default: `git worktree add` at `<repo>/.claude/worktrees/<two-words>` on `claude/<two-words>`,
     from the checkout's last commit, with `.claude/worktrees/` added to `.git/info/exclude`
     (`src/main/git/worktrees.ts`). The branch it came from is kept in the repository's own config
     (`branch.claude/<name>.gloomBase`). A worktree session's toolbar shows its branch and
     **Merge** (also File › Merge Worktree…): a sheet says how many commits go where, warns when
     changes aren't committed (Ask Claude to Commit), and merges with a merge commit in the main
     checkout, which must be on that branch. On conflicts it stops, puts the branch back as it
     was, names the files and offers Ask Claude to Resolve (merge the base in, resolve, commit).
     Working Tree in the diff pane shows a worktree's changes since it left its branch, committed
     ones included: what Merge would bring.
   - **Archiving** a worktree session removes its worktree once Undo has passed (the branch stays);
     one with uncommitted changes asks first. A process still running there closes first; one
     mid-turn keeps its folder.
   - **A missing working folder** says so in the composer's place with **Recreate Folder**: a
     worktree comes back from its branch, any other folder is made again, empty, and the session
     carries on (Claude Code only finds a session from its own folder).
   - **Review** with both skills. Fixes made: questions as sheet titles take sentence case, as
     Apple's alerts do ("Rewind to before this message?"); Merge has a menu command, like every
     toolbar item; a conversation rewind joins Edit › Undo rather than living only in a toast.
   - **Departures**, deliberate: Edit happens in the composer rather than inside the bubble; the
     rewind sheet's Rewind button isn't styled destructive, because you chose to rewind (Apple
     keeps that style for what you didn't choose; removing a worktree with changes gets it).
   - **Not covered:** the diff pane's This Session still lists edits a code rewind took back (the
     transcript keeps them); Working Tree shows the truth.
   - **Tests:** unit tests for worktrees against a real repository (make, exclude, merge, conflicts,
     a checkout on another branch, remove, recreate, Working Tree since the base); end-to-end,
     Rewind to Here with Undo, Edit with Esc, and a new session in a worktree with its branch and
     Merge; the opt-in real-CLI test of rewind and edit.
   - Released with Phase 5 as **Gloom 0.8.0**, after a check of the packaged build: from inside the
     app archive, the diff pane, a PowerShell in the terminal pane (node-pty from
     `app.asar.unpacked`; `--smoke-pty` too) and the rewind preview (on the fake claude).
7. **Polish pass with the skills.** An `apple-hig` and `apple-design` review of every screen, then
   `review-animations`, `animation-performance`, and `break-ui` with worst-case data (500 sessions,
   folders 8 levels deep, 200-character titles, empty folders, your 496 MB transcript). Then reduced
   motion, transparency and contrast, a full keyboard audit, and a check of the security settings.
   **Done 2026-10-31**, at your "Phase 7". Reviewed with both Apple skills (`apple-hig`'s foundation
   pages plus its Liquid Glass, keyboard, focus, sidebar, sheet, toolbar, writing and dark mode
   pages; `apple-design` for motion), `break-ui` and `animation-performance`; the security check
   against Electron's checklist.
   - **Worst case** (`test/support/worst-case.ts`, captured by `test/e2e/worst-case.spec.ts` into
     `test-screens/worst-case/`): 500 sessions; folders eight deep with sessions at the bottom; a
     200-character title and a 300-character rename; titles in Chinese, Arabic, Vietnamese, emoji
     and markup; three sessions all called "phase 2"; a session with no title or prompt; a clock
     two days ahead; empty folders; 120 archived; and a chat holding the longest of everything (a
     260-character path, a wide table, a 3,000-line output, a 700-line edit, 60 files edited, a
     2,000-line new file, a panorama and a full-page capture). What broke, and the fix:
     - a wide table split its numbers and words mid-way ("1,204,1 / 18"): cells now break only
       between words, and the table scrolls sideways in its box;
     - at 200% text the toolbar capsule, the search field and the jump button ballooned around
       symbols that stayed small: spacing is in pixels now (chrome holds its shape and text grows,
       as the plan always said), the sidebar's counts and headings grow with their labels, and
       the sidebar may be dragged wider as the text grows (420 px at the usual size, up to 840 at
       200%; back at the usual size it narrows, and your wider choice waits for the bigger text);
     - a title, folder name or menu item cut short had no way to be read: hovering one now shows
       it whole (macOS's expansion tooltips), menus stop at 400 px instead of stretching across the
       window (Move To with a 120-character folder), and ⓘ names the session in full above your
       last prompt (the toolbar's title can't show a tooltip: it's the window's drag area);
     - a missing working folder put its whole path inside a three-line sentence: the path has a
       line of its own, cut in the middle so the folder's own name shows;
     - a full-page screenshot showed as a 12 px sliver: thumbnails fill their frame and crop, as
       Photos does, and the full picture still opens on a click;
     - the diff pane listed `step-21` before `step-6`: files are in File Explorer's order.
     - Held up: 500 sessions (five at a time with Show More), eight levels of folders, the
       identical titles (their last prompts tell them apart), escaping, emoji, other scripts, the
       future date, unbreakable paths and URLs in bubbles and replies, and the long transcript.
     - **Your biggest transcript** (520 MB): readable in **320 ms** from the click (the bar is
       1 s), an older page in 20 ms, with the end-to-end tests running beside it.
   - **The keyboard:** a walk with Tab found that **no button showed where the keyboard was**:
     Tailwind's `outline-none` also cancels the style its focus rings draw in, so every
     `focus-visible` ring drew nothing (it had been so since Phase 1; the sidebar's rows, which ring
     an inner row, were fine). One rule restores them all. The transcript's own ring (Phase 3) never
     showed either: the list it's built on sets `outline: none` in its inline style, which is gone
     now. A test walks the window with Tab and fails on any stop without a ring (40 of 40 ring now). **F6 and Shift+F6** (View › Next Pane, Previous Pane) move the
     keyboard between the sidebar, the transcript, the composer, the diff and the terminal, as in
     Windows' own apps; it's also the way out of a terminal, which keeps every other key.
   - **Contrast:** Windows' contrast themes repaint every fill, so the open session, a menu's
     highlighted item, the chosen segment and tab, a drop target and the edges of every card and
     capsule disappeared. They take the theme's highlight and a hairline frame now, and buttons
     with words get a border. Increase Contrast and reduced transparency already held (this PC runs
     with transparency off, so every capture here shows the opaque glass).
   - **Motion and performance:** springs trimmed to 0.3 s or less (the sidebar slide was 0.32, the
     update arrow 0.45). Sidebar rows were measured for a spring on every update the library sent
     (every half second while a session runs): now only when their place changes. A splitter drag
     re-rendered the chat on every move; the chat now sits out a resize. The transcript read a
     computed style on every scroll event, and the pointer's light restyled its whole capsule: both
     go straight to what they change. The Edit and Rewind capsule beside each of your messages no
     longer blurs while it's invisible.
   - **Security:** fixed what could run things you didn't ask for:
     - Resume in Terminal built a PowerShell command out of the working folder, and PowerShell also
       ends a quoted string at curly quotes, so a folder named `x’;calc;#` (or just `O’Brien`)
       broke out of it. The folder and claude's path now travel in environment variables.
     - Gloom ran `git` by name in the session's folder, and Windows looks in that folder first: a
       repository carrying its own `git.exe` would have had it run (New Session asks git about the
       folder before the trust prompt). git, taskkill, PowerShell and gh now run by full path
       (`src/main/exec.ts`).
     - Reveal Working Folder opened whatever the transcript named; a file is now only shown in its
       folder.
     - Also: the page is granted the clipboard and nothing else (Electron granted any permission);
       a release's `update.json` must name a plain version and plain file names; development's URL
       check compares origins, not prefixes.
   - **Departures**, deliberate:
     - the running title's shimmer still paints each frame (its light is a moving background); a
       compositor-only version means drawing the title twice, and the cost is one line of text;
     - glass over the sky and the toolbar's paper blurs almost nothing; it's the look you picked,
       and with transparency off (your PC) there's no blur at all;
     - the Developer menu and the test variables (`GLOOM_UPDATE_FROM` and the rest) stay in
       released builds: Reload is the way back from a blank window, packaged updates are tested
       with them, and using them takes control of how Gloom is started, which is code already
       running as you;
     - folders on network shares (`\\server\…`) still open, since WSL's folders are paths like
       that too;
     - sessions nest deeper than Apple's two levels (Gloom's reason to exist); a deep title is
       read on hover or by widening the sidebar.
   - **For Phase 8** (packaging): Electron's fuses (no running as Node, no `--inspect`, the app
     archive's integrity checked), code signing, and serving the page from Gloom's own protocol
     instead of `file://`. They change how the packaged app starts, and Playwright needs `--inspect`
     to check a packaged build, so they go with the installer work.
   - **Not run:** `review-animations` only runs when you start it (`/review-animations`).
   - **Tests:** the worst-case spec (the captures, plus no sideways overflow in the sidebar and the
     transcript); `test/e2e/audit.spec.ts` (the composer and its cards in light and dark, contrast
     themes, Increase Contrast, the keyboard walk, F6); an opt-in timing of your biggest
     transcript (`GLOOM_BIG_TRANSCRIPT=<path>`; it hard-links the file into a throwaway Claude
     folder and prints times, nothing of it is captured); and `test/e2e/packaged.spec.ts`, the
     check every release now gets before it goes out (`GLOOM_PACKAGED_EXE=<its Gloom.exe>`: the
     transcripts process, git, node-pty, the rings and F6, the clipboard, Resume in Terminal).
   - Released as **Gloom 0.9.0** at your "Ship 0.9.0", after that check passed on the packaged
     build, and again on the build that went out (`--smoke-pty` too). Its first run found one more
     thing: F6 from a toolbar's button went to the first pane rather than the next; fixed before
     the release.
8. **Package.** Installer polish (the app icon came in 0.3.0), and what Phase 7 left for it:
   Electron's fuses, signing, and the page served from Gloom's own protocol.
   **Done 2026-10-31** at your "Phase 8"; released as Gloom 0.10.0 (the last note).
   - **Fuses** (`electron-builder.yml`, flipped in Gloom.exe as it's packed): it can't be run as
     plain Node (`ELECTRON_RUN_AS_NODE`), ignores `NODE_OPTIONS` and `--inspect`, runs the app only
     from its archive, and checks the archive against a hash built into Gloom.exe: a copy with one
     letter of its code changed doesn't start. Cookies are encrypted too (Gloom keeps none worth
     anything; it's Electron's advice). Found on the way: node-pty's `kill()` forks a Node helper
     on Windows, which without RunAsNode would start a second Gloom. Gloom already ended shells
     with taskkill; the smoke test's timeout now does too.
   - **Gloom's own protocol:** the page comes from `app://gloom/` (`src/main/protocol.ts`), not
     `file://`, which had powers no web page has (fetching any file on the PC); the fuse that
     granted them is off. Only the renderer's folder is served, and IPC and navigation trust
     `app://gloom/index.html` alone.
   - **Your settings come along.** A new origin starts with an empty localStorage, which is where
     the window keeps its settings (sidebar width, sort, open groups, text size), when Gloom last
     ran each session, and the version it last ran (for the "Updated" note). The first time 0.10
     starts in a profile an earlier Gloom ran in, it copies them across before the app reads them
     (`src/main/storage.ts`, `lib/storage.ts`), from a blank page under `file://` that nothing
     shows. With the fuse off, `file://` can't load from inside the archive and has no storage at
     all, so that one page is written to a temp folder and runs with web security off: it's
     Gloom's own and runs one line. An entry the page already has wins, and the old ones stay, so
     an older version still finds its own. Taking over from 0.9, it waits for 0.9 to quit first.
   - **Signed releases.** Windows code signing needs a certificate from a certificate authority,
     paid every year with an identity check, so Gloom isn't signed for Windows; electron-builder
     signs on its own once one is given (`WIN_CSC_LINK`). What's signed instead is the updates:
     every release's `update.json` carries a signature by Gloom's release key (Ed25519), and Gloom
     installs a newer release only when it matches the public key Gloom carries
     (`src/main/release-key.ts`). `update.json` names the SHA-256 of the installer and the zip, so
     the signature covers them too: someone with your GitHub account or token could publish a
     release, but not one Gloom would install.
     - The private key is `C:\Users\origi\.gloom\release-key.pem`, never in the repo. **Keep a
       copy somewhere safe:** a new key means installing the first release signed with it by
       hand, with its installer.
     - `scripts/release-key.mjs` made it; `scripts/manifest.mjs` signs, and refuses a key that
       isn't the one Gloom carries; `npm run release -- --local` builds and signs without
       publishing.
     - The release script now refuses a version that's out already: a `--dir` build at 0.9.0
       overwrote 0.9.0's unpacked folder on the way (restored from its zip, which matches
       update.json).
     - 0.9 doesn't check signatures, so it installs 0.10 as before; from 0.10 on, an unsigned
       release isn't installed. An older one on GitHub is ignored either way, so only a newer
       one is checked.
   - **Installer polish:**
     - Windows' Apps list says Gloom 0.2.0 on your PC: updates arrive without the installer,
       which is what writes that entry. A version that came as an update now writes its own
       version there, when the entry is its install folder's.
     - Installing Gloom again over an update remakes the Start menu and desktop shortcuts but not
       a taskbar pin, which went on starting the old version from `versions\`. The installer's
       copy now takes back any shortcut still pointing there.
     - The rest held up: one click, per user, the cloud on the installer and uninstaller, the
       uninstaller takes `versions\` with the rest and keeps your library. Sizes are unchanged
       (installer 116.5 MB, zip 145.9 MB).
   - **The packaged check** (`test/e2e/packaged.spec.ts`): Playwright's Electron driver needs
     `--inspect`, so the check starts Gloom.exe itself and connects to Chromium's DevTools port.
     It adds the fuses in the exe, `--inspect` ignored, the page on `app://gloom`, settings moving
     from `file://`, code colouring (a module worker from `app://gloom`), no errors in the page,
     and the changed copy refusing to start.
   - **Checked on real builds:** the shipped 0.9.0 (unpacked from its zip) updated itself in place
     to 0.10.0 on a throwaway copy and profile, the way your copy will; the text size set in 0.9.0
     was there in 0.10.0, moved during the handover itself. Then 0.10.0 refused a 0.10.1 whose
     update.json had gained one space, and one with no signature, and installed the signed 0.10.1.
   - **Departures**, deliberate:
     - Chromium's `--remote-debugging-port` still works in released builds: Electron has no fuse
       for it, the packaged check needs it, and using it means starting Gloom yourself, which is
       already running code as you (as Phase 7 said of the Developer menu and test variables);
     - node-pty's files in `app.asar.unpacked` (its .node, OpenConsole.exe, winpty-agent.exe)
       aren't covered by the hash, which only covers the archive;
     - no Windows code signing, so a first install from the installer meets SmartScreen once;
       updates don't (Gloom downloads them itself).
   - **No screen changed**, so the Apple skills weren't loaded for this phase.
   - **Tests:** `test/unit/protocol.test.ts` (paths that leave the renderer's folder, the one
     trusted page), `test/unit/release-key.test.ts` (signatures, and what `manifest.mjs` signs is
     what Gloom accepts), `test/e2e/storage.spec.ts` (settings from `file://`, once, never over
     newer ones), and the packaged check above. 114 unit tests and 60 end-to-end tests pass.
   - Released as **Gloom 0.10.0** at your "Ship 0.10.0", after the packaged check passed on the
     build, and again on the build that went out (`--smoke-pty` too). Before it went out, 0.8.1,
     the version your PC runs, updated a throwaway copy of itself to that build, settings and
     all. The published `update.json` checks out against the release key.
9. **Command palette** (after v1; "planned next" in Not in v1).
   **Done 2026-10-31**, released as Gloom 0.11.0 at your "Ship 0.11.0" (the last note); built on
   branch `command-palette` in its own worktree. You chose the shortcut, what it finds and the
   order before it was built (Ctrl+K; commands, sessions and folders; best match first, in
   groups). Built with both Apple skills loaded (`apple-hig`'s foundation pages plus its
   searching, search field, menus, panels, keyboards, focus and selection, Liquid Glass and
   modality pages; `apple-design` for motion).
   - **Ctrl+K** (View › Command Palette…) opens it from anywhere, the terminal pane included (Git
     Bash's own Ctrl+K gives way there), and puts it away again. A glass panel near the top of the
     window: the field, then the results. The window under it can't be reached while it's up; a
     click outside puts it away and goes no further.
   - **What it finds:** every command in the menu, as the menu shows it now ("Hide Sidebar" or
     "Show Sidebar", "Undo Archive"), with its shortcut and a checkmark on what's on; every
     session, by its title, its prompts or its project, as the sidebar's search does; every folder,
     however deep, with where it is ("in Clients › … › EU (Frankfurt)", whole on hover). A few
     commands answer to other words too (Settings to "preferences", Quit to "exit": `keywords` in
     the registry).
   - **The order:** before you type, Recent (the five sessions you were in last, newest first,
     leaving out the open one, so Ctrl+K then Enter takes you back to the one before; then the
     most recently active) and every command in menu order. As you type, Commands, Sessions and
     Folders each in their own group, the group holding the best match on top and the best first
     in each; what you picked lately wins ties. A session counts as visited once it has stayed open
     a second, so arrowing past sidebar rows doesn't. Every word you type must match: the start of
     a name ranks first, then the start of a later word, initials ("ns" finds New Session…), inside
     a word, then letters in order ("trml" finds Terminal). Case and accents don't matter; prompts,
     projects and paths count for half. At most 30 sessions and 20 folders show; typing more
     narrows them (`features/palette/rank.ts`, pure and tested).
   - **Keys:** arrows and Page Up/Down move, Enter runs, Esc clears what you typed and then
     closes, as a search field does. Commands that can't run now are dimmed, listed after the
     rest and skipped. The pointer picks what it moves onto.
   - **What a pick does:** a command runs as from the menu and takes the keyboard where it goes
     (Search Sessions to the sidebar's field); a session opens with the keyboard in its composer
     (an archived one in Archived, where the sidebar can show it); a folder opens with every
     folder above it, the sidebar comes into view, and its row takes the keyboard and lights up the
     way a drop does. Put away, the palette gives the keyboard back where it was (to the Menu
     button when it came from the menu).
   - **One source for the menu and the palette** of what each command says and whether it can
     run (`lib/command-state.ts`). Stop is now dimmed in both unless the open session is mid-turn.
     The palette waits while a sheet is up (New Session, Settings…): one modal view at a time.
   - **Motion:** from the keyboard it comes and goes at once (keyboard actions don't animate);
     from the menu it grows in from just below full size (180 ms) and a click outside fades it
     (120 ms); reduced motion only fades. The highlight follows the keys without animating.
   - **Review** with both skills. Fixes made:
     - the result Enter uses is drawn in Gloom's indigo with every line white, as the sidebar's
       open session is and as macOS draws a focused list row in the accent; it was the menus'
       faint 8% fill, about 1.2:1 against the panel;
     - names line up with what you type, symbols with the field's magnifier;
     - a deep folder's path shows its outermost folder and the one it's in (its end used to be
       cut off), whole on hover and to a screen reader;
     - in Windows' contrast themes the active result takes the theme's highlight and dimmed
       commands its gray;
     - Stop is dimmed when nothing runs.
   - **Departures**, deliberate:
     - no dimmed window behind it, as Spotlight and Xcode's Open Quickly have none (a palette you
       open many times a day shouldn't flash the window darker); a click outside still only closes
       it;
     - the field draws no focus ring: it's the palette's one stop, and its caret shows where the
       keyboard is, as in Spotlight;
     - it's centred on the window rather than grown out of the menu button (from the keyboard
       there's nothing to grow out of);
     - only transform and opacity animate (no blur materialising in), Gloom's rule since Phase 1.
   - **Found on the way:** Tailwind's colour utilities outrank component styles, so a row's
     secondary text stayed dark on the indigo; the palette's colours are component classes now.
     And a screen-reader-only span after cut-off text widened the list at 200% text until its
     line became its containing block; the worst-case test caught it.
   - **Not run:** `review-animations` only runs when you start it (`/review-animations`).
   - **Tests:** unit tests for the ranking (`test/unit/palette.test.ts`: Recent, word starts,
     initials, letters in order, every word, accents, keywords, ties, dimmed commands, groups
     ordered by their best match, folders by their path, the limits); end-to-end
     (`test/e2e/palette.spec.ts`): Ctrl+K, a command run with Enter, Esc, the arrows skipping what
     can't run, the pointer, a session opening with Recent going back, a folder three deep
     revealed, the menu item, a click outside, waiting for a sheet, and captures in light, dark,
     contrast themes and Increase Contrast (`test-screens/palette/`); the worst-case library
     (500 sessions, folders eight deep, 200% text) in `worst-case.spec.ts`.
   - Released as **Gloom 0.11.0** at your "Ship 0.11.0", after the packaged check passed on the
     build (it now opens the palette and runs a command with it), and again on the build that
     went out (`--smoke-pty` too). The published `update.json` checks out against the release
     key, and its hashes match the installer and zip that went out.
10. **`@` file mentions** (after v1; next in Not in v1 after the palette).
   **Done 2026-10-31**, released as Gloom 0.12.0 at your "Ship 0.12.0" (the last note); built on
   branch `at-mentions` in its own worktree. You agreed the scope before it was built: the `@` list in the composer, and under your message
   the files Claude Code read in. Built with both Apple skills loaded (`apple-hig`'s foundation
   pages plus its token fields, combo boxes, text fields, entering data, menus, lists and tables,
   focus and selection, searching, keyboards, motion and Liquid Glass pages; `apple-design` for
   motion).
   - **What Claude Code does with `@path`**, observed before building (`npm run spike --
     mentions`: 16 short Haiku turns, on your CLI 2.1.186 and the SDK's 2.1.314, the same on
     both). The CLI reads what's mentioned itself when the message comes through the SDK, so
     Gloom only writes the path; it never reads a file for Claude. Claude answered from the file
     every time without a tool call: a relative path, one beside an image, `@"my docs/c
     file.txt"`, a folder (its listing), `@e.txt#L3-4` (those lines only), an absolute path,
     backslashes. A path that isn't there stays text. The stream says nothing of it; the
     transcript gets an `attachment` line per mention, which the CLI shows under the prompt as
     `⎿ Read notes\a.txt (2 lines)` and `⎿ Listed directory listing\` (seen by resuming the
     session in a pseudo-terminal, nothing sent).
   - **The CLI's own `@` list**, watched the same way: `@` alone (at the start or after a space)
     lists the folder's top level A–Z, dotfiles, `.git` and ignored ones too. Typing searches the
     whole project (in git, what git knows and new files it doesn't ignore, with their folders;
     anywhere else every file), letters in order across the path, up to 15. Tab or Enter puts the
     highlighted one in with a space after it and closes the list (Enter doesn't send); a path
     with a space goes in quoted; a folder goes in whole rather than opening. Esc puts the list
     away and the next key brings it back. It lists MCP resources and agents too, which Gloom
     leaves out.
   - **Gloom's `@` list** does all of that, over the box where the `/` list shows: a file or
     folder symbol, the name, and in secondary ink the folder it's in (its outermost folder and
     its own when it runs deep, all of it on hover and to a screen reader). The keyboard stays in
     the box: the arrows (round from either end), Tab or Enter, Esc; the pointer highlights what
     it moves onto and a click puts that in. A match in the name counts first (all of it, its
     start, a word in it, inside it), then in the path (a folder's start, inside), then letters in
     order, a match that starts a word winning; ties go to the shorter path, then A–Z
     (`features/chat/mentions.ts`, pure and tested). The list goes when the box loses the
     keyboard.
   - **Under your message**, as the CLI shows them: "Read notes/a.txt · 2 lines", "Read src/app.ts
     · lines 2–3", "Listed docs/", on your side, each opening to what Claude Code read in (a long
     file reads the rest when you ask, as a tool's output does). They come from the transcript,
     which Gloom follows, so they show during a turn too; the CLI's other attachment lines stay
     hidden.
   - **The listing** is made in main (`src/main/files.ts`), only in the session's working folder:
     the window names a session, never a path, and a session from another machine or whose folder
     is gone lists nothing. git runs by its full path (`ls-files --cached --others
     --exclude-standard`); outside git a walk, nearest files first, stops at 50,000 files or 3 s
     (your D:\JS took 0.65 s and your home folder 1.4 s, both stopping at the cap). The window asks
     when the box gets the keyboard, so the list is ready by your `@`, and again at each `@`, for
     files made since; main answers from one listing for 10 s.
   - **The `/` list is the same list now**, so it changed too: the row Tab or Enter takes is in
     Gloom's indigo with white text, as in the palette (it was the faint 8% fill the palette's
     review measured at about 1.2:1); it appears and goes at once (it grew in over 180 ms, against
     "keyboard actions don't animate"); a click puts a command in on release rather than on press;
     its text grows with the text size; Shift+Tab moves the keyboard back rather than taking a
     command.
   - **Review** with both skills. Fixes made:
     - the listing is asked for when the box gets the keyboard, not at the first `@`, which outside
       git showed nothing for up to 1.4 s;
     - the highlight goes to the first row in the same frame as what you type, not a frame later;
     - "btn" finds Button.tsx before unbuttoned.ts: letters that start a word win;
     - folders say "(folder)" to a screen reader; Windows' contrast themes draw the highlight in the
       theme's own colours.
   - **Departures**, deliberate:
     - paths go in with forward slashes: the CLI ends a folder with `\` on Windows
       (`src/components\`) and uses `\` throughout outside git, and reads either;
     - the list goes when the box loses the keyboard (a terminal has no such moment);
     - MCP resources and agents aren't listed, and line ranges are typed by hand (the scope you
       agreed).
   - **Not run:** `review-animations` only runs when you start it (`/review-animations`).
   - **Tests:** unit (`test/unit/mentions.test.ts`: the word at the caret, quoted paths, what a
     pick puts in, the ranking, 15 at most, 50,000 paths a keystroke, the listing in a git
     repository, from a folder inside one, and outside git, the attachment lines, the rows);
     end-to-end (`test/e2e/mentions.spec.ts`): the folder's top level, finding as you type, Tab
     and Enter, a quoted path, ignored and new files, the arrows, Esc, a folder, an `@` inside a
     word, the pointer, a deep path, the list going with the keyboard, the `/` list, the rows under
     a message opening, and captures in light, dark, contrast themes, Increase Contrast and 200%
     text (`test-screens/mentions/`).
   - Released as **Gloom 0.12.0** at your "Ship 0.12.0". Main had moved on to clear glass (0.11.1)
     meanwhile, so the branch went onto it first and every test ran again. The packaged check
     passed on the build (it now lists a session's files with `@` and puts one in with Tab), and
     again on the build that went out (`--smoke-pty` too). The published `update.json` checks out
     against the release key, and its hashes match the installer and zip that went out (GitHub's
     own digests of them as well).

11. **Concept design** (your handoff, `Downloads\Gloom\design_handoff_gloom_concept`; out as
    **Gloom 0.13.0**). You asked to try it and to be able to go back easily, so
    it's a switch: **View › Design › Concept / Classic** (also Settings › Window › Design and the
    command palette). Concept is what Gloom opens in; Classic is the window as it was, untouched
    (the end-to-end suite runs in it). Switching crossfades the window (a view transition,
    240 ms). Nearly all of it lives in `features/concept/` and `styles/concept.css`, so either
    look can go later in one change.
   - **What changed:** the dusk is gone for a neutral window (`#FBFBFA` / `#1E1E1F`) and one
     accent: a violet from Gloom's icon, oklch 0.6 0.2 293 (`#8860EA`), your pick over the
     handoff's orange. The sidebar is frosted glass with a hairline edge: round Menu,
     Hide Sidebar and New Session buttons, the search field (saying its shortcut), one-line
     30 px session rows with a mark (a spinner while it works, amber while Claude waits, green
     when it finished while you were elsewhere, a hollow ring at rest), the open session in the
     accent at 14%, filled folders in the accent, and at the foot your account, plan and weekly
     use (from the Agent SDK's `accountInfo()` and the usage Gloom already reads; it shows once a
     session has started, and is remembered). The chat's toolbar has the title over its folder
     and branch, Conversation | Changes | Terminal in the middle, a status pill (Waiting for you,
     Working, Active 33m ago) and the inspector's button. Tool calls are cards with a glyph tile;
     the newest to-do list is an open checklist; your bubble has its tail. Claude's requests wait
     at the end of the conversation as cards (the accent tile, Esc and ↩ beside their buttons);
     Tell Claude What to Do… puts the note in the composer ("Tell Claude what to do instead"),
     and sending it denies the request with that note. The Changes view is a card per file (the
     first open), This Session / Working Tree on a small track, Refresh; the Terminal view is the
     shells on a card. The inspector (Ctrl+I, which is Session Info in Classic; View › Show
     Inspector) lists the changes (Review Diff, Open in Editor: VS Code by its `vscode://` link,
     else File Explorer), the context as a ring, and the model, mode, branch and folder, with
     Resume in Terminal. Below about 1240 px it floats over the chat as a sheet; below about
     770 px the sidebar folds away as before.
   - **Departures**, deliberate:
     - text colours are a shade darker where the handoff's fall under 4.5:1: secondary ink
       `#69696e` (4.8:1 on the sidebar's glass, the handoff's 4.4:1), and in light the greens,
       reds and amber used for text (+6, −3, Waiting) are darker versions of the handoff's
       marks; white text sits on a deeper violet (5.6:1; the accent gives 4.3:1);
     - the dark segmented thumb is one step lighter than the card colour, which vanished on its
       track;
     - the idle session mark is a hollow ring, so idle and finished differ in shape as well as
       colour; the rows say it to a screen reader too;
     - folders keep their disclosure triangle (Gloom's folders nest);
     - Gloom's Library, Folders and Archived stay (Archived ends the list; the foot is for your
       account); a session row's last prompt is its tooltip;
     - the search field's hint says its real shortcut (Ctrl+Shift+F; Ctrl+K is the palette);
     - Hide Sidebar sits by the menu (macOS's place) and comes to the chat's leading edge with the
       sidebar away; the handoff's Appearance button was for reviewers and isn't there;
     - the toolbar stays 48 px (the caption buttons' height); the composer keeps Effort.
   - **Not done:** the theme crossfade when Windows switches light and dark (the page can't see
     the old colours once Windows has changed them); the handoff's step durations ("0.4s") and
     "No errors", which the transcript doesn't record.
   - **Tests:** `test/e2e/concept.spec.ts` (the window in light and dark, the three views, the
     inspector and its sheet, a narrow window, a permission card answered with Tell Claude What
     to Do; captures in `test-screens/concept/`); the rest of the suite pins Classic
     (`launch({ design })`); the packaged check ends by switching to the concept.
   - Released as **Gloom 0.13.0** at your "Ship 0.13.0" (built on branch `concept-design`,
     fast-forwarded into main). The packaged check and `--smoke-pty` passed on the local build
     and again on the build that went out; the published `update.json` checks out against the
     release key, and its hashes match the installer and zip that went out (GitHub's own
     digests of them as well).
   - **After 0.13.0**, your asks:
     - **The account at the sidebar's foot was missing:** it waited for a session's process to
       say who's signed in. Main now reads it from Claude Code's own config (`.claude.json`, in
       CLAUDE_CONFIG_DIR when set): the organisation (or your name, when the organisation is only
       you), the plan as the organisation has it, and the usage Claude Code last fetched, while
       its week is still running (a week that has reset since shows no figure until it's known
       again). Read at launch, as each turn ends, and when Gloom comes to the front
       (`src/main/claude/account.ts`); nothing else in the file is read.
     - **The classic's icons** in the concept: outline folders in the sidebar, the composer's
       Mode, Model and Effort chips with their symbols, and the diff pane's file symbols in the
       Changes cards and the inspector, in place of the M and A badges.
     - **The inspector, as Claude Code's panel:** each section is a card whose header folds it
       (folded, it says what matters: a count, a share with a short bar, the model) and drags it
       to another place, kept; Alt+Up and Alt+Down move the section whose header has the
       keyboard. A list longer than six shows six and Show N More / Show Less. Sections:
       Changes, Tasks (the newest to-do list, "1 of 3"), Context (the ring, the tokens, your
       5-hour and weekly use, Compact Now), Environment (this computer or another, the folder,
       the branch or worktree, Resume in Terminal), Connectors (the session's MCP servers and
       how each started, from its process's first message), Session (model, mode, effort,
       started, the ID with Copy). Context and Session start folded.
     - **Only older models in the list** (Opus 4.8, Sonnet 4.6): Gloom asks the CLI for its
       models on the first session of a launch and keeps the answer; yours was kept from the CLI
       you had before updating to 2.1.316, which lists the 5.5 models. It asks again now whenever
       a session's process is another CLI version.
     - **Still the older models in 0.13.1** (your report): it asked again only when a session's
       process started, and none had since you updated. Gloom now checks at launch, and when it
       comes to the front (every five minutes at most): when the installed CLI isn't the version
       the kept list came from (`settings.json` › `modelsFrom`, new), it asks that CLI for its
       models from a process sent no message, in an empty folder, so no turn, no usage and no
       session (`runner.ts` › `askModels`; your CLI answers in under a second). A list never
       learned from a CLI (a new install, the tests) still waits for the first session. Opt-in
       checks against your real CLI: `GLOOM_REAL_CLI=1 npx vitest run test/unit/real-cli.test.ts
       -t models` and `GLOOM_REAL_CLI=1 npx playwright test test/e2e/models.spec.ts` (a profile
       holding your old 4.8 list gets Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 at launch).
     - **Your limits at the sidebar's foot, and the usage panel** (your ask, with the Claude
       app's panel as the model): the foot showed no figure because the usage Claude Code had kept
       was from a week that had reset, and Gloom asked only after a turn. It now asks at launch,
       when it comes to the front (every five minutes at most) and as the panel opens (a minute),
       of a running session's process when there is one, else the same way as the models, without
       a message (`runner.ts` › `askUsage`, about a second); only once you're known to be signed
       in. A click on the foot opens the panel: "Your usage limits · Team", each limit the service
       names (5-hour limit, Weekly · all models, a model's own weekly limit), when it resets
       ("Resets at 8:30 PM", "Resets Sat 7:00 AM"), its share and a bar (amber when the service
       warns, red when it's critical), when it was read, and See All, which opens claude.ai's
       usage page. The service's list of limits is read when it sends one, else its two windows.
     - **A squeezed toolbar in a worktree session** (your report): the worktree's capsule (its
       branch and Merge) crowded the title and ran into the segments, and said the branch the
       subtitle already says. The concept's toolbar drops it: the subtitle names the project by
       the checkout the worktree came from, with the branch, and Merge is in the inspector's
       Environment, with how far ahead the branch is (File › Merge Worktree… as before). A new
       session's "New" pill went too: its title says it.
     - The tests never start your real CLI at launch (`GLOOM_NO_CLAUDE_ASKS`, set by
       `launch()`); `launch({ askClaude: true })` lets them.
     - The newer models at launch, the usage panel, your limits at the foot and the worktree
       toolbar were released as **Gloom 0.13.2** at your "Ship 0.13.2", after the whole suite
       passed (78). The packaged check and `--smoke-pty` passed on the local build and again on
       the build that went out; the published `update.json` checks out against the release key,
       and its hashes match the installer and zip that went out (GitHub's own digests as well).
     - Released as **Gloom 0.13.1** at your "Ship 0.13.1". The packaged check and `--smoke-pty`
       passed on the local build and again on the build that went out; the published
       `update.json` checks out against the release key, and its hashes match the installer and
       zip that went out (GitHub's own digests of them as well).

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

12. **Parity with the Claude app** (your "do all", 2026-10-31, after a check of what the Claude
    app's Code tab has that Gloom doesn't: its own Settings, sidebar and panes, and the tools it
    gives Claude). Built in the worktree `D:\JS\Gloom-parity` on branch `parity`, in four parts,
    each copying the Claude app's behaviour where it has one:
   - **A. Settings and small things:** keep the computer awake while Claude works (and on
     battery); notifications per kind (permission requests, questions, a finished turn: banner,
     badge only or off), their sound, and the taskbar flash as a switch; archive inactive
     sessions after a number of days; the branch prefix and the worktrees' location; output
     style; fast mode; prompt suggestions; Remote Control for new sessions; transcript views
     (normal, thinking, verbose); mark a session unread or completed; export a session (a zip in
     Downloads, as the app does); add a folder to a session; turn a session's MCP servers off
     and on, and reconnect them; search inside conversations.
   - **B. Tools Claude gets in Gloom:** an MCP server Gloom gives every session (the Agent SDK's
     in-process servers): the task list pinned under the latest message, the next-step box at a
     turn's end, chapters with a table of contents, inline widgets, the terminal pane's tabs
     (list, read, run, stop), sessions and folders, and Gloom's settings. Side sessions: Claude
     offers, proposes or starts another session (fresh or forked, in a worktree of its own),
     hands its task off, and hears when one it started finishes.
   - **C. Panes:** the trailing pane takes tabs: Diff, File (a file at a line), Plan, Tasks
     (background shells and agents, with Stop), Browser (a real browser view; dev servers from
     `.claude/launch.json`; browser tools for Claude) and Artifacts. Split view (two sessions
     side by side) and panes in a window of their own.
   - **D. Pull requests and elsewhere:** a session's pull request (found from its branch with
     `gh`, or linked by hand): checks, reviews, merge, auto-merge, Auto-fix (Gloom wakes the
     session on failed checks, conflicts and new comments) and archiving when it closes;
     Routines (prompts that run on a schedule while Gloom is open); SSH sessions (`claude` runs
     on another machine over `ssh`); cloud sessions (`claude --cloud`).
   **Built 2026-10-31, not released yet** (branch `parity`: c2adc5e part A, 7e3d557 part B,
   f36ddcb parts C and D, then the review's fixes). Built with both Apple skills (`apple-hig`'s
   foundation pages plus settings, toggles, text fields, managing notifications, searching,
   web views, split views and windows; `apple-design` for motion).
   - **A:** Settings has five panes (General, Sessions, Notifications, Claude Code, About).
     Keep awake is `src/main/power.ts` (powerSaveBlocker, let go 30 s after the work ends,
     battery from powerMonitor); notification levels per kind with sound and the taskbar flash
     (`attention.ts`, `noticeLevel`; the old single switch migrates to Off for every kind);
     archiving inactive sessions (`inactiveSessions` in shared/library.ts, hourly in main;
     never running, pinned or unread ones; a clean worktree goes too); branch prefix and a
     worktree folder of your own (`<folder>/<repository>/<name>`, `worktreeOf(cwd, folder)`);
     output style, fast mode, prompt suggestions and Remote Control go to the CLI as flag
     settings and SDK options (`runner.ts` › `options`); Transcript View (Normal leaves
     thinking out, Thinking shows it, Verbose opens every tool call and event: `OpenByDefault`
     and `useOpen` in ToolRow.tsx); unread marks (Mail's dot, `setUnread`); Export (a zip
     through Windows' tar.exe, `src/main/export.ts`); a session's extra folders (`setFolders`,
     `additionalDirectories`); MCP switches and Reconnect in the inspector; search inside
     conversations (`src/worker/search.ts`: a byte scan for the words as JSON writes them, then
     only matching lines parsed; "In Conversations" under the sidebar's results).
   - **B:** `src/main/claude/gloom-tools.ts`: an in-process MCP server, `gloom`, for every
     process (checked on your CLI 2.1.316: it connects and lists its tools, no message sent),
     with a short system prompt appended to Claude Code's. The task list, next-step box,
     chapters and widgets are read back from the transcript's tool calls (`src/shared/plan.ts`,
     `features/chat/Furniture.tsx`), so the Claude app's own calls (`mcp__ccd_*`) show the same
     way. Widgets run in a sandboxed frame of their own scheme, `gloom-widget://` (CSP: the three
     CDNs only, no network). Side sessions: `src/main/claude/side-sessions.ts` (start, offer card,
     proposal card, hand-off, `<side-sessions-event>` reports to the session that started one).
   - **C:** `features/side/SidePane.tsx` on the trailing side (File, Plan, Tasks, Browser,
     Artifacts, PR); the diff pane and inspector step aside for it. The Browser is a
     WebContentsView per session in its own profile (`src/main/browser.ts`), dev servers from
     `.claude/launch.json` (`src/main/preview.ts`), and browser tools for Claude. Split view keeps
     a second transcript store (`useSplitTranscript`, `TranscriptStore` context) and the worker
     follows two transcripts. Panes open in windows of their own (`createPopOutWindow`,
     `?popout=`); main sends live events to every Gloom window.
   - **D:** pull requests through gh (`src/main/git/pr.ts`, `pr-service.ts`): checks, reviews,
     merge, auto-merge, Auto-fix (`<ci-monitor-event>` on failed checks, conflicts, new comments)
     and archiving on close. Routines (`src/main/routines.ts`, `src/shared/routines.ts`: 5-field
     cron in local time, a missed run once at launch; Routines in the sidebar once one has run).
     SSH sessions (`src/shared/ssh.ts`; the runner spawns ssh with the CLI's arguments; the
     transcript comes back after each turn into `~/.claude/projects/ssh-<connection>/`, as the
     Claude app keeps its copies). Cloud sessions start through `claude --cloud` and open on
     claude.ai (`src/main/cloud.ts`).
   - **Departures**, deliberate: a widget's `sendPrompt()` puts its words in the composer for you
     to send (a page Claude drew can't send messages on its own); the browser is a native view, so
     it steps out of sight while a menu, dialog or popover is open over it; notifications keep
     flashing the taskbar by default, as Gloom always has (the Claude app's default is off).
   - **Not verified:** SSH against a real machine (none here), cloud sessions (starting one runs
     in the cloud and spends usage), Remote Control, prompt suggestions and fast mode against the
     service (each needs a real turn), and the PR monitor on a real pull request with CI.
   - **Tests:** `test/unit/parity.test.ts`; end-to-end `parity.spec.ts`, `furniture.spec.ts`,
     `side.spec.ts`, `remote.spec.ts`.
