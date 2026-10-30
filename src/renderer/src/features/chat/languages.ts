// The languages code blocks are highlighted in. A curated set keeps the build
// lean; anything else shows as plain monospaced text. The highlighting worker
// loads each grammar the first time a block needs it.

export const LANGUAGES = [
  'astro',
  'bat',
  'c',
  'cmake',
  'cpp',
  'csharp',
  'css',
  'csv',
  'dart',
  'diff',
  'docker',
  'dotenv',
  'elixir',
  'go',
  'graphql',
  'haskell',
  'hcl',
  'html',
  'http',
  'ini',
  'java',
  'javascript',
  'json',
  'jsonc',
  'jsonl',
  'jsx',
  'kotlin',
  'latex',
  'less',
  'lua',
  'make',
  'markdown',
  'nginx',
  'nix',
  'objective-c',
  'perl',
  'php',
  'powershell',
  'prisma',
  'proto',
  'python',
  'r',
  'regexp',
  'ruby',
  'rust',
  'sass',
  'scala',
  'scss',
  'shellscript',
  'shellsession',
  'sql',
  'svelte',
  'swift',
  'terraform',
  'toml',
  'tsx',
  'typescript',
  'vue',
  'xml',
  'yaml',
  'zig'
] as const

export type LanguageId = (typeof LANGUAGES)[number]

const KNOWN = new Set<string>(LANGUAGES)

const ALIASES: Record<string, string> = {
  bash: 'shellscript',
  batch: 'bat',
  'c#': 'csharp',
  'c++': 'cpp',
  cjs: 'javascript',
  cmd: 'bat',
  console: 'shellsession',
  cs: 'csharp',
  cts: 'typescript',
  dockerfile: 'docker',
  env: 'dotenv',
  gql: 'graphql',
  golang: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  js: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  makefile: 'make',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  objc: 'objective-c',
  patch: 'diff',
  properties: 'ini',
  protobuf: 'proto',
  ps: 'powershell',
  ps1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  rb: 'ruby',
  regex: 'regexp',
  rs: 'rust',
  sh: 'shellscript',
  shell: 'shellscript',
  svg: 'xml',
  tf: 'terraform',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'shellscript'
}

/** The language a code fence's name means, if Gloom highlights it. */
export function resolveLanguage(lang: string): LanguageId | null {
  const name = lang.trim().toLowerCase()
  const id = KNOWN.has(name) ? name : ALIASES[name]
  return id && KNOWN.has(id) ? (id as LanguageId) : null
}

/** The name shown on a code block: "TypeScript", "Shell". */
const LABELS: Record<string, string> = {
  bat: 'Batch',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  docker: 'Dockerfile',
  graphql: 'GraphQL',
  html: 'HTML',
  javascript: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSON',
  jsx: 'JSX',
  'objective-c': 'Objective-C',
  php: 'PHP',
  powershell: 'PowerShell',
  shellscript: 'Shell',
  shellsession: 'Console',
  sql: 'SQL',
  toml: 'TOML',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML'
}

export function languageLabel(lang: string): string {
  const id = resolveLanguage(lang)
  if (id) return LABELS[id] ?? id[0].toUpperCase() + id.slice(1)
  return lang.trim()
}
