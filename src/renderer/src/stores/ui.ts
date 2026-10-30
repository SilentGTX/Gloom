// Layout and view state: column widths, what's hidden, the overlay sheet, text
// size, where the session list is looking, and what's selected.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Place, SmartFolder } from '@shared/library'
import { computeLayout, FOLDERS, SESSIONS, type ColumnPrefs } from '../features/shell/layout'

/** Up to 200%, Apple's floor for "support larger text". */
export const TEXT_SCALES = [0.875, 0.9375, 1, 1.0625, 1.125, 1.25, 1.5, 1.75, 2]

export type { SmartFolder }
export type Overlay = 'folders' | 'sessions' | null
export type SortOrder = 'activity' | 'name' | 'created'

/** What's being renamed in place. */
export type Renaming = { kind: 'folder' | 'session'; id: string } | null

interface UiState extends ColumnPrefs {
  textScale: number
  /** Glass even when Windows asks for reduced transparency. */
  glassAlways: boolean
  place: Place
  overlay: Overlay
  /** The overlay opened or closed from the keyboard, so it shouldn't animate. */
  overlayInstant: boolean
  search: string
  sort: SortOrder
  /** A folder's list shows the sessions in its subfolders too. */
  includeSubfolders: boolean
  /** Selected sessions, in the order they were picked. */
  selection: string[]
  /** Where Shift extends a selection from. */
  anchor: string | null
  renaming: Renaming

  setFolderWidth(width: number): void
  setSessionWidth(width: number): void
  /** Show a smart folder or one of yours. Clears the search. */
  go(place: Place): void
  toggleFolders(viaKeyboard: boolean): void
  toggleSessions(viaKeyboard: boolean): void
  /** Brings the folders into view (inline if they fit, else as a sheet), for commands that work in them. */
  showFolders(viaKeyboard: boolean): void
  closeOverlay(viaKeyboard: boolean): void
  stepText(direction: 1 | -1): void
  resetText(): void
  toggleGlass(): void
  setSearch(search: string): void
  setSort(sort: SortOrder): void
  toggleSubfolders(): void
  select(ids: string[], anchor?: string | null): void
  rename(renaming: Renaming): void
}

export function samePlace(a: Place, b: Place): boolean {
  return 'smart' in a ? 'smart' in b && a.smart === b.smart : 'folder' in b && a.folder === b.folder
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => {
      /** Inline column → hide it; collapsed → open or close its sheet; hidden with room → show it. */
      const toggle = (column: 'folders' | 'sessions', viaKeyboard: boolean) => {
        const s = get()
        const layout = computeLayout(window.innerWidth, s)
        const inline = column === 'folders' ? layout.foldersInline : layout.sessionsInline
        const fits = column === 'folders' ? layout.foldersFit : layout.sessionsFit
        const hiddenKey = column === 'folders' ? 'foldersHidden' : 'sessionsHidden'
        if (inline) set({ [hiddenKey]: true })
        else if (s.overlay === column) set({ overlay: null, overlayInstant: viaKeyboard })
        else if (s[hiddenKey] && fits) set({ [hiddenKey]: false })
        else set({ overlay: column, overlayInstant: viaKeyboard })
      }
      return {
        folderWidth: FOLDERS.initial,
        sessionWidth: SESSIONS.initial,
        foldersHidden: false,
        sessionsHidden: false,
        textScale: 1,
        glassAlways: false,
        place: { smart: 'all' },
        overlay: null,
        overlayInstant: false,
        search: '',
        sort: 'activity',
        includeSubfolders: false,
        selection: [],
        anchor: null,
        renaming: null,

        setFolderWidth: (width) => set({ folderWidth: width }),
        setSessionWidth: (width) => set({ sessionWidth: width }),
        go: (place) => set(samePlace(place, get().place) && !get().search ? {} : { place, search: '' }),
        toggleFolders: (viaKeyboard) => toggle('folders', viaKeyboard),
        toggleSessions: (viaKeyboard) => toggle('sessions', viaKeyboard),
        showFolders: (viaKeyboard) => {
          const s = get()
          const layout = computeLayout(window.innerWidth, s)
          if (layout.foldersInline || s.overlay === 'folders') return
          if (s.foldersHidden && layout.foldersFit) set({ foldersHidden: false })
          else set({ overlay: 'folders', overlayInstant: viaKeyboard })
        },
        closeOverlay: (viaKeyboard) => set({ overlay: null, overlayInstant: viaKeyboard }),
        stepText: (direction) => {
          const i = TEXT_SCALES.indexOf(get().textScale)
          const next = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, (i < 0 ? 2 : i) + direction))]
          set({ textScale: next })
        },
        resetText: () => set({ textScale: 1 }),
        toggleGlass: () => set({ glassAlways: !get().glassAlways }),
        setSearch: (search) => set({ search }),
        setSort: (sort) => set({ sort }),
        toggleSubfolders: () => set({ includeSubfolders: !get().includeSubfolders }),
        select: (ids, anchor) => set({ selection: ids, anchor: anchor === undefined ? (ids.at(-1) ?? null) : anchor }),
        rename: (renaming) => set({ renaming })
      }
    },
    {
      name: 'gloom.ui',
      version: 2,
      partialize: (s) => ({
        folderWidth: s.folderWidth,
        sessionWidth: s.sessionWidth,
        foldersHidden: s.foldersHidden,
        sessionsHidden: s.sessionsHidden,
        textScale: s.textScale,
        glassAlways: s.glassAlways,
        place: s.place,
        sort: s.sort,
        includeSubfolders: s.includeSubfolders,
        // The open session comes back after a restart (an update, say).
        selection: s.selection.length === 1 ? s.selection : []
      }),
      // Version 1 kept the smart folder as `selected`.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>
        if (version < 2 && typeof state.selected === 'string') {
          state.place = { smart: state.selected }
          delete state.selected
        }
        return state as unknown as UiState
      }
    }
  )
)
