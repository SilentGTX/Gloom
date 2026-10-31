# Gloom

A Windows desktop app for Claude Code, modelled on the Claude app's Code tab, with unlimited nested
folders for sessions. Personal project: the build plan is [PLAN.md](PLAN.md), phase notes are in
[docs/](docs/).

## Run

```bash
npm install        # also fetches Electron's binary (postinstall)
npm run dev        # the app with hot reload
npm run build      # type-check, then a production build into out/
npm run dist       # one-click NSIS installer in release/<version>/
```

## Release

```bash
npm run release -- "What changed"   # builds the installer from HEAD, publishes v<version> to GitHub releases
npm run release -- --local          # the same build and signature, published nowhere
```

Bump `version` in package.json, commit and push first: the release is tagged at HEAD, and the
script refuses a version that's out already. Every release's `update.json` is signed with Gloom's
release key, an Ed25519 key in `~/.gloom/release-key.pem` (or `GLOOM_RELEASE_KEY`) that never goes
in the repo; keep a copy of it somewhere safe. Gloom installs a newer release only when its
`update.json.sig` matches the public key in `src/main/release-key.ts`, and `update.json` names the
SHA-256 of everything it installs. `scripts/manifest.mjs` writes and signs the manifest;
`scripts/release-key.mjs` made the key, once. A new key would mean installing the first release
signed with it by hand.

Updates work like Sync's (and Discord's): at launch Gloom's window shows the update screen while it checks
the latest release, through your `gh` login since the repo is private. A newer one downloads there
with progress and is checked against its SHA-256. It unpacks beside the running copy, in
`versions\<version>` in Gloom's install folder, and the new version takes the window over without
it closing: its window opens on top of the old one on the same screen, the old one quits, and the
screen gives way to the new app (`src/main/versions.ts`, `src/main/handover.ts`). The installer's
copy then starts the newest version that has run, and Gloom's shortcuts point straight at it.
Where that can't be done (or from versions before it), the installer runs silently and Gloom
reopens. While Gloom runs, a check every half hour lights up the download arrow in the title bar;
clicking it turns the window into the same screen. Help → Check for Updates… checks right away,
and Developer → Preview Update Screen plays the screen's steps without installing anything.
`GLOOM_UPDATE_DRY_RUN=1` makes a packaged build do everything but install, and
`GLOOM_UPDATE_FROM=<folder>` reads `update.json` and its files from a folder instead of GitHub,
to try an update without publishing it (`release/<version>` after `npm run release -- --local`).

The packaged app is hardened with Electron's fuses (`electron-builder.yml`): it can't run as
plain Node, ignores `NODE_OPTIONS` and `--inspect`, loads only its own archive and checks it
against the hash in `Gloom.exe`, and serves its page from `app://gloom` rather than `file://`
(`src/main/protocol.ts`). Gloom isn't code-signed for Windows: that takes a paid certificate.
electron-builder signs on its own when one is given (`WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`).

Gloom's cloud is `update.png` (a square PNG, at least 256 px). The app icon is the cloud on a
violet tile, which `scripts/make-icons.mts` draws; the update screen shows the cloud on its own.
After changing the cloud or the tile, run `npx tsx scripts/make-icons.mts`: it writes
`build/icon.ico` (the app, the installer and the uninstaller), `build/icon.png`, and
`src/renderer/src/assets/update.png`.

## Test

```bash
npm test           # unit tests (vitest)
npm run e2e        # end-to-end tests against the built app; run `npm run build` first
```

End-to-end tests launch Gloom with a throwaway profile and a throwaway Claude Code folder
(`CLAUDE_CONFIG_DIR`) holding made-up transcripts, so they never read or change your sessions.
The viewer's tests and captures read a made-up session built in `test/support/demo.ts`.
`GLOOM_RESUME_DRY_RUN=1` makes Resume in Terminal answer without opening a window, and
`GLOOM_TERMINAL_HIDDEN=1` opens the terminals Gloom starts hidden.

`GLOOM_E2E_REAL_KEYS=1 npm run e2e` also sends real keystrokes through Windows. It takes the
foreground, and sends nothing unless Gloom is the foreground window.

The packaged app has a headless smoke test: `Gloom.exe --smoke-pty=<file.json>` starts PowerShell
through node-pty, writes the result and exits. Every release is checked first with
`GLOOM_PACKAGED_EXE=release\<version>\win-unpacked\Gloom.exe npx playwright test packaged`: its
fuses, a session, the panes, the keyboard and the settings moving over from `file://`, through
Chromium's DevTools port (the fuses refuse the `--inspect` Playwright's Electron driver needs),
and a copy with one byte of its archive changed, which mustn't start.

## Claude Code tools

```bash
npm run spike -- <check>|all   # Phase 0 checks of the Agent SDK against your claude.exe (spends a little usage)
npm run fake-claude:test       # replays every recorded stream through the SDK and the fake claude
```
