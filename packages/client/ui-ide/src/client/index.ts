/**
 * IDE workspace plugin, browser half: the coding surface that lives in the
 * layout's central panel.
 *
 * The IDE belongs to ONE Session. Its left column is that Session's project
 * tree, its middle column is the file being read, and its right column is
 * that Session's assistant conversation — an explicitly bound second
 * occurrence of the shared Conversation content, independent of the
 * conversation frame the app shows in the central column.
 *
 * The plugin owns the workspace service, the entries that bind it to a
 * Session, and the central panel that renders it. The workspace's FILES come
 * from the Host's `workspaceFiles` Remote namespace, so the surface itself
 * stays free of any Remote or filesystem knowledge.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the layout's central panel declaration into this program.
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the Session scope adapter's standard hooks into this program.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the sidebar's session-entry slots into this program.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { IdeConversation } from './IdeAssistant.tsx'
import { IdeSessionMenuItem, IdeSessionRowButton, type IdeEntryInjected } from './IdeSessionEntry.tsx'
import { IdeWorkspace } from './IdeWorkspace.tsx'
import { createFilesPort } from './ide-files.ts'
import { createIdeWorkspace, ideWorkspaceFace, type IIdeWorkspace } from './ide-workspace-service.ts'
import { en, zh, type IdeKey } from './locales.ts'

export { IdeWorkspace } from './IdeWorkspace.tsx'
export type { IdeWorkspaceInjected, IdeWorkspaceProps } from './IdeWorkspace.tsx'
export { IdeAssistant, IdeConversation, FixedChatConversationView } from './IdeAssistant.tsx'
export type { IdeAssistantProps, IdeConversationProps } from './IdeAssistant.tsx'
export { IdeFileTree } from './IdeFileTree.tsx'
export type { IdeFileTreeProps } from './IdeFileTree.tsx'
export { IdePaneHeader } from './IdePaneHeader.tsx'
export type { IdePaneHeaderProps } from './IdePaneHeader.tsx'
export { IdeSessionMenuItem, IdeSessionRowButton } from './IdeSessionEntry.tsx'
export type { IdeEntryInjected } from './IdeSessionEntry.tsx'
export {
  activeFile,
  activateFile,
  bindSession,
  closeFile,
  collapseDirectory,
  expandDirectory,
  INITIAL_IDE_STATE,
  openFile,
  setError,
  setLevel,
  setListing,
  setQuery,
  unbindSession,
  type IdeFile,
  type IdeTreeNode,
  type IdeWorkspaceState,
} from './ide-model.ts'
export { ideTreeRows, type IdeTreeRow } from './ide-tree.ts'
export {
  childPath,
  createFilesPort,
  ideLanguage,
  type IdeFileContent,
  type IdeFileWatchEvent,
  type IdeFileWatchNotice,
  type IdeFilesPort,
  type IdeFilesRemote,
} from './ide-files.ts'
export {
  createIdeWorkspace,
  ideWorkspaceFace,
  type IIdeWorkspace,
  type IdeWorkspaceFace,
} from './ide-workspace-service.ts'
export { en, zh, type IdeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The IDE workspace's copy. */
    ide: IdeKey
  }

  interface SlotMap {
    /** Session-scoped Conversation occurrence hosted by the IDE's right column. */
    'ide.assistant': { kind: 'single'; scope: 'session' }
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** The IDE holds the Session it shows. */
    ideWorkspace: unknown
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The IDE workspace service. */
    ide: IIdeWorkspace
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'ide'

/** The id of the central panel the IDE occupies. */
export const PANEL_ID = 'ide' as MainPanelId

/** Required services for the workspace surface and its copy. */
export const inject = [
  'slots', 'locale', 'layout', 'sessions', 'remote', 'remote.workspaceFiles',
]

/**
 * Client plugin body: the workspace service, the per-Session entries that
 * bind it, and the central panel that renders it.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-ide: dictionaries')
  const t = ctx.locale.bind(NS)

  const workspace = createIdeWorkspace(createFilesPort(ctx.remote))
  ctx.provide('ide', workspace)

  // The retained Session the assistant column shows. One reference at a time:
  // binding another Session releases the previous one.
  let reference: SessionReference | undefined

  // THE IDE OWNS THE FRAME. The application's own sidebar is collapsed while
  // the IDE is on screen — the IDE's tree, code and assistant are the whole
  // workbench — and restored when the IDE leaves. A toggle could not tell
  // "entered" from "left", so the state is remembered explicitly.
  let sidebarRestore: boolean | undefined

  /**
   * Collapse the application sidebar while the IDE is selected, and restore
   * it when the selection moves away.
   */
  const syncSidebar = (): void => {
    const inIde = ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID
    if (inIde) {
      if (sidebarRestore !== undefined) return
      sidebarRestore = !ctx.layout.sidebarCollapsed()
      ctx.layout.setSidebarCollapsed(true)
      return
    }
    if (sidebarRestore === undefined) return
    const restore = sidebarRestore
    sidebarRestore = undefined
    if (restore) ctx.layout.setSidebarCollapsed(false)
  }

  ctx.effect(() => {
    const off = ctx.layout.panelInfo.subscribe(() => { syncSidebar() })
    return () => {
      off()
      // Leaving the IDE with the plugin unloaded restores the column.
      if (sidebarRestore === true) ctx.layout.setSidebarCollapsed(false)
      sidebarRestore = undefined
    }
  }, 'ui-ide: sidebar collapse')

  const openInIde = (sessionId: SessionId): void => {
    // The same Session again is not a new binding: re-retaining it would
    // release the reference the IDE already holds and tear the Session scope
    // down underneath a running agent.
    if (workspace.store.getSnapshot().sessionId === sessionId) {
      ctx.layout.selectPanel(PANEL_ID)
      syncSidebar()
      return
    }
    const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
    const title = ctx.sessions.list.getSnapshot().byId[sessionId]?.displayTitle
    let retained: SessionReference
    try {
      retained = ctx.sessions.retain(sessionId, { source: 'ideWorkspace' })
    } catch {
      // The Session is gone or cannot be opened; the panel keeps its current
      // binding rather than half-switching.
      return
    }
    reference?.release()
    reference = retained
    workspace.bind(sessionId, cwd, retained, title)
    ctx.layout.selectPanel(PANEL_ID)
    syncSidebar()
  }

  ctx.effect(() => () => {
    reference?.release()
    reference = undefined
    workspace.unbind()
  }, 'ui-ide: retained session')

  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    children: { 'ide.assistant': { kind: 'single', scope: 'session' } },
    inject: () => ({
      ...ideWorkspaceFace(workspace),
      backToConversation: () => { ctx.layout.selectPanel(null) },
    }),
  }, IdeWorkspace))

  ctx.slots.inject('ide.assistant', () => ctx.slots.register({
    name: 'ide.assistant',
    locale: NS,
  }, IdeConversation))

  // The entries are per Session: the IDE is about one Session's project and
  // one Session's conversation.
  const entryInjected = (): IdeEntryInjected => ({
    openInIde,
    label: () => t('menu.openIde'),
  })
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.menu.item',
    id: '@deepseek-ai/dsh-client-ui-ide/open',
    order: 150,
    locale: NS,
    inject: entryInjected,
  }, IdeSessionMenuItem))
  ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
    name: 'sidebar.workspaces.session.row.action',
    id: '@deepseek-ai/dsh-client-ui-ide/open',
    order: 150,
    locale: NS,
    inject: entryInjected,
  }, IdeSessionRowButton))
}
