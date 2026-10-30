// The update window's page: Gloom's icon, its sparkles alive while it works,
// and what it's doing, from the states main sends.
import './splash.css'
import { iconSvg } from '@shared/icon-art'
import type { SplashState } from '@shared/ipc'

const root = document.getElementById('splash')!
const status = document.getElementById('status')!
const detail = document.getElementById('detail')!
document.getElementById('icon')!.innerHTML = iconSvg({ size: 96, detail: 'full', id: 'splash' })
const version = new URLSearchParams(location.search).get('version')
document.getElementById('version')!.textContent = version ? `Version ${version}` : ''

const mb = (bytes: number) => Math.round(bytes / 1e6)

/** The status line and the small line under the bar. */
function words(state: SplashState): [string, string] {
  switch (state.status) {
    case 'checking':
      return ['Checking for updates…', '']
    case 'downloading':
      return [`Downloading Gloom ${state.version}…`, `${mb(state.received)} MB of ${mb(state.total)} MB`]
    case 'installing':
      return [`Installing Gloom ${state.version}…`, 'Gloom reopens when it’s done']
    case 'failed':
      return ['Couldn’t update Gloom', `Starting Gloom in ${state.seconds}…`]
    case 'launching':
      return ['Starting Gloom…', '']
  }
}

function render(state: SplashState) {
  root.dataset.status = state.status
  root.toggleAttribute('data-busy', state.status === 'checking' || state.status === 'downloading' || state.status === 'installing')
  if (state.status === 'downloading') root.style.setProperty('--progress', String(state.total ? state.received / state.total : 0))
  ;[status.textContent, detail.textContent] = words(state)
}

window.gloom?.onSplashState(render)
