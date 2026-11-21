/**
 * The IDE's column geometry: the editor's share comes first.
 *
 * The workbench exists for the code, so the side columns may not eat it. A
 * frame too narrow for all three gives the tree up first — it is the column
 * the user can open again with one click — and the assistant folds to its
 * rail before the code does.
 *
 * The numbers are a pure function of the frame's width and the remembered
 * preferences, so the geometry is testable without a browser.
 *
 * @module @deepseek-ai/dsh-client-ui-ide/ide-columns
 */

/** The remembered layout: the two column widths and the two folded columns. */
export interface IdeLayout {
  /** The tree column's preferred width. */
  readonly filesWidth: number
  /** The assistant column's preferred width. */
  readonly assistantWidth: number
  /** Whether the tree is folded to its rail. */
  readonly filesCollapsed: boolean
  /** Whether the assistant is folded to its rail. */
  readonly assistantCollapsed: boolean
}

/** The columns as the frame renders them. */
export interface IdeColumns {
  /** The tree column's rendered width. */
  readonly filesWidth: number
  /** The assistant column's rendered width. */
  readonly assistantWidth: number
  /** Whether the tree is folded to its rail. */
  readonly filesCollapsed: boolean
  /** Whether the assistant is folded to its rail. */
  readonly assistantCollapsed: boolean
}

/** A folded column's width: the icon rail. */
export const RAIL = 44
/** The width the code column keeps before a side column gives way. */
export const EDITOR_MIN = 320
/** The two separators between the three columns. */
export const SEAMS = 2
/** The tree column's narrowest width. */
export const FILES_MIN = 200
/** The tree column's widest width. */
export const FILES_MAX = 460
/** The assistant column's narrowest width. */
export const ASSISTANT_MIN = 320
/** The assistant column's widest width. */
export const ASSISTANT_MAX = 720
/** The share of the frame the tree column may take. */
export const FILES_RATIO = 0.3
/** The share of the frame the assistant column may take. */
export const ASSISTANT_RATIO = 0.4

/**
 * Solve the three columns for one frame.
 *
 * The stored widths are preferences, not promises: each side column is capped
 * by its share of the frame, and the code column keeps its minimum while any
 * side column can still give way.
 * @param container - the frame's width in px; 0 before the first measurement.
 * @param layout - the remembered preferences.
 * @returns the columns as the frame renders them.
 */
export function resolveIdeColumns(container: number, layout: IdeLayout): IdeColumns {
  if (container <= 0) {
    return {
      filesWidth: layout.filesCollapsed ? RAIL : layout.filesWidth,
      assistantWidth: layout.assistantCollapsed ? RAIL : layout.assistantWidth,
      filesCollapsed: layout.filesCollapsed,
      assistantCollapsed: layout.assistantCollapsed,
    }
  }
  const filesCap = Math.max(RAIL, Math.min(FILES_MAX, Math.round(container * FILES_RATIO)))
  const assistantCap = Math.max(RAIL, Math.min(ASSISTANT_MAX, Math.round(container * ASSISTANT_RATIO)))
  let files = layout.filesCollapsed
    ? RAIL
    : Math.min(Math.max(layout.filesWidth, FILES_MIN), filesCap)
  let assistant = layout.assistantCollapsed
    ? RAIL
    : Math.min(Math.max(layout.assistantWidth, ASSISTANT_MIN), assistantCap)
  // The code column keeps its minimum: the tree gives way first, the
  // assistant second, and the code never. The two seams are part of the
  // frame's chrome, so they are taken off the code column's share first.
  let overflow = files + assistant - (container - EDITOR_MIN - SEAMS)
  if (overflow > 0) {
    const given = Math.min(files - RAIL, overflow)
    files -= given
    overflow -= given
  }
  if (overflow > 0) {
    const given = Math.min(assistant - RAIL, overflow)
    assistant -= given
  }
  return {
    filesWidth: files,
    assistantWidth: assistant,
    // A column squeezed to its rail IS folded: the toggle follows the width.
    filesCollapsed: layout.filesCollapsed || files <= RAIL,
    assistantCollapsed: layout.assistantCollapsed || assistant <= RAIL,
  }
}
