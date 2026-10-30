// Layout state: column widths, what's hidden, the overlay sheet, text size.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { computeLayout, FOLDERS, SESSIONS, type ColumnPrefs } from '../features/shell/layout'

/** Up to 200%, Apple's floor for "support larger text". */
export const TEXT_SCALES = [0.875, 0.9375, 1, 1.0625, 1.125, 1.25, 1.5, 1.75, 2]

export type SmartFolder = 'all' | 'recent' | 'pinned' | 'unfiled' | 'archived'
export type Overlay = 'folders' | 'sessions' | null

interface UiState extends ColumnPrefs {
  textScale: number
  /** Glass even when Windows asks for reduced transparency. */
  glassAlways: boolean
  selected: SmartFolder
  overlay: Overlay
  /** The overlay opened or closed from the keyboard, so it shouldn't animate. */
  overlayInstant: boolean

  setFolderWidth(width: number): void
  setSessionWidth(width: number): void
  select(folder: SmartFolder): void
  toggleFolders(viaKeyboard: boolean): void
  toggleSessions(viaKeyboard: boolean): void
  closeOverlay(viaKeyboard: boolean): void
  stepText(direction: 1 | -1): void
  resetText(): void
  toggleGlass(): void
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
        selected: 'all',
        overlay: null,
        overlayInstant: false,

        setFolderWidth: (width) => set({ folderWidth: width }),
        setSessionWidth: (width) => set({ sessionWidth: width }),
        select: (folder) => set({ selected: folder }),
        toggleFolders: (viaKeyboard) => toggle('folders', viaKeyboard),
        toggleSessions: (viaKeyboard) => toggle('sessions', viaKeyboard),
        closeOverlay: (viaKeyboard) => set({ overlay: null, overlayInstant: viaKeyboard }),
        stepText: (direction) => {
          const i = TEXT_SCALES.indexOf(get().textScale)
          const next = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, (i < 0 ? 2 : i) + direction))]
          set({ textScale: next })
        },
        resetText: () => set({ textScale: 1 }),
        toggleGlass: () => set({ glassAlways: !get().glassAlways })
      }
    },
    {
      name: 'gloom.ui',
      version: 1,
      partialize: (s) => ({
        folderWidth: s.folderWidth,
        sessionWidth: s.sessionWidth,
        foldersHidden: s.foldersHidden,
        sessionsHidden: s.sessionsHidden,
        textScale: s.textScale,
        glassAlways: s.glassAlways,
        selected: s.selected
      })
    }
  )
)
