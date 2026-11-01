import './styles/app.css'
import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { UpdateScreenAlone } from './features/update/UpdateScreen'
import { installOverflowTitles } from './lib/overflow-title'
import { takeMovedStorage } from './lib/storage'
import { loadUpdateScreen } from './lib/update'

const root = createRoot(document.getElementById('root')!)
const params = new URLSearchParams(location.search)

// The pet's own window, on top of every app (main/pet.ts): only the pet. It has
// no update screen and keeps nothing in storage, so it starts straight away.
if (params.has('pet')) {
  const { PetWindow } = await import('./features/pet/PetWindow')
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <PetWindow />
      </ErrorBoundary>
    </StrictMode>
  )
} else {
  await startApp()
}

async function startApp() {
  installOverflowTitles()

  // The update screen can be up as the window opens (the launch check), so the
  // first render waits to know: the window's first frame is then already the screen.
  await loadUpdateScreen()

  // Taking over from the previous version's window (handover.ts): the update
  // screen alone until that version has quit, because the app's settings live
  // in storage it still holds. Then the app loads under the screen.
  const handover = params.has('handover')
  if (handover) {
    root.render(
      <StrictMode>
        <UpdateScreenAlone />
      </StrictMode>
    )
    await window.gloom?.handoverWait()
  }
  // The settings kept under file:// move over the first time, before a store reads them.
  await takeMovedStorage()
  // A pane popped out into a window of its own shows only that pane.
  const popOut = params.get('popout')
  const popOutSession = params.get('session')
  if (popOut && popOutSession) {
    const { PopOut } = await import('./PopOut')
    flushSync(() =>
      root.render(
        <StrictMode>
          <ErrorBoundary>
            <PopOut pane={popOut} sessionId={popOutSession} />
          </ErrorBoundary>
        </StrictMode>
      )
    )
  } else {
    const { App } = await import('./App')
    flushSync(() =>
      root.render(
        <StrictMode>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </StrictMode>
      )
    )
  }
  // Painted: the screen can go.
  if (handover) requestAnimationFrame(() => requestAnimationFrame(() => void window.gloom?.handoverDone()))
}
