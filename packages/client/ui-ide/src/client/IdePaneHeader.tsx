/**
 * The IDE's pane header: the title bar every column carries.
 *
 * An IDE is read by its columns — the tree on the left, the code in the middle,
 * the assistant on the right — and a column without a header is just a strip
 * of content. The header names the column, carries its icon and leaves room
 * for the detail the column knows best: the project root, the open file's
 * language, the Session's title.
 *
 * It is a SECTION LABEL, not a toolbar: the product's own columns label
 * themselves with 13px secondary text and a 14px outline glyph, and put their
 * controls on the right as ghost icon buttons. There is no band behind it and
 * no rule under it — the columns are separated by their own seams.
 */

import type { ReactNode } from 'react'
import css from './IdeWorkspace.module.css'

/** The props the pane header renders from. */
export interface IdePaneHeaderProps {
  /** The column's icon. */
  readonly icon: ReactNode
  /** The column's name. */
  readonly title: string
  /** Whether the name is the column's CURRENT subject, not its kind. */
  readonly current?: boolean
  /** The secondary name on the right: a path, a language, a Session title. */
  readonly detail?: ReactNode
  /** The header's actions, before the detail. */
  readonly actions?: ReactNode
  /** The accessible name of the column the header belongs to. */
  readonly ariaLabel?: string
}

/**
 * Render a pane header.
 * @param props - the icon, the title, and the optional detail and actions.
 * @returns the header.
 */
export function IdePaneHeader(props: IdePaneHeaderProps): ReactNode {
  const { icon, title, current, detail, actions, ariaLabel } = props
  return (
    <div className={css.paneHeader} aria-label={ariaLabel}>
      <span className={css.paneIcon} aria-hidden="true">{icon}</span>
      <span className={current === true ? css.paneTitleCurrent : css.paneTitle}>{title}</span>
      {detail !== undefined && <span className={css.paneDetail}>{detail}</span>}
      {actions !== undefined && <span className={css.paneActions}>{actions}</span>}
    </div>
  )
}
