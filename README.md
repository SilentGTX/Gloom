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
```

Bump `version` in package.json, commit and push first: the release is tagged at HEAD. Updates
work like Sync's (and Discord's): at launch a small update window checks the latest release,
through your `gh` login since the repo is private. A newer one downloads there with progress, is
checked against its SHA-256, installs silently and Gloom reopens on it. While Gloom runs, a check
every half hour lights up **Update** in the title bar; clicking it hands over to the same window.
Help → Check for Updates… checks right away, and Developer → Preview Update Window plays the
window's steps without installing anything. `GLOOM_UPDATE_DRY_RUN=1` makes a packaged build do
everything but run the installer.

The app icon is drawn in `src/shared/icon-art.ts`; `npx tsx scripts/make-icons.mts` renders it
into `build/icon.ico` and `build/icon.png`.

## Test

```bash
npm test           # unit tests (vitest)
npm run e2e        # end-to-end tests against the built app; run `npm run build` first
```

`GLOOM_E2E_REAL_KEYS=1 npm run e2e` also sends real keystrokes through Windows. It takes the
foreground, and sends nothing unless Gloom is the foreground window.

The packaged app has a headless smoke test: `Gloom.exe --smoke-pty=<file.json>` starts PowerShell
through node-pty, writes the result and exits.

## Claude Code tools

```bash
npm run spike -- <check>|all   # Phase 0 checks of the Agent SDK against your claude.exe (spends a little usage)
npm run fake-claude:test       # replays every recorded stream through the SDK and the fake claude
```
