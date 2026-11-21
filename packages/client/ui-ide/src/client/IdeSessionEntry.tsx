/**
 * The IDE's per-Session entries: the "..." menu row and the row's hover
 * button.
 *
 * The IDE belongs to ONE Session — its project tree is that Session's
 * workspace and its assistant column is that Session's conversation — so the
 * entry is a Session entry, not a global one. Both surfaces do the same
 * thing: bind the workspace to that Session and show the IDE.
 */

import type { ReactNode } from 'react'
import {
  IconCodeOutlineRegular, MenuItemButton, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  InjectFace, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar's session-entry slots into this program.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import css from './IdeWorkspace.module.css'

/** The IDE's entry share: the action and the label it shows. */
export interface IdeEntryInjected {
  /**
   * Open the IDE for one Session.
   * @param sessionId - the Session to bind the workspace to.
   */
  readonly openInIde: (sessionId: SessionId) => void
  /** The entry's label, read at render time so a locale switch shows up. */
  readonly label: () => string
}

/** The "..." menu row's props: the Session owner share and the entry share. */
export type IdeEntryMenuItemProps =
  PropsRuntime<'sidebar.workspaces.session.menu.item'>
  & InjectFace<IdeEntryInjected>

/** The row hover button's props: the Session owner share and the entry share. */
export type IdeEntryRowActionProps =
  PropsRuntime<'sidebar.workspaces.session.row.action'>
  & InjectFace<IdeEntryInjected>

/**
 * The "..." menu row: open this Session in the IDE.
 * @param props - owner share, the entry share, and the menu open state.
 * @returns the menu row.
 */
export function IdeSessionMenuItem(props: IdeEntryMenuItemProps): ReactNode {
  const { sessionId, useMenuOpenState, openInIde, label } = props
  const [, setMenuOpen] = useMenuOpenState()
  return (
    <MenuItemButton
      icon={<IconCodeOutlineRegular />}
      onSelect={() => {
        setMenuOpen(false)
        openInIde(sessionId)
      }}
    >
      {label()}
    </MenuItemButton>
  )
}

/**
 * The row's hover button: open this Session in the IDE.
 * @param props - owner share and the entry share.
 * @returns the button.
 */
export function IdeSessionRowButton(props: IdeEntryRowActionProps): ReactNode {
  const { sessionId, openInIde, label } = props
  return (
    <Tooltip label={label()} side="bottom" align="end" delayMs={500}>
      <button
        type="button"
        className={css.rowAction}
        aria-label={label()}
        onClick={() => { openInIde(sessionId) }}
      >
        <IconCodeOutlineRegular size={14} />
      </button>
    </Tooltip>
  )
}
