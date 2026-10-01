/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The slot and locale faces are recorders, because what matters here is what
 * was handed to them — one composer seat whose factory resolves the
 * `/foreground` submit — and that every registration is gone after dispose.
 * The Session face is a recorder over `binding`, the write path's own shape.
 * A refused submit resolves false and reaches the composer notice channel —
 * the write path has no silent failure.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { DeliveryToggle } from '../src/client/DeliveryToggle.tsx'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  locale: string
  inject: unknown
  component: unknown
}

/** The face the factory hands the chip, narrowed for the spec's assertions. */
interface RecordedFace {
  submit(mode: 'allow-foreground' | 'background-only'): Promise<boolean>
}

async function boot(options: { command?: (line: string) => unknown } = {}) {
  const ctx = new Context()
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
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const command = vi.fn(options.command ?? (async () => ({
    ok: true as const,
    value: { matched: true },
  })))
  const notify = vi.fn()
  const conversation = {
    input: {
      for: vi.fn(() => ({ notify })),
    },
  }
  const sessionScope = { get: vi.fn(() => conversation) }
  const sessions = {
    binding: vi.fn((id: string) => id === 's-test'
      ? { session: { command } }
      : undefined),
    // Every session with a composer has a scope; 's-other' merely lacks the
    // materialized write binding.
    scope: vi.fn(() => sessionScope),
  }
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('sessions', sessions as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { registered, dictionaries, fiber, sessions, command, notify }
}

describe('ui-computer-foreground apply', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the dictionaries and one composer seat', async () => {
    const { registered, dictionaries } = await boot()
    expect(dictionaries.get('computerForeground')).toEqual({ zh, en })
    expect(registered.map(entry => [entry.name, entry.locale, entry.component])).toEqual([
      ['conversation.input.computerDelivery', 'computerForeground', DeliveryToggle],
    ])
    expect(typeof registered[0]?.inject).toBe('function')
  })

  it('wires the chip face to the /foreground command writer', async () => {
    const { registered, sessions, command } = await boot()
    const factory = registered[0]?.inject as (sessionId: string) => RecordedFace
    await expect(factory('s-test').submit('background-only')).resolves.toBe(true)
    expect(sessions.binding).toHaveBeenCalledWith('s-test')
    expect(command).toHaveBeenCalledExactlyOnceWith('/foreground background-only')
  })

  it('notices the composer when the session is not materialized', async () => {
    const { registered, notify } = await boot()
    const factory = registered[0]?.inject as (sessionId: string) => RecordedFace
    await expect(factory('s-other').submit('allow-foreground')).resolves.toBe(false)
    expect(notify).toHaveBeenCalledExactlyOnceWith('error', 'error.submit')
  })

  it('notices the composer when the host offers no /foreground command', async () => {
    const { registered, notify } = await boot({
      command: async () => ({ ok: true as const, value: { matched: false } }),
    })
    const factory = registered[0]?.inject as (sessionId: string) => RecordedFace
    await expect(factory('s-test').submit('allow-foreground')).resolves.toBe(false)
    expect(notify).toHaveBeenCalledExactlyOnceWith('error', 'error.submit')
  })

  it('notices the composer with the session-in-use refusal on a writer-held session', async () => {
    const { registered, notify } = await boot({
      command: async () => ({ ok: false as const, error: { code: 'session/writer-held', message: 'held' } }),
    })
    const factory = registered[0]?.inject as (sessionId: string) => RecordedFace
    await expect(factory('s-test').submit('allow-foreground')).resolves.toBe(false)
    expect(notify).toHaveBeenCalledExactlyOnceWith('error', 'error.sessionInUse')
  })

  it('notices the composer with the host error on a failed execution', async () => {
    const { registered, notify } = await boot({
      command: async () => ({ ok: false as const, error: { code: 'X', message: 'boom' } }),
    })
    const factory = registered[0]?.inject as (sessionId: string) => RecordedFace
    await expect(factory('s-test').submit('allow-foreground')).resolves.toBe(false)
    expect(notify).toHaveBeenCalledExactlyOnceWith('error', 'error.submit')
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})
