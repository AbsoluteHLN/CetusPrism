/**
 * The IDE project tree: the order, the depth, the expansion and what a
 * filter keeps.
 */

import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { INITIAL_IDE_STATE, type IdeTreeNode, type IdeWorkspaceState } from '../src/client/ide-model.ts'
import { ideTreeRows } from '../src/client/ide-tree.ts'

const LEVELS: readonly (readonly IdeTreeNode[])[] = [
  [
    { name: 'src', path: '/project/src', kind: 'directory' },
    { name: 'README.md', path: '/project/README.md', kind: 'file' },
  ],
  [
    { name: 'b.ts', path: '/project/src/b.ts', kind: 'file' },
    { name: 'nested', path: '/project/src/nested', kind: 'directory' },
    { name: 'a.ts', path: '/project/src/a.ts', kind: 'file' },
  ],
  [
    { name: 'deep.ts', path: '/project/src/nested/deep.ts', kind: 'file' },
  ],
]

/**
 * A workspace whose project root is listed, with `src` opened.
 * @param expanded - the directories the user has expanded.
 * @param query - the tree filter.
 * @returns the workspace state.
 */
function workspace(expanded: readonly string[] = [], query = ''): IdeWorkspaceState {
  const levels = new Map<string, readonly IdeTreeNode[]>()
  levels.set('/project', LEVELS[0]!)
  levels.set('/project/src', LEVELS[1]!)
  levels.set('/project/src/nested', LEVELS[2]!)
  return {
    ...INITIAL_IDE_STATE,
    sessionId: 'session-one' as SessionId,
    root: '/project',
    levels,
    expanded,
    query,
  }
}

describe('the IDE project tree', () => {
  it('shows nothing before the project root is listed', () => {
    expect(ideTreeRows(INITIAL_IDE_STATE)).toEqual([])
  })

  it('lists directories before files and sorts each group by name', () => {
    const rows = ideTreeRows(workspace(['/project/src', '/project/src/nested']))

    expect(rows.map(row => row.path)).toEqual([
      '/project/src',
      '/project/src/nested',
      '/project/src/nested/deep.ts',
      '/project/src/a.ts',
      '/project/src/b.ts',
      '/project/README.md',
    ])
  })

  it('records how deep every row sits', () => {
    const rows = ideTreeRows(workspace(['/project/src', '/project/src/nested']))

    expect(rows.map(row => row.depth)).toEqual([0, 1, 2, 1, 1, 0])
  })

  it('keeps a closed directory closed', () => {
    const rows = ideTreeRows(workspace())

    expect(rows.map(row => row.path)).toEqual(['/project/src', '/project/README.md'])
    expect(rows[0]?.expanded).toBe(false)
  })

  it('keeps the ancestors of a match, so the path to it stays visible', () => {
    const rows = ideTreeRows(workspace([], 'deep'))

    expect(rows.map(row => row.path)).toEqual([
      '/project/src',
      '/project/src/nested',
      '/project/src/nested/deep.ts',
    ])
  })

  it('matches a name regardless of case', () => {
    expect(ideTreeRows(workspace([], 'README')).map(row => row.path)).toEqual(['/project/README.md'])
    expect(ideTreeRows(workspace([], 'readme')).map(row => row.path)).toEqual(['/project/README.md'])
  })

  it('shows everything when the query is empty', () => {
    expect(ideTreeRows(workspace(['/project/src', '/project/src/nested']))).toHaveLength(6)
  })

  it('shows nothing when no row matches', () => {
    expect(ideTreeRows(workspace([], 'nothing-here'))).toEqual([])
  })

  it('reports the listing that is in flight', () => {
    const state = { ...workspace(), listing: ['/project/src'] }

    const rows = ideTreeRows(state)

    expect(rows.find(row => row.path === '/project/src')?.loading).toBe(true)
  })
})
