// Syntax highlighting off the main thread: shiki with its JavaScript regex
// engine (no WebAssembly), each language loaded the first time a block needs
// it, and a theme of CSS variables, so light and dark come from the stylesheet
// and switching appearance never highlights again.
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore, type LanguageRegistration } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { HighlightReply, HighlightRequest } from './highlight'
import { resolveLanguage, type LanguageId } from './languages'

type Grammar = () => Promise<{ default: LanguageRegistration[] }>

/** Each language's grammar, as its own chunk; only the worker ever loads them. */
const GRAMMARS: Record<LanguageId, Grammar> = {
  astro: () => import('@shikijs/langs/astro'),
  bat: () => import('@shikijs/langs/bat'),
  c: () => import('@shikijs/langs/c'),
  cmake: () => import('@shikijs/langs/cmake'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  csv: () => import('@shikijs/langs/csv'),
  dart: () => import('@shikijs/langs/dart'),
  diff: () => import('@shikijs/langs/diff'),
  docker: () => import('@shikijs/langs/docker'),
  dotenv: () => import('@shikijs/langs/dotenv'),
  elixir: () => import('@shikijs/langs/elixir'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  haskell: () => import('@shikijs/langs/haskell'),
  hcl: () => import('@shikijs/langs/hcl'),
  html: () => import('@shikijs/langs/html'),
  http: () => import('@shikijs/langs/http'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  jsonl: () => import('@shikijs/langs/jsonl'),
  jsx: () => import('@shikijs/langs/jsx'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  latex: () => import('@shikijs/langs/latex'),
  less: () => import('@shikijs/langs/less'),
  lua: () => import('@shikijs/langs/lua'),
  make: () => import('@shikijs/langs/make'),
  markdown: () => import('@shikijs/langs/markdown'),
  nginx: () => import('@shikijs/langs/nginx'),
  nix: () => import('@shikijs/langs/nix'),
  'objective-c': () => import('@shikijs/langs/objective-c'),
  perl: () => import('@shikijs/langs/perl'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  prisma: () => import('@shikijs/langs/prisma'),
  proto: () => import('@shikijs/langs/proto'),
  python: () => import('@shikijs/langs/python'),
  r: () => import('@shikijs/langs/r'),
  regexp: () => import('@shikijs/langs/regexp'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  sass: () => import('@shikijs/langs/sass'),
  scala: () => import('@shikijs/langs/scala'),
  scss: () => import('@shikijs/langs/scss'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  shellsession: () => import('@shikijs/langs/shellsession'),
  sql: () => import('@shikijs/langs/sql'),
  svelte: () => import('@shikijs/langs/svelte'),
  swift: () => import('@shikijs/langs/swift'),
  terraform: () => import('@shikijs/langs/terraform'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  vue: () => import('@shikijs/langs/vue'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
  zig: () => import('@shikijs/langs/zig')
}

const theme = createCssVariablesTheme({ name: 'gloom', variablePrefix: '--code-', fontStyle: true })

let highlighter: Promise<HighlighterCore> | null = null
const loading = new Map<LanguageId, Promise<void>>()

async function tokens({ code, lang }: HighlightRequest): Promise<HighlightReply['lines']> {
  const id = resolveLanguage(lang)
  if (!id) return null
  const h = await (highlighter ??= createHighlighterCore({ themes: [theme], langs: [], engine: createJavaScriptRegexEngine({ forgiving: true }) }))
  let ready = loading.get(id)
  if (!ready) {
    ready = GRAMMARS[id]().then((m) => h.loadLanguage(m.default))
    loading.set(id, ready)
  }
  await ready
  const result = h.codeToTokens(code, { lang: id, theme: 'gloom' })
  return result.tokens.map((line) => line.map((t) => [t.content, t.color ?? '', t.fontStyle ?? 0] as [string, string, number]))
}

self.onmessage = async ({ data }: MessageEvent<HighlightRequest>) => {
  let lines: HighlightReply['lines'] = null
  try {
    lines = await tokens(data)
  } catch {
    // An unsupported pattern in a grammar: the block stays plain.
  }
  const reply: HighlightReply = { id: data.id, lines }
  self.postMessage(reply)
}
