// @vitest-environment jsdom

/**
 * The IDE plugin: the central panel it registers, the per-Session entries
 * that bind it, and the workspace service the surface renders from.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId, PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject, PANEL_ID } from '../src/client/index.ts'
import { IdeConversation } from '../src/client/IdeAssistant.tsx'
import { IdeSessionMenuItem, IdeSessionRowButton, type IdeEntryInjected } from '../src/client/IdeSessionEntry.tsx'
import { IdeWorkspace } from '../src/client/IdeWorkspace.tsx'

const Empty = () => null
const SID = 'session-one' as SessionId
const REFERENCE = { sessionId: SID, release: vi.fn() } as unknown as SessionReference

const MENU_ITEM = 'sidebar.workspaces.session.menu.item'
const ROW_ACTION = 'sidebar.workspaces.session.row.action'
const ENTRY_ID = '@deepseek-ai/dsh-client-ui-ide/open'

/** The one entry registered under `id` in a list. */
function entry(slots: SlotRegistry, key: typeof MENU_ITEM | typeof ROW_ACTION, id: string): StoredEntry {
  const found = slots.entries(key).find(candidate => candidate.options.id === id)
  if (found === undefined) throw new Error(`no ${key} entry ${id}`)
  return found
}

/** An entry's injected face. */
function faceOf(registration: StoredEntry): IdeEntryInjected {
  if (registration.inject === undefined) throw new Error('the entry declares no inject face')
  return registration.inject() as unknown as IdeEntryInjected
}

/**
 * A context with the slot registry, the locale service and the IDE plugin.
 *
 * The frame that owns the central panel and the sidebar's session rows is
 * registered AFTER the plugin: a slot registration arrives through the
 * plugin's injection, and the declaration is what releases it.
 * @returns the context, the frame's disposer and the plugin's disposer.
 */
