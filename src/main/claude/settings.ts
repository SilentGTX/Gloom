// Gloom's settings: new sessions' model, mode and effort, how long an idle
// session's process lives, notifications, appearance, and where claude.exe is.
// One JSON file in userData, written whole through a temporary file. The model
// list a session last reported is kept beside them, so New Session can offer
// it before any process has started.
import { app, nativeTheme } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_MODELS, DEFAULT_SETTINGS, EFFORTS, isEffort, isMode, type ModelChoice, type Settings } from '@shared/live'

interface SettingsFile {
  settings: Settings
  models: ModelChoice[]
}

const listeners = new Set<(settings: Settings) => void>()
let file = ''
let current: SettingsFile = { settings: { ...DEFAULT_SETTINGS }, models: DEFAULT_MODELS }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Keeps what's valid of a settings object, defaults for the rest. */
export function cleanSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const s = isRecord(raw) ? raw : {}
  const minutes = typeof s.idleMinutes === 'number' && Number.isFinite(s.idleMinutes) ? Math.round(s.idleMinutes) : base.idleMinutes
  return {
    claudePath: s.claudePath === null || (typeof s.claudePath === 'string' && s.claudePath.length < 1024) ? (s.claudePath as string | null) || null : base.claudePath,
    model: s.model === null || (typeof s.model === 'string' && s.model.length < 200) ? (s.model as string | null) || null : base.model,
    mode: isMode(s.mode) ? s.mode : base.mode,
    effort: s.effort === null || isEffort(s.effort) ? (s.effort as Settings['effort']) : base.effort,
    idleMinutes: Math.max(0, Math.min(24 * 60, minutes)),
    notifications: typeof s.notifications === 'boolean' ? s.notifications : base.notifications,
    theme: s.theme === 'light' || s.theme === 'dark' || s.theme === 'system' ? s.theme : base.theme
  }
}

function cleanModels(raw: unknown): ModelChoice[] {
  if (!Array.isArray(raw)) return DEFAULT_MODELS
  const models = raw.filter(isRecord).flatMap((m): ModelChoice[] =>
    typeof m.value === 'string' && typeof m.label === 'string'
      ? [{ value: m.value, label: m.label, description: typeof m.description === 'string' ? m.description : '', efforts: Array.isArray(m.efforts) ? m.efforts.filter(isEffort) : [...EFFORTS] }]
      : []
  )
  return models.length ? models : DEFAULT_MODELS
}

export function loadSettings(): void {
  file = join(app.getPath('userData'), 'settings.json')
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      current = { settings: cleanSettings(raw.settings), models: cleanModels(raw.models) }
    }
  } catch {
    // Unreadable: the defaults, and the next change writes a good file.
  }
  nativeTheme.themeSource = current.settings.theme
}

function save(): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file + '.tmp', JSON.stringify(current, null, 1))
    renameSync(file + '.tmp', file)
  } catch (error) {
    console.error('Gloom: couldn’t save settings:', error)
  }
}

export function settings(): Settings {
  return current.settings
}

/** Changes some settings; the rest stay. Returns them all. */
export function updateSettings(patch: unknown): Settings {
  const next = cleanSettings({ ...current.settings, ...(isRecord(patch) ? patch : {}) }, current.settings)
  current = { ...current, settings: next }
  nativeTheme.themeSource = next.theme
  save()
  for (const listener of listeners) listener(next)
  return next
}

export function onSettings(listener: (settings: Settings) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function knownModels(): ModelChoice[] {
  return current.models
}

/** What a session reported; kept for the next New Session. */
export function rememberModels(models: ModelChoice[]): void {
  if (!models.length || JSON.stringify(models) === JSON.stringify(current.models)) return
  current = { ...current, models }
  save()
}
