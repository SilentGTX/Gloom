import { Fragment, memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../../lib/cn'
import { useHighlight } from './highlight'
import { languageLabel } from './languages'
import { CopyButton } from './media'

interface HastNode {
  type: string
  value?: string
  tagName?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

function textOf(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

/**
 * Model output is untrusted: no raw HTML (react-markdown escapes it), links
 * open in your browser (the main process only lets http(s) out), and images
 * from the web show as links, since the window loads nothing remote.
 */
const components: Components = {
  pre: ({ node }) => {
    const code = (node as HastNode | undefined)?.children?.find((c) => c.tagName === 'code')
    const classes = Array.isArray(code?.properties?.className) ? (code.properties.className as string[]) : []
    const lang = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length)
    return <CodeBlock code={textOf(code).replace(/\n$/, '')} lang={lang} />
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" title={href}>
      {children}
    </a>
  ),
  img: ({ src, alt }) =>
    typeof src === 'string' && /^https?:/i.test(src) ? (
      <a href={src} target="_blank" rel="noreferrer">
        {alt || src}
      </a>
    ) : (
      <span>{alt}</span>
    ),
  table: ({ children }) => (
    <div className="table-scroll">
      <table>{children}</table>
    </div>
  )
}

const plugins = [remarkGfm]

/** Claude's words, as markdown. */
export const Markdown = memo(function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn('prose-gloom', className)}>
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

/**
 * A code block: its language and a Copy button above, the code highlighted off
 * the main thread. It shows plain until the colours arrive, in the same face,
 * so nothing moves when they do.
 */
export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const lines = useHighlight(code, lang)
  return (
    <div className={cn('code-card group/code relative', className)}>
      <div className="flex h-8 items-center justify-between gap-2 pr-1.5 pl-3">
        <span className="truncate text-caption font-medium text-label-secondary">{lang ? languageLabel(lang) : 'Code'}</span>
        <CopyButton text={code} label="Copy Code" />
      </div>
      <pre className="code-text overflow-x-auto px-3 pb-3">
        <code>
          {lines
            ? lines.map((line, i) => (
                <Fragment key={i}>
                  {line.map(([content, color, style], j) => (
                    <span
                      key={j}
                      style={{ color: color || undefined, fontStyle: style & 1 ? 'italic' : undefined, fontWeight: style & 2 ? 600 : undefined }}
                    >
                      {content}
                    </span>
                  ))}
                  {i < lines.length - 1 ? '\n' : null}
                </Fragment>
              ))
            : code}
        </code>
      </pre>
    </div>
  )
}
