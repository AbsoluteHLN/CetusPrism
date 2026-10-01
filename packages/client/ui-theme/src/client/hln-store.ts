/**
 * HLN selection row store: mirrors the live HLN selection (theme, fonts,
 * background preset). Unlike the theme preference there is no service event —
 * the only writer is this row's own apply path, which syncs after each
 * successful application; the component reads via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { HLN_DEFAULT_SELECTION, type HlnSelection } from './hln-catalog.ts'

/** Store state: the current selection plus a monotonic change counter. */
export interface HlnRowState extends HlnSelection {
  /** Monotonic change counter (bumped on every applied selection). */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type HlnRowActions = {
  /** Replace the whole selection after a successful apply. */
  set: (draft: HlnRowState, selection: HlnSelection) => void
}

/**
 * Declares the HLN selection row state and write surface.
 * @returns the store handle.
 */
export function createHlnRowStore(): EngineStoreHandle<HlnRowState, HlnRowActions> {
  return defineStore({
    init: (): HlnRowState => ({
      theme: HLN_DEFAULT_SELECTION.theme,
      font: HLN_DEFAULT_SELECTION.font,
      cjk: HLN_DEFAULT_SELECTION.cjk,
      bgMotion: HLN_DEFAULT_SELECTION.bgMotion,
      revision: 0,
    }),
    actions: {
      set: (d, selection: HlnSelection) => {
        d.theme = selection.theme
        d.font = selection.font
        d.cjk = selection.cjk
        d.bgMotion = selection.bgMotion
        d.revision += 1
      },
    },
  })
}
