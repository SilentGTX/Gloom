import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from './Button'

interface Props {
  /** The part of the window it guards, as its fallback names it ("Chat", "Sidebar"); none for the whole window. */
  part?: string
  /** Changing it (another session opened, say) clears the problem and draws the part again. */
  resetKey?: unknown
  children: ReactNode
}

/**
 * Keeps a bug in one part of the window from taking the rest with it. React
 * unmounts everything up to the nearest boundary when drawing throws, and with
 * none that was the whole window: blank but for the caption buttons. Here the
 * part that broke says so and draws again on request, and the rest carries on.
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null }
  private componentStack = ''

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.componentStack = info.componentStack ?? ''
    console.error(`Gloom: ${this.props.part ? `the ${this.props.part.toLowerCase()}` : 'the window'} couldn’t be drawn`, error)
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return <Problem part={this.props.part} error={error} details={() => this.componentStack} onRetry={() => this.setState({ error: null })} />
  }
}

function Problem({ part, error, details, onRetry }: { part?: string; error: Error; details(): string; onRetry(): void }) {
  const [copied, setCopied] = useState(false)
  const primary = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Focus was on what broke (a menu item, say) and went with it: it lands here. Focus anywhere else stays put.
    if (!document.activeElement || document.activeElement === document.body) primary.current?.focus()
  }, [])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    const info = await window.gloom?.getAppInfo().catch(() => null)
    const where = part ? `the ${part.toLowerCase()}` : 'the window'
    const text = [`Gloom ${info?.version ?? ''}: ${where} couldn’t be drawn.`, error.stack || error.message, details().trim()].filter(Boolean).join('\n\n')
    await navigator.clipboard.writeText(text)
    setCopied(true)
  }

  return (
    <div className={part ? 'flex h-full min-h-0 flex-1 flex-col overflow-auto' : 'paper flex h-full flex-col overflow-auto'}>
      {/* The whole window's title line, so it can still be moved. */}
      {!part && <div className="drag h-[var(--titlebar-h)] shrink-0" />}
      <div className="m-auto flex max-w-80 flex-col items-center gap-1.5 px-8 py-6 text-center">
        <TriangleAlert size={32} strokeWidth={1.25} aria-hidden className="mb-2 text-label-quaternary" />
        <div role="alert" className="flex flex-col gap-1.5">
          <p className="font-display text-headline font-semibold text-label-secondary">{part ? `The ${part} Couldn’t Be Shown` : 'Gloom Ran Into a Problem'}</p>
          <p className="text-footnote text-balance text-label-secondary">
            {part ? 'Try again, or reload the window (Ctrl+R) if it keeps happening.' : 'Reload the window to carry on. Sessions that are running keep going.'}
          </p>
        </div>
        <p className="mt-1 line-clamp-3 font-mono text-[11px] break-words text-label-secondary select-text">{error.message}</p>
        <div className="mt-3 flex gap-2">
          {/* Reloading drops ?handover: that handover ended long ago. */}
          <Button ref={primary} size="text" tone="secondary" onClick={part ? onRetry : () => location.replace(location.pathname)}>
            {part ? 'Try Again' : 'Reload Window'}
          </Button>
          <Button size="text" tone="secondary" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy Details'}
          </Button>
        </div>
      </div>
    </div>
  )
}
