// Layout and view state: the sidebar's width, whether it's hidden or slid in as a
// sheet, text size, which library groups are open, search, and what's selected.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SmartFolder } from '@shared/library'
import { computeLayout, SIDEBAR, type ColumnPrefs } from '../features/shell/layout'
import { SHOWN_STEP } from '../features/sidebar/tree'

/** Up to 200%, Apple's floor for "support larger text". */
export const TEXT_SCALES = [0.875, 0.9375, 1, 1.0625, 1.125, 1.25, 1.5, 1.75, 2]

export type { SmartFolder }
export type SortOrder = 'activity' | 'name' | 'created'

/** What's being renamed in place. */
export type Renaming = { kind: 'folder' | 'session'; id: string } | null

interface UiState extends ColumnPrefs {
  textScale: number
  /** Glass even when Windows asks for reduced transparency. */
  glassAlways: boolean
  /** The sidebar slid in as a sheet over the chat, in a window too narrow for it. */
  sheet: boolean
  /** The sidebar was last shown or hidden from the keyboard, so it shouldn't animate. */
  instant: boolean
  /** When that was. A window resize that folds the sidebar away isn't animated. */
  toggledAt: number
  search: string
  sort: SortOrder
  /** Library groups open to show their sessions. Your folders keep theirs in the library. */
  openSmart: SmartFolder[]
  /** The sidebar shows Archived in place of the library. */
  archive: boolean
  /** How many sessions an open group shows, past the first five, by group ('folder:<id>'). Not kept. */
  shown: Record<string, number>
  /** Selected sessions, in the order they were picked. The chat shows one. */
  selection: string[]
  renaming: Renaming
  /** The open session's info card (the chat toolbar's ⓘ, or Ctrl+I). */
  info: boolean

  setSidebarWidth(width: number): void
  /** Inline → hide it; folded away → open or close its sheet; hidden with room → show it. */
  toggleSidebar(viaKeyboard: boolean): void
  /** Brings the sidebar into view (inline if it fits, else as a sheet), for commands that work in it. */
  showSidebar(viaKeyboard: boolean): void
  closeSheet(viaKeyboard: boolean): void
  /** Opens or closes a library group; with no `open`, flips it. */
  toggleSmart(smart: SmartFolder, open?: boolean): void
  setArchive(open: boolean): void
  /** Shows five more of a group's sessions, after the `from` it shows now. */
  showMore(group: string, from: number): void
  /** Groups closed: they start over at five. */
  resetShown(groups: string[]): void
  stepText(direction: 1 | -1): void
  resetText(): void
  toggleGlass(): void
  setSearch(search: string): void
  setSort(sort: SortOrder): void
  select(ids: string[]): void
  rename(renaming: Renaming): void
  setInfo(open: boolean): void
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => {
      const moved = (viaKeyboard: boolean) => ({ instant: viaKeyboard, toggledAt: Date.now() })
      return {
        sidebarWidth: SIDEBAR.initial,
        sidebarHidden: false,
        textScale: 1,
        glassAlways: false,
        sheet: false,
        instant: false,
        toggledAt: 0,
        search: '',
        // Newest first: a session keeps its place while it runs (by last activity it jumped about).
        sort: 'created',
        openSmart: [],
        archive: false,
        shown: {},
        selection: [],
        renaming: null,
        info: false,

        setSidebarWidth: (width) => set({ sidebarWidth: width }),
        toggleSidebar: (viaKeyboard) => {
          const s = get()
          const { sidebarInline, sidebarFits } = computeLayout(window.innerWidth, s)
          if (sidebarInline) set({ sidebarHidden: true, ...moved(viaKeyboard) })
          else if (s.sheet) set({ sheet: false, ...moved(viaKeyboard) })
          else if (s.sidebarHidden && sidebarFits) set({ sidebarHidden: false, ...moved(viaKeyboard) })
          else set({ sheet: true, ...moved(viaKeyboard) })
        },
        showSidebar: (viaKeyboard) => {
          const s = get()
          const { sidebarInline, sidebarFits } = computeLayout(window.innerWidth, s)
          if (sidebarInline || s.sheet) return
          if (s.sidebarHidden && sidebarFits) set({ sidebarHidden: false, ...moved(viaKeyboard) })
          else set({ sheet: true, ...moved(viaKeyboard) })
        },
        closeSheet: (viaKeyboard) => set({ sheet: false, ...moved(viaKeyboard) }),
        toggleSmart: (smart, open) => {
          const current = get().openSmart
          const want = open ?? !current.includes(smart)
          if (want !== current.includes(smart)) set({ openSmart: want ? [...current, smart] : current.filter((s) => s !== smart) })
        },
        setArchive: (open) => set({ archive: open }),
        showMore: (group, from) => set({ shown: { ...get().shown, [group]: from + SHOWN_STEP } }),
        resetShown: (groups) => {
          const shown = { ...get().shown }
          const before = Object.keys(shown).length
          for (const group of groups) delete shown[group]
          if (Object.keys(shown).length !== before) set({ shown })
        },
        stepText: (direction) => {
          const i = TEXT_SCALES.indexOf(get().textScale)
          const next = TEXT_SCALES[Math.min(TEXT_SCALES.length - 1, Math.max(0, (i < 0 ? 2 : i) + direction))]
          set({ textScale: next })
        },
        resetText: () => set({ textScale: 1 }),
        toggleGlass: () => set({ glassAlways: !get().glassAlways }),
        setSearch: (search) => set({ search }),
        setSort: (sort) => set({ sort }),
        select: (ids) => set({ selection: ids }),
        rename: (renaming) => set({ renaming }),
        setInfo: (open) => set({ info: open })
      }
    },
    {
      name: 'gloom.ui',
      version: 4,
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        sidebarHidden: s.sidebarHidden,
        textScale: s.textScale,
        glassAlways: s.glassAlways,
        sort: s.sort,
        openSmart: s.openSmart,
        // The open session comes back after a restart (an update, say).
        selection: s.selection.length === 1 ? s.selection : []
      }),
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>
        if (version < 3) {
          // The folder column and the session list became one sidebar: it keeps
          // the folder column's width (at least the new default) and hidden state.
          const width = typeof state.folderWidth === 'number' ? state.folderWidth : 0
          state.sidebarWidth = Math.min(SIDEBAR.max, Math.max(SIDEBAR.initial, width))
          state.sidebarHidden = state.foldersHidden === true
          for (const key of ['folderWidth', 'sessionWidth', 'foldersHidden', 'sessionsHidden', 'place', 'selected', 'includeSubfolders']) delete state[key]
        }
        // Sorting by last activity reordered the sidebar every time a running
        // session wrote; it moves over to newest first, which holds still.
        if (version < 4 && state.sort === 'activity') state.sort = 'created'
        return state as unknown as UiState
      }
    }
  )
)
