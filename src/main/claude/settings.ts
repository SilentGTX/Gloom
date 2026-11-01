// Gloom's settings: what new sessions start with (model, mode, effort, output
// style, prompt suggestions, Remote Control), how long an idle session's
// process lives and when an inactive one is archived, keeping the computer
// awake, worktrees, notifications, appearance, the terminal's shell, and where
// claude.exe is.
// One JSON file in userData, written whole through a temporary file. The model
// list a session last reported is kept beside them, so New Session can offer
// it before any process has started.
import { app, nativeTheme } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { branchPrefixProblem, DEFAULT_MODELS, DEFAULT_SETTINGS, EFFORTS, isEffort, isMode, isPetKind, isTranscriptView, type ModelChoice, type NoticeLevel, type Settings } from '@shared/live'
import { isShell } from '@shared/terminal'

interface SettingsFile {
  settings: Settings
  models: ModelChoice[]
  /** The CLI version the list came from: another version (an update) is asked again. */
  modelsFrom?: string | null
}

const listeners = new Set<(settings: Settings) => void>()
let file = ''
let current: SettingsFile = { settings: { ...DEFAULT_SETTINGS }, models: DEFAULT_MODELS }

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const isLevel = (v: unknown): v is NoticeLevel => v === 'banner' || v === 'badge' || v === 'off'
const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)

/** Keeps what's valid of a settings object, defaults for the rest. */
export function cleanSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const s = isRecord(raw) ? raw : {}
  const minutes = typeof s.idleMinutes === 'number' && Number.isFinite(s.idleMinutes) ? Math.round(s.idleMinutes) : base.idleMinutes
  const days = typeof s.archiveAfterDays === 'number' && Number.isFinite(s.archiveAfterDays) ? Math.round(s.archiveAfterDays) : base.archiveAfterDays
  // Gloom before 0.14 had one switch for every notification: off turns each kind off.
  const quiet = s.notifications === false && s.notifyPermission === undefined
  const hosts = Array.isArray(s.sshHosts)
    ? s.sshHosts.flatMap((h): Settings['sshHosts'] => {
        if (!isRecord(h) || typeof h.id !== 'string' || typeof h.host !== 'string' || !/^[\w.@-]+$/.test(h.host) || h.host.startsWith('-')) return []
        return [{ id: h.id.slice(0, 64), name: typeof h.name === 'string' && h.name.trim() ? h.name.trim().slice(0, 60) : h.host, host: h.host, claude: typeof h.claude === 'string' && h.claude.trim() ? h.claude.trim().slice(0, 500) : null }]
      })
    : base.sshHosts
  return {
    sshHosts: hosts.slice(0, 50),
    claudePath: s.claudePath === null || (typeof s.claudePath === 'string' && s.claudePath.length < 1024) ? (s.claudePath as string | null) || null : base.claudePath,
    model: s.model === null || (typeof s.model === 'string' && s.model.length < 200) ? (s.model as string | null) || null : base.model,
    mode: isMode(s.mode) ? s.mode : base.mode,
    effort: s.effort === null || isEffort(s.effort) ? (s.effort as Settings['effort']) : base.effort,
    outputStyle: s.outputStyle === null || (typeof s.outputStyle === 'string' && s.outputStyle.length > 0 && s.outputStyle.length < 200) ? (s.outputStyle as string | null) : base.outputStyle,
    promptSuggestions: flag(s.promptSuggestions, base.promptSuggestions),
    remoteControl: flag(s.remoteControl, base.remoteControl),
    transcriptView: isTranscriptView(s.transcriptView) ? s.transcriptView : base.transcriptView,
    idleMinutes: Math.max(0, Math.min(24 * 60, minutes)),
    archiveAfterDays: Math.max(0, Math.min(365, days)),
    archiveOnPrClose: flag(s.archiveOnPrClose, base.archiveOnPrClose),
    keepAwake: flag(s.keepAwake, base.keepAwake),
    keepAwakeOnBattery: flag(s.keepAwakeOnBattery, base.keepAwakeOnBattery),
    branchPrefix: typeof s.branchPrefix === 'string' && !branchPrefixProblem(s.branchPrefix) ? s.branchPrefix : base.branchPrefix,
    worktreeFolder: s.worktreeFolder === null || (typeof s.worktreeFolder === 'string' && isAbsolute(s.worktreeFolder) && s.worktreeFolder.length < 1024) ? (s.worktreeFolder as string | null) : base.worktreeFolder,
    notifyPermission: quiet ? 'off' : isLevel(s.notifyPermission) ? s.notifyPermission : base.notifyPermission,
    notifyQuestion: quiet ? 'off' : isLevel(s.notifyQuestion) ? s.notifyQuestion : base.notifyQuestion,
    notifyFinished: quiet ? 'off' : s.notifyFinished === 'banner' || s.notifyFinished === 'off' ? s.notifyFinished : base.notifyFinished,
    notifySound: flag(s.notifySound, base.notifySound),
    flashTaskbar: flag(s.flashTaskbar, base.flashTaskbar),
    theme: s.theme === 'light' || s.theme === 'dark' || s.theme === 'system' ? s.theme : base.theme,
    shell: isShell(s.shell) ? s.shell : base.shell,
    pet: typeof s.pet === 'boolean' ? s.pet : base.pet,
    petKind: isPetKind(s.petKind) ? s.petKind : base.petKind
  }
}

function cleanModels(raw: unknown): ModelChoice[] {
  if (!Array.isArray(raw)) return DEFAULT_MODELS
  const models = raw.filter(isRecord).flatMap((m): ModelChoice[] =>
    typeof m.value === 'string' && typeof m.label === 'string'
      ? [
          {
            value: m.value,
            label: m.label,
            description: typeof m.description === 'string' ? m.description : '',
            efforts: Array.isArray(m.efforts) ? m.efforts.filter(isEffort) : [...EFFORTS],
            ...(m.fast === true ? { fast: true } : {})
          }
        ]
      : []
  )
  return models.length ? models : DEFAULT_MODELS
}

export function loadSettings(): void {
  file = join(app.getPath('userData'), 'settings.json')
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      current = { settings: cleanSettings(raw.settings), models: cleanModels(raw.models), modelsFrom: typeof raw.modelsFrom === 'string' ? raw.modelsFrom : null }
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

/** The CLI version the kept list came from (null before Gloom 0.13.2 kept it). */
export function modelsFrom(): string | null {
  return current.modelsFrom ?? null
}

/** Whether the list was learned from a CLI (else it's Gloom's own, until the first session). */
export function learnedModels(): boolean {
  return current.models !== DEFAULT_MODELS
}

/** What a session (or the CLI, asked at launch) reported, and which CLI said it; kept for the next New Session. */
export function rememberModels(models: ModelChoice[], version: string | null = null): void {
  const from = version ?? current.modelsFrom ?? null
  if (!models.length || (JSON.stringify(models) === JSON.stringify(current.models) && from === current.modelsFrom)) return
  current = { ...current, models, modelsFrom: from }
  save()
}