async function baseContext(): Promise<{
  ctx: Context
  selectPanel: ReturnType<typeof vi.fn>
  setSidebarCollapsed: ReturnType<typeof vi.fn>
  retain: ReturnType<typeof vi.fn>
  releaseFrame: () => void
  disposePlugin: () => Promise<void>
}> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  // The locale plugin waits for the settings transport and the Remote face.
  const workspaceFiles = {
    list: async () => ({ ok: true, value: { path: '', entries: [], truncated: false } }),
    read: async () => ({ ok: true, value: { text: '', lines: 0, eof: true } }),
  }
  ctx.provide('remote', { workspaceFiles } as never)
  ctx.provide('remote.workspaceFiles', workspaceFiles as never)
  ctx.provide('configForms', {
    developerTools: { enabled: createSnapshotStore(true) },
    get: () => stubConfigForm().scope,
  } as never)
  await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
  const selectPanel = vi.fn()
  const setSidebarCollapsed = vi.fn()
  const panelInfo = createSnapshotStore<PanelInfo>({ activePanelId: null })
  ctx.provide('layout', {
    selectPanel: vi.fn((activePanelId: MainPanelId | null) => {
      selectPanel(activePanelId)
      panelInfo.set({ activePanelId })
    }),
    panelInfo,
    beginNavigation: vi.fn(() => new AbortController().signal),
    toggleSidebar: vi.fn(),
    sidebarCollapsed: vi.fn(() => false),
    setSidebarCollapsed,
    openRightbar: vi.fn(),
    closeRightbar: vi.fn(),
  } as never)
  const retain = vi.fn(() => REFERENCE)
  ctx.provide('sessions', {
    list: createSnapshotStore({ byId: { [SID]: { id: SID, displayTitle: 'One', cwd: '/project', running: false, blank: false, updatedAt: 0, retainedBy: {} } } }),
    retain,
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const releaseFrame = ctx.slots.register({
    name: 'root',
    children: {
      main: { kind: 'keyed', scope: 'root' },
      [MENU_ITEM]: { kind: 'list', scope: 'root' },
      [ROW_ACTION]: { kind: 'list', scope: 'root' },
    },
  } as never, Empty)
  // The service registration and the slot contributions are fiber effects:
  // one turn of the event loop lets them settle before the assertions.
  await new Promise(resolve => { setTimeout(resolve, 0) })
  return {
    ctx,
    selectPanel,
    setSidebarCollapsed,
    retain,
    releaseFrame,
    disposePlugin: async () => { await fiber.dispose() },
  }
}

describe('the IDE plugin', () => {
  it('registers the coding surface in the central panel', async () => {
    const { ctx, releaseFrame, disposePlugin } = await baseContext()
    try {
      const found = ctx.slots.entries('main')[0]!
      expect(found.options.key).toBe(PANEL_ID)
      expect(found.component).toBe(IdeWorkspace)
      expect(found.locale).toBe('ide')
      expect(found.children).toHaveProperty('ide.assistant')
    } finally {
      await disposePlugin()
      releaseFrame()
    }
  })

  it('registers the assistant column occupant', async () => {
    const { ctx, releaseFrame, disposePlugin } = await baseContext()
    try {
      const found = ctx.slots.entries('ide.assistant')[0]!
      expect(found.component).toBe(IdeConversation)
    } finally {
      await disposePlugin()
      releaseFrame()
    }
  })

  it('registers the per-session entries that open it', async () => {
    const { ctx, releaseFrame, disposePlugin } = await baseContext()
    try {
      const menu = entry(ctx.slots, MENU_ITEM, ENTRY_ID)
      const row = entry(ctx.slots, ROW_ACTION, ENTRY_ID)
      expect(menu.component).toBe(IdeSessionMenuItem)
      expect(row.component).toBe(IdeSessionRowButton)
    } finally {
      await disposePlugin()
      releaseFrame()
    }
  })

  it('binds the workspace to the session the entry names and shows the IDE', async () => {
    const { ctx, selectPanel, retain, releaseFrame, disposePlugin } = await baseContext()
    try {
      faceOf(entry(ctx.slots, MENU_ITEM, ENTRY_ID)).openInIde(SID)

      expect(retain).toHaveBeenCalledWith(SID, { source: 'ideWorkspace' })
      expect(selectPanel).toHaveBeenCalledWith(PANEL_ID)
      expect(ctx.ide.store.getSnapshot().sessionId).toBe(SID)
      expect(ctx.ide.store.getSnapshot().root).toBe('/project')
    } finally {
      await disposePlugin()
      releaseFrame()
    }
  })

  it('keeps the binding when the same session is opened again', async () => {
    const { ctx, retain, releaseFrame, disposePlugin } = await baseContext()
    try {
      const open = faceOf(entry(ctx.slots, MENU_ITEM, ENTRY_ID)).openInIde
      open(SID)
      open(SID)

      // Re-retaining would release the reference the IDE already holds.
      expect(retain).toHaveBeenCalledTimes(1)
      expect(ctx.ide.store.getSnapshot().sessionId).toBe(SID)
    } finally {
      await disposePlugin()
      releaseFrame()
    }
  })

  it('collapses the application sidebar while the IDE is on screen, and restores it after', async () => {
    const { ctx, setSidebarCollapsed, releaseFrame, disposePlugin } = await baseContext()
    try {
      faceOf(entry(ctx.slots, MENU_ITEM, ENTRY_ID)).openInIde(SID)

      // The IDE owns the frame: the application's own column gives way.
      expect(setSidebarCollapsed).toHaveBeenCalledWith(true)

      ctx.layout.selectPanel(null)
      // Leaving the IDE gives the column back.
      expect(setSidebarCollapsed).toHaveBeenLastCalledWith(false)
    } finally {
      await disposePlugin()
      releaseFrame()
    }
  })

  it('provides the workspace service the surface renders from', async () => {
    const { ctx, releaseFrame, disposePlugin } = await baseContext()
    try {
      expect(ctx.ide).toBeDefined()
      // Without a binding the surface shows an empty workspace, never a guess.
      expect(ctx.ide.store.getSnapshot().sessionId).toBeUndefined()
      expect(ctx.ide.store.getSnapshot().root).toBeUndefined()
    } finally {
      await disposePlugin()
      releaseFrame()
    }
  })

  it('takes every registration down with the plugin', async () => {
    const { ctx, releaseFrame, disposePlugin } = await baseContext()
    await disposePlugin()
    expect(ctx.slots.entries('main')).toEqual([])
    expect(ctx.slots.entries('ide.assistant')).toEqual([])
    expect(ctx.slots.entries(MENU_ITEM)).toEqual([])
    expect(ctx.slots.entries(ROW_ACTION)).toEqual([])
    releaseFrame()
  })
})
