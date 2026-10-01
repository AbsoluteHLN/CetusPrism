/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The registry is real, because "registered" means what it says a type is; the
 * slot, locale, Session, and Conversation faces are recorders, because what
 * matters here is what was handed to them — one body seat under the type's id
 * whose factory resolves the stop gesture and the frame loader — and that
 * every registration is gone after dispose.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { COMPUTER_ID, COMPUTER_KIND } from '../src/client/definition.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { ComputerBody } from '../src/client/view/ComputerBody.tsx'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  key: string
  locale: string
  inject: unknown
  component: unknown
}

/** The face the factory hands the body, narrowed for the spec's assertions. */
interface RecordedFace {
  stop(): void
  loadImage(attachment: { attachmentId: ReturnType<typeof AttachmentId>; mediaType: string }): Promise<string>
}

async function boot() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    // Copy is the dictionary's contract; the key stands in for the translation.
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const cancel = vi.fn(() => Promise.resolve())
  const conversation = { cancel }
  const sessions = {
    scope: vi.fn((id: string) => id === 's-test'
      ? { get: (name: string) => name === 'conversation' ? conversation : undefined }
      : undefined),
  }
  const uiConversation = { imageUrl: vi.fn(async () => 'blob:frame') }
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('sessions', sessions as never)
  ctx.provide('uiConversation', uiConversation as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber, sessions, uiConversation, cancel }
}

describe('ui-sidebar-computer apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and one body seat under the type\'s id', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(COMPUTER_KIND)
    expect(definition?.id).toBe(COMPUTER_ID)
    expect(definition?.priority).toBe('builtin')
    expect(dictionaries.get('sidebarComputer')).toEqual({ zh, en })
    // The seat key is the implementation's id: an extension may take the kind
    // over, and the seat must still find this body.
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', COMPUTER_ID, 'sidebarComputer', ComputerBody],
    ])
    expect(typeof registered[0]?.inject).toBe('function')
  })

  it('wires the body face to the session-scoped Conversation and the image cache', async () => {
    const { registered, sessions, uiConversation, cancel } = await boot()
    const factory = registered[0]?.inject as (sessionId: string) => RecordedFace
    const face = factory('s-test')
    face.stop()
    expect(sessions.scope).toHaveBeenCalledWith('s-test')
    expect(cancel).toHaveBeenCalledTimes(1)
    await expect(face.loadImage({ attachmentId: AttachmentId('a-1'), mediaType: 'image/png' }))
      .resolves.toBe('blob:frame')
    expect(uiConversation.imageUrl).toHaveBeenCalledWith('s-test', { attachmentId: AttachmentId('a-1'), mediaType: 'image/png' })
  })

  it('fails loud when the stop gesture cannot reach a Conversation', async () => {
    const { registered } = await boot()
    const factory = registered[0]?.inject as (sessionId: string) => RecordedFace
    expect(() => { factory('s-other').stop() }).toThrow('resolved no scope')
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(COMPUTER_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})
