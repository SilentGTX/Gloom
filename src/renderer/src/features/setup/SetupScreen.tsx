// A new PC's first run, as the Claude app's: the window gets Claude Code ready
// (Gloom's own copy, downloaded once) and then asks you to sign in to Claude.
// It has the update screen's page (the cloud, the name, a status line, a bar),
// with buttons where a step needs you. main/claude/setup.ts does the work.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { SetupState } from '@shared/ipc'
import cloud from '../../assets/update.png'
import { Button } from '../../components/ui/Button'
import { useLive } from '../../stores/live'

const mb = (bytes: number) => Math.round(bytes / 1e6)

/** Setup as main reports it, checked at launch and whenever the window comes back. */
function useSetup(): SetupState | null {
  const [state, setState] = useState<SetupState | null>(null)
  useEffect(() => {
    const api = window.gloom?.setup
    if (!api) return
    const off = api.onChange(setState)
    const check = () => void api.check().then(setState)
    check()
    window.addEventListener('focus', check)
    return () => {
      off()
      window.removeEventListener('focus', check)
    }
  }, [])
  return state
}

/** Whether the first-run screen is up: no Claude Code yet, or signed out. */
export function setupNeeded(state: SetupState | null): boolean {
  return !!state && (state.claude !== 'ok' || state.signedIn === false)
}

export function SetupScreen({ onOpen }: { onOpen(open: boolean): void }) {
  const state = useSetup()
  const open = setupNeeded(state)
  const reduce = useReducedMotion()
  // No Claude Code: Gloom gets its own straight away, as the Claude app ships with one.
  useEffect(() => {
    if (state?.claude === 'missing') void window.gloom?.setup.install()
  }, [state?.claude])
  // Claude Code arrived: the rest of the window learns where it is.
  useEffect(() => {
    if (state?.claude === 'ok') void window.gloom?.claude.info({ fresh: true }).then((claude) => useLive.setState({ claude }))
  }, [state?.claude])
  useEffect(() => onOpen(open), [open, onOpen])

  return (
    <AnimatePresence initial={false}>
      {open && state && (
        <motion.div
          key="setup"
          role="dialog"
          aria-modal="true"
          aria-labelledby="setup-name"
          aria-describedby="setup-status"
          className="update-screen drag fixed inset-0 z-[65]"
          data-status={state.claude === 'downloading' ? 'downloading' : state.claude === 'failed' ? 'failed' : 'ready'}
          data-busy={state.claude === 'downloading' || state.login ? '' : undefined}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reduce ? 0.2 : 0.35, ease: [0.23, 1, 0.32, 1] } }}
        >
          <div className="update-mark" aria-hidden>
            <div className="update-halo" />
            <div className="update-icon">
              <img src={cloud} alt="" draggable={false} />
            </div>
          </div>
          <h2 id="setup-name" className="update-name">
            Gloom
          </h2>
          {state.claude !== 'ok' ? <GettingClaude state={state} /> : <SigningIn state={state} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Gloom's own Claude Code on its way, or what went wrong. */
function GettingClaude({ state }: { state: SetupState }) {
  const progress = state.total > 0 ? state.received / state.total : 0
  if (state.claude === 'failed')
    return (
      <>
        <p id="setup-status" className="update-status" role="status">
          Couldn’t get Claude Code
        </p>
        <p className="update-detail max-w-[340px]">{state.error}</p>
        <div className="no-drag mt-4 flex gap-2">
          <Button size="text" tone="primary" className="rounded-full px-4" onClick={() => void window.gloom?.setup.install()}>
            Try Again
          </Button>
          <ChooseOwn />
        </div>
      </>
    )
  return (
    <>
      <p id="setup-status" className="update-status" role="status">
        Getting Claude Code ready…
      </p>
      <div className="update-progress" role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} style={{ '--progress': progress } as CSSProperties}>
        <span />
      </div>
      <p className="update-detail">{state.total > 0 ? `${mb(state.received)} MB of ${mb(state.total)} MB` : ''}</p>
    </>
  )
}

/** Your own claude.exe instead of Gloom's. */
function ChooseOwn() {
  const choose = async () => {
    const path = await window.gloom?.claude.locate()
    if (!path) return
    await useLive.getState().updateSettings({ claudePath: path })
    void window.gloom?.setup.check()
  }
  return (
    <Button size="text" tone="secondary" className="rounded-full px-4" onClick={() => void choose()}>
      Choose claude.exe…
    </Button>
  )
}

/** Signing in to Claude: Claude Code opens your browser; a code the page shows comes back here. */
function SigningIn({ state }: { state: SetupState }) {
  const [code, setCode] = useState('')
  const first = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => first.current?.focus({ preventScroll: true }), [!!state.login])
  const login = state.login
  if (!login)
    return (
      <>
        <p id="setup-status" className="update-status" role="status">
          Sign in to Claude to start.
        </p>
        <p className="update-detail max-w-[340px]">Your Claude account is shared with Claude Code, so the terminal’s claude is signed in too.</p>
        <div className="no-drag mt-4 flex gap-2">
          <Button ref={first} size="text" tone="primary" className="rounded-full px-4" onClick={() => void window.gloom?.setup.login()}>
            Sign In with Claude
          </Button>
        </div>
      </>
    )
  const send = () => {
    if (!code.trim()) return
    void window.gloom?.setup.code(code)
    setCode('')
  }
  return (
    <>
      <p id="setup-status" className="update-status" role="status">
        {login.error ?? 'Finish signing in in your browser.'}
      </p>
      <p className="update-detail max-w-[360px]">
        {login.url ? (
          <a className="no-drag text-accent-text underline-offset-2 hover:underline" href={login.url} target="_blank" rel="noreferrer">
            Open the sign-in page again
          </a>
        ) : (
          'Opening your browser…'
        )}
      </p>
      <form
        className="no-drag mt-4 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          aria-label="Code from the sign-in page"
          placeholder="Paste a code, if the page shows one"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          className="h-[28px] w-[240px] rounded-full bg-fill px-3 text-[13px] text-label outline-none placeholder:text-label-tertiary focus-visible:outline-2 focus-visible:outline-[var(--accent-ring)]"
        />
        <Button ref={first} type="submit" size="text" tone="primary" className="rounded-full px-4" disabled={!code.trim()}>
          Continue
        </Button>
        <Button size="text" tone="secondary" className="rounded-full px-4" onClick={() => void window.gloom?.setup.cancel()}>
          Cancel
        </Button>
      </form>
    </>
  )
}
