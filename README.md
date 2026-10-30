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
