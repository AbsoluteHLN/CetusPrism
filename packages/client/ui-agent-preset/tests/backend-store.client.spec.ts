/**
 * The execution-backend catalog store: one read, one visible row per backend,
 * and a refusal that carries the reason a backend cannot start a session.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { AgentBackendRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import { AgentBackendSeatController, backendOptions, readBackendCatalog } from '../src/client/backend-store.ts'

const BACKENDS: AgentBackendRow[] = [
  { id: 'dsh', name: 'DSH', version: 'native', source: 'cetusprism', availability: 'ready', capabilities: { cancel: true, resume: true, tools: true, modelRouting: 'cetus' } },
  { id: 'pi', name: 'Pi', version: 'unconfigured', source: 'external-runtime', availability: 'unconfigured', reason: 'Pi runtime is not configured', capabilities: { cancel: false, resume: false, tools: false, modelRouting: 'external-runtime' } },
  { id: 'zcode', name: 'ZCode', version: '3.16.2', source: 'external-runtime', availability: 'incompatible', reason: 'protocol version 2 is not supported', capabilities: { cancel: false, resume: false, tools: false, modelRouting: 'external-runtime' } },
]

/** A browser context whose AgentPresets namespace answers the backend catalog. */
function contextWith(backends: () => Promise<unknown>): Context {
  const ctx = new Context()
  new TestRemote(ctx, { agentPresets: { backends } })
  return ctx
}

/** The catalog the host publishes, as the Remote answers it. */
function answer(rows: readonly AgentBackendRow[]): Promise<unknown> {
  return Promise.resolve({ ok: true as const, value: { backends: rows } })
}

describe('execution backend catalog', () => {
  it('reads the catalog and keeps every backend visible', async () => {
    const ctx = contextWith(() => answer(BACKENDS))
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.options.map(option => option.id)).toEqual(['dsh', 'pi', 'zcode'])
    expect(state.current).toBe('dsh')
  })

  it('reports a deployment without backends as unavailable rather than failing', async () => {
    const ctx = contextWith(() => answer([]))
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(controller.store.getSnapshot().status).toBe('unavailable')
  })

  it('treats an absent service as an empty catalog', async () => {
    const ctx = contextWith(() => Promise.resolve({
      ok: false as const,
      error: new RemoteError('gateway/invocation-unavailable', 'no such service', { endpoint: 'agentPresets/backends' }),
    }))
    const read = await readBackendCatalog(ctx)
    expect(read).toEqual({ ok: true, value: { backends: [] } })
  })

  it('reports a host failure as an error the chip can show', async () => {
    const ctx = contextWith(() => Promise.resolve({
      ok: false as const,
      error: new RemoteError('gateway/internal', 'host disconnected', {}),
    }))
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(controller.store.getSnapshot()).toMatchObject({ status: 'error', error: 'host disconnected' })
  })
})

describe('execution backend selection', () => {
  it('refuses a backend with no runtime and keeps the reason', async () => {
    const ctx = contextWith(() => answer(BACKENDS))
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(await controller.select('pi')).toBe('Pi runtime is not configured')
    expect(controller.store.getSnapshot().refusal).toBe('Pi runtime is not configured')
    expect(controller.store.getSnapshot().current).toBe('dsh')
  })

  it('refuses an incompatible runtime with the host reason', async () => {
    const ctx = contextWith(() => answer(BACKENDS))
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(await controller.select('zcode')).toBe('protocol version 2 is not supported')
  })

  it('refuses an unknown backend', async () => {
    const ctx = contextWith(() => answer(BACKENDS))
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(await controller.select('opencode')).toBe('unknown agent backend: opencode')
  })

  it('keeps DSH selected and clears a refusal', async () => {
    const ctx = contextWith(() => answer(BACKENDS))
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    await controller.select('pi')
    controller.dismissRefusal()
    expect(controller.store.getSnapshot().refusal).toBeNull()
    expect(await controller.select('dsh')).toBeUndefined()
    expect(controller.store.getSnapshot().current).toBe('dsh')
  })
})

describe('backend options', () => {
  it('carries the reason only when the host gave one', () => {
    const options = backendOptions(BACKENDS)
    expect(options[0]).toEqual({
      id: 'dsh', name: 'DSH', version: 'native', availability: 'ready',
    })
    expect(options[1]).toMatchObject({ reason: 'Pi runtime is not configured' })
  })
})
