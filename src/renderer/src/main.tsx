import './styles/app.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { loadUpdateScreen } from './lib/update'

// The update screen can be up as the window opens (the launch check), so the
// first render waits to know: the window's first frame is then already dark.
await loadUpdateScreen()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
