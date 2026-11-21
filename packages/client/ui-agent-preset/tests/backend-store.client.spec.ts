/**
 * The execution-backend catalog store: one read, one visible row per backend,
 * and a refusal that carries the reason a backend cannot start a session.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { AgentBackendRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import { AgentBackendSeatController, backendOptions, backendSeatVisible, readBackendCatalog } from '../src/client/backend-store.ts'

const BACKENDS: AgentBackendRow[] = [
  { id: 'dsh', name: 'DSH', version: 'native', source: 'cetusprism', availability: 'ready', capabilities: { cancel: true, resume: true, tools: true, modelRouting: 'cetus' } },
  { id: 'pi', name: 'Pi', version: 'unconfigured', source: 'external-runtime', availability: 'unconfigured', reason: 'Pi runtime is not configured', capabilities: { cancel: false, resume: false, tools: false, modelRouting: 'external-runtime' } },
  { id: 'zcode', name: 'ZCode', version: '3.16.2', source: 'external-runtime', availability: 'incompatible', reason: 'protocol version 2 is not supported', capabilities: { cancel: false, resume: false, tools: false, modelRouting: 'external-runtime' } },
]

/** A browser context whose AgentPresets namespace answers the backend catalog. */
function contextWith(backends: () => Promise<unknown>, selectBackend?: (id: string) => Promise<unknown>): Context {
  const ctx = new Context()
  new TestRemote(ctx, { agentPresets: { backends, ...(selectBackend === undefined ? {} : { selectBackend }) } })
  return ctx
}

/** The catalog the host publishes, as the Remote answers it. */
function answer(rows: readonly AgentBackendRow[], current?: string): Promise<unknown> {
  return Promise.resolve({ ok: true as const, value: { backends: rows, ...(current === undefined ? {} : { current }) } })
}

/** A catalog whose Pi runtime answered the probe and can start a session. */
const READY_PI: AgentBackendRow[] = [
  BACKENDS[0]!,
  { id: 'pi', name: 'Pi', version: '0.87.0', source: 'external-runtime', availability: 'ready', capabilities: { cancel: true, resume: true, tools: true, modelRouting: 'external-runtime' } },
]

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
    const asked: string[] = []
    const ctx = contextWith(
      () => answer(BACKENDS),
      (id: string) => {
        asked.push(id)
        return Promise.resolve({ ok: true as const, value: id })
      },
    )
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    await controller.select('pi')
    controller.dismissRefusal()
    expect(controller.store.getSnapshot().refusal).toBeNull()
    expect(await controller.select('dsh')).toBeUndefined()
    expect(controller.store.getSnapshot().current).toBe('dsh')
  })

  it('commits a DSH pick on the host too, so an abandoned runtime is released', async () => {
    // Regression: a chip that skipped the host call for DSH left the host
    // bound to a runtime the composer had already abandoned.
    const asked: string[] = []
    const ctx = contextWith(
      () => answer(READY_PI, 'pi'),
      (id: string) => {
        asked.push(id)
        return Promise.resolve({ ok: true as const, value: id })
      },
    )
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(controller.store.getSnapshot().current).toBe('pi')
    expect(await controller.select('dsh')).toBeUndefined()
    expect(asked).toEqual(['dsh'])
    expect(controller.store.getSnapshot().current).toBe('dsh')
  })
})

