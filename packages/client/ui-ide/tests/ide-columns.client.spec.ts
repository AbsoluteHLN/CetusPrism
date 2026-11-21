/**
 * The IDE's column geometry: the editor's share comes first.
 *
 * The workbench exists for the code, so the side columns may not eat it. The
 * geometry is a pure function of the frame's width and the remembered
 * preferences, so it is checked here without a browser.
 */
import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_MAX, ASSISTANT_MIN, EDITOR_MIN, FILES_MAX, FILES_MIN, RAIL, SEAMS,
  resolveIdeColumns, type IdeLayout,
} from '../src/client/ide-columns.ts'

const layout: IdeLayout = {
  filesWidth: 260,
  assistantWidth: 420,
  filesCollapsed: false,
  assistantCollapsed: false,
}

describe('the IDE column geometry', () => {
  it('keeps the remembered widths before the frame is measured', () => {
    expect(resolveIdeColumns(0, layout)).toMatchObject({
      filesWidth: 260,
      assistantWidth: 420,
    })
  })

  it('keeps the remembered widths while the frame has room', () => {
    expect(resolveIdeColumns(1400, layout)).toMatchObject({
      filesWidth: 260,
      assistantWidth: 420,
    })
  })

  it('caps each side column by its share of the frame', () => {
    const columns = resolveIdeColumns(3000, { ...layout, filesWidth: 460, assistantWidth: 720 })
    expect(columns.filesWidth).toBe(FILES_MAX)
    expect(columns.assistantWidth).toBe(ASSISTANT_MAX)
  })

  it('never lets the side columns eat the code column', () => {
    for (const container of [600, 800, 1000, 1400, 2000]) {
      const columns = resolveIdeColumns(container, layout)
      const editor = container - columns.filesWidth - columns.assistantWidth - SEAMS
      expect(editor).toBeGreaterThanOrEqual(EDITOR_MIN)
    }
  })

  it('gives the tree up before the assistant does', () => {
    const wide = resolveIdeColumns(1000, layout)
    const narrow = resolveIdeColumns(760, layout)
    // The narrow frame takes its space from the tree first: the tree gives up
    // more of its width than the assistant does.
    expect(wide.filesWidth - narrow.filesWidth)
      .toBeGreaterThanOrEqual(wide.assistantWidth - narrow.assistantWidth)
    expect(narrow.assistantWidth).toBeGreaterThanOrEqual(ASSISTANT_MIN - FILES_MIN)
  })

  it('folds a column that was asked to be folded', () => {
    const columns = resolveIdeColumns(1400, {
      ...layout,
      filesCollapsed: true,
      assistantCollapsed: true,
    })
    expect(columns.filesWidth).toBe(RAIL)
    expect(columns.assistantWidth).toBe(RAIL)
    expect(columns.filesCollapsed).toBe(true)
    expect(columns.assistantCollapsed).toBe(true)
  })

  it('reports a column squeezed to its rail as folded', () => {
    const columns = resolveIdeColumns(600, { ...layout, filesWidth: 200, assistantWidth: 320 })
    expect(columns.filesCollapsed).toBe(true)
    expect(columns.filesWidth).toBe(RAIL)
  })
})
