import './styles/app.css'
import { StrictMode } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { UpdateScreenAlone } from './features/update/UpdateScreen'
import { installOverflowTitles } from './lib/overflow-title'
import { loadUpdateScreen } from './lib/update'

installOverflowTitles()

// The update screen can be up as the window opens (the launch check), so the
// first render waits to know: the window's first frame is then already the screen.
await loadUpdateScreen()
const root = createRoot(document.getElementById('root')!)

// Taking over from the previous version's window (handover.ts): the update
// screen alone until that version has quit, because the app's settings live
// in storage it still holds. Then the app loads under the screen.
const handover = new URLSearchParams(location.search).has('handover')
if (handover) {
  root.render(
    <StrictMode>
      <UpdateScreenAlone />
    </StrictMode>
  )
  await window.gloom?.handoverWait()
}
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
// Painted: the screen can go.
if (handover) requestAnimationFrame(() => requestAnimationFrame(() => void window.gloom?.handoverDone()))