describe('an external backend selection', () => {
  it('commits the pick on the host, where the next session binds it', async () => {
    // The chip alone cannot honour a backend: the backend owns the Agent
    // lifecycle, so the choice belongs to the host that binds the session.
    const asked: string[] = []
    const ctx = contextWith(
      () => answer(READY_PI),
      (id: string) => {
        asked.push(id)
        return Promise.resolve({ ok: true as const, value: id })
      },
    )
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(await controller.select('pi')).toBeUndefined()
    expect(asked).toEqual(['pi'])
    expect(controller.store.getSnapshot().current).toBe('pi')
    expect(controller.store.getSnapshot().refusal).toBeNull()
  })

  it('shows the host reason when the pick is refused', async () => {
    const ctx = contextWith(
      () => answer(READY_PI),
      () => Promise.resolve({
        ok: false as const,
        error: new RemoteError('agent-backend/unavailable', 'Pi runtime is not configured', { agentBackend: 'pi' }),
      }),
    )
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(await controller.select('pi')).toBe('Pi runtime is not configured')
    expect(controller.store.getSnapshot().current).toBe('dsh')
  })

  it('shows the selection the host published instead of its own guess', async () => {
    // A reload must not fall back to DSH: the host still holds the pick.
    const ctx = contextWith(() => answer(READY_PI, 'pi'))
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(controller.store.getSnapshot().current).toBe('pi')
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

describe('the one-button rule', () => {
  const wire = (row: { id: 'dsh' | 'pi' | 'zcode'; name: string; version: string; availability: 'ready' | 'unconfigured' | 'incompatible'; reason?: string }) => row
  const dsh = wire({ id: 'dsh', name: 'DSH', version: 'native', availability: 'ready' })
  const piUnconfigured = wire({ id: 'pi', name: 'Pi', version: 'unconfigured', availability: 'unconfigured', reason: 'Pi runtime is not configured' })
  const zcodeUnconfigured = wire({ id: 'zcode', name: 'ZCode', version: 'unconfigured', availability: 'unconfigured', reason: 'ZCode runtime is not configured' })
  const piReady = wire({ id: 'pi', name: 'Pi', version: '0.87.0', availability: 'ready' })
  const zcodeIncompatible = wire({ id: 'zcode', name: 'ZCode', version: '3.16.2', availability: 'incompatible', reason: 'protocol version 2 is not supported' })

  it('hides the seat while only DSH is installed', () => {
    expect(backendSeatVisible(backendOptions([dsh, piUnconfigured, zcodeUnconfigured]))).toBe(false)
  })

  it('shows the seat once any external runtime answered a probe', () => {
    // Ready counts: a runtime this build can drive is the whole point.
    expect(backendSeatVisible(backendOptions([dsh, piReady]))).toBe(true)
    // Incompatible counts too: the runtime exists, so choosing is real even
    // when the answer is a refusal the chip explains.
    expect(backendSeatVisible(backendOptions([dsh, zcodeIncompatible]))).toBe(true)
  })
})

describe('seat refresh and failure edges', () => {
  it('keeps only the newest catalog read after overlapping refreshes', async () => {
    let releaseSecond: (() => void) | undefined
    let first = true
    const ctx = contextWith(() => {
      if (first) {
        first = false
        return answer(BACKENDS)
      }
      return new Promise((resolve) => { releaseSecond = () => resolve(answer(READY_PI, 'pi')) })
    })
    const controller = new AgentBackendSeatController(ctx)
    const older = controller.load()
    const newer = controller.load()
    // The older read settles late: it must not publish over the newer one.
    await older
    expect(controller.store.getSnapshot().status).toBe('loading')
    releaseSecond?.()
    await newer
    expect(controller.store.getSnapshot().status).toBe('ready')
    expect(controller.store.getSnapshot().current).toBe('pi')
  })

  it('refuses an unavailable backend without a published reason with the default text', async () => {
    const rows: AgentBackendRow[] = [
      BACKENDS[0]!,
      { id: 'pi', name: 'Pi', version: 'unconfigured', source: 'external-runtime', availability: 'unconfigured', capabilities: { cancel: false, resume: false, tools: false, modelRouting: 'external-runtime' } },
    ]
    const ctx = contextWith(() => answer(rows))
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(await controller.select('pi')).toBe('Pi backend is not configured')
    expect(controller.store.getSnapshot().current).toBe('dsh')
  })

  it('turns a thrown selection call into a refusal', async () => {
    let calls = 0
    const ctx = contextWith(
      () => answer(READY_PI),
      () => {
        calls += 1
        // First a real Error, then a bare rejection: both become refusals.
        return calls === 1 ? Promise.reject(new Error('socket gone')) : Promise.reject('boom')
      },
    )
    const controller = new AgentBackendSeatController(ctx)
    await controller.load()
    expect(await controller.select('pi')).toBe('socket gone')
    expect(controller.store.getSnapshot().refusal).toBe('socket gone')
    expect(await controller.select('pi')).toBe('boom')
    expect(controller.store.getSnapshot().refusal).toBe('boom')
    expect(controller.store.getSnapshot().current).toBe('dsh')
  })
})
