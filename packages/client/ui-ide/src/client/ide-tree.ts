/**
 * The project tree, as the IDE's left column renders it.
 *
 * The tree is a pure projection: the workspace holds the listed LEVELS, this
 * module decides the order, the depth and which rows the filter keeps.
 * Directories come before files, and a filter keeps the ANCESTORS of a match —
 * a file whose parent folder does not match the query is still reachable,
 * because the path that reached it is what the user typed.
 *
 * A filtered tree walks every LOADED level, not only the expanded ones: the
 * user asked for a search, so a directory that was never opened but was listed
 * earlier still answers it.
 *
 * @module @deepseek-ai/dsh-client-ui-ide/ide-tree
 */

import type { IdeTreeNode, IdeWorkspaceState } from './ide-model.ts'

/** One row of the rendered tree. */
export interface IdeTreeRow {
  /** The node's absolute path. */
  readonly path: string
  /** The node's own name. */
  readonly name: string
  /** Whether the node is a directory. */
  readonly kind: 'file' | 'directory'
  /** How deep the node sits; the root level is zero. */
  readonly depth: number
  /** Whether the directory is expanded. */
  readonly expanded: boolean
  /** Whether the directory's listing is in flight. */
  readonly loading: boolean
}

/**
 * Order the nodes of one level: directories first, then files, each group by
 * name. The comparison is case-insensitive first and code-unit second, so the
 * order never depends on the machine's locale.
 * @param nodes - the level's nodes.
 * @returns the ordered nodes.
 */
function ordered(nodes: readonly IdeTreeNode[]): IdeTreeNode[] {
  return [...nodes].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    const byName = left.name.toLowerCase().localeCompare(right.name.toLowerCase(), 'en')
    return byName !== 0 ? byName : (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
  })
}

/**
 * Whether a node survives the filter: it matches itself, or something listed
 * below it does.
 * @param state - the workspace holding the listed levels.
 * @param node - the node to judge.
 * @param needle - the lower-cased filter; empty keeps everything.
 * @returns whether the node stays in the tree.
 */
function survives(state: IdeWorkspaceState, node: IdeTreeNode, needle: string): boolean {
  if (needle === '') return true
  if (node.name.toLowerCase().includes(needle)) return true
  if (node.kind !== 'directory') return false
  return (state.levels.get(node.path) ?? []).some(child => survives(state, child, needle))
}

/**
 * The tree as the left column renders it.
 * @param state - the workspace holding the listed levels and the filter.
 * @returns one row per visible node, parents before their children.
 */
export function ideTreeRows(state: IdeWorkspaceState): IdeTreeRow[] {
  const needle = state.query.trim().toLowerCase()
  const rows: IdeTreeRow[] = []
  const root = state.root
  if (root === undefined) return rows
  const walk = (parentPath: string, depth: number): void => {
    for (const node of ordered(state.levels.get(parentPath) ?? [])) {
      if (!survives(state, node, needle)) continue
      const expanded = node.kind === 'directory' && state.expanded.includes(node.path)
      rows.push({
        path: node.path,
        name: node.name,
        kind: node.kind,
        depth,
        expanded,
        loading: state.listing.includes(node.path),
      })
      if (node.kind !== 'directory') continue
      if (expanded || needle !== '') walk(node.path, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}
