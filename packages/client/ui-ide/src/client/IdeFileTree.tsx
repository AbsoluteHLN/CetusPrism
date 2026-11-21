/**
 * The IDE's left column: the project tree of the bound Session.
 *
 * The column owns no data: the rows arrive already projected, and the verbs
 * go back to the workspace. A directory is listed the first time it opens,
 * so the tree holds what the user has actually looked at.
 *
 * The rows read like an IDE's file tree: a folder carries a folder icon, a
 * file carries its own type icon, and a file that is open in the tab strip
 * keeps a marker — so the tree says which document is on screen.
 */

import type { ReactNode } from 'react'
import {
  FileTypeIcon, IconChevronLeftOutlineRegular, IconFolderOpenOutlineRegular,
  IconFolderCloseRegular, IconWorkspaceTreeOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { IdeTreeRow } from './ide-tree.ts'
import { IdePaneHeader } from './IdePaneHeader.tsx'
import type { IdeKey } from './locales.ts'
import css from './IdeWorkspace.module.css'

/** The props the left column renders from. */
export interface IdeFileTreeProps {
  /** The bound Session's project root. */
  readonly root: string | undefined
  /** The visible rows, parents before their children. */
  readonly rows: readonly IdeTreeRow[]
  /** The paths of the files open in the tab strip. */
  readonly openPaths: ReadonlySet<string>
  /** The path of the file the code surface shows. */
  readonly activePath: string | null
  /** The tree's filter text. */
  readonly query: string
  /** The failure that kept the tree from being listed. */
  readonly error: string | undefined
  /** Whether the column is collapsed to its icon rail. */
  readonly collapsed: boolean
  /** Collapse or expand the column. */
  readonly toggleCollapsed: () => void
  /** Open a file in the tab strip. */
  readonly open: (path: string, name: string) => void
  /** Expand or collapse one directory. */
  readonly toggleDirectory: (path: string) => void
  /** Set the tree's filter text. */
  readonly setQuery: (query: string) => void
  /** The localized copy of the column. */
  readonly t: (key: IdeKey) => string
}

/**
 * The last segment of a path.
 * @param path - the path.
 * @returns the segment, or the path itself when it has none.
 */
function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return cut < 0 ? trimmed : trimmed.slice(cut + 1)
}

/**
 * Render the project tree.
 * @param props - the tree rows, the verbs, and the localized copy.
 * @returns the left column.
 */
export function IdeFileTree(props: IdeFileTreeProps): ReactNode {
  const {
    root, rows, openPaths, activePath, query, error, collapsed, toggleCollapsed,
    open, toggleDirectory, setQuery, t,
  } = props
  if (collapsed) {
    return (
      <aside className={css.treePane} aria-label={t('tree.aria')} data-ide-pane="files" data-collapsed="true">
        <button
          type="button"
          className={css.railButton}
          aria-label={t('tree.expand')}
          title={t('tree.expand')}
          onClick={() => { toggleCollapsed() }}
        >
          <IconChevronLeftOutlineRegular size={16} />
        </button>
      </aside>
    )
  }
  return (
    <aside className={css.treePane} aria-label={t('tree.aria')} data-ide-pane="files">
      <IdePaneHeader
        icon={<IconWorkspaceTreeOutlineRegular size={15} />}
        title={t('pane.files')}
        detail={<span title={root}>{root === undefined ? t('empty.session') : basename(root)}</span>}
        actions={(
          <button
            type="button"
            className={css.paneButton}
            aria-label={t('tree.collapse')}
            title={t('tree.collapse')}
            onClick={() => { toggleCollapsed() }}
          >
            <IconChevronLeftOutlineRegular size={14} />
          </button>
        )}
        ariaLabel={t('pane.files.aria')}
      />
      <div className={css.treeSearchRow}>
        <input
          type="search"
          className={css.treeSearch}
          value={query}
          placeholder={t('tree.search')}
          aria-label={t('tree.search')}
          onChange={(event) => { setQuery(event.target.value) }}
        />
      </div>
      {error !== undefined
        ? <p className={css.treeError}>{t('tree.error')}</p>
        : rows.length === 0
          ? <p className={css.treeEmpty}>{query.trim() === '' ? t('tree.empty') : t('tree.noMatch')}</p>
          : (
            <div className={css.treeRows} role="tree">
              {rows.map(row => {
                const isOpen = openPaths.has(row.path)
                const isActive = row.path === activePath
                return (
                  <button
                    key={row.path}
                    type="button"
                    role="treeitem"
                    className={css.treeRow}
                    data-kind={row.kind}
                    data-expanded={row.expanded || undefined}
                    data-open={isOpen || undefined}
                    data-active={isActive || undefined}
                    aria-expanded={row.kind === 'directory' ? row.expanded : undefined}
                    style={{ paddingInlineStart: `${10 + row.depth * 14}px` }}
                    onClick={() => {
                      if (row.kind === 'directory') toggleDirectory(row.path)
                      else open(row.path, row.name)
                    }}
                  >
                    <span className={css.treeMark} aria-hidden="true">
                      {row.kind === 'directory'
                        ? (row.expanded
                          ? <IconFolderOpenOutlineRegular size={14} />
                          : <IconFolderCloseRegular size={14} />)
                        : <FileTypeIcon path={row.name} size={14} />}
                    </span>
                    <span className={css.treeName}>{row.name}</span>
                    {row.loading && <span className={css.treeSpinner}>{t('tree.loading')}</span>}
                  </button>
                )
              })}
            </div>
          )}
    </aside>
  )
}
