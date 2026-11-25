/**
 * The external-runtime store: the deployment's own catalog, the executable it
 * probes, and the write that points one runtime at another executable.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { AgentBackendRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import { AgentRuntimeController, runtimeOptions } from '../src/client/runtime-store.ts'

const NATIVE = {
  id: 'dsh' as const,
  name: 'DSH',
  version: 'native',
  source: 'cetusprism',
  availability: 'ready' as const,
  capabilities: { cancel: true, resume: true, tools: true, modelRouting: 'cetus' as const },
}

const CATALOG: AgentBackendRow[] = [
  NATIVE,
  {
    id: 'pi', name: 'Pi', command: 'C:/tools/pi.cmd', configured: true, version: '0.87.0',
    source: 'external-runtime', availability: 'ready',
    capabilities: { cancel: true, resume: true, tools: true, modelRouting: 'external-runtime' },
  },
  {
    id: 'zcode', name: 'ZCode', command: 'zcode', configured: false, version: 'unconfigured',
    source: 'external-runtime', availability: 'unconfigured', reason: 'ZCode runtime is not installed',
    capabilities: { cancel: false, resume: false, tools: false, modelRouting: 'external-runtime' },
  },
]

describe('external runtime rows', () => {
  it('lists the external runtimes only, with the executable they probe', () => {
    const rows = runtimeOptions(CATALOG)
    expect(rows.map(row => row.id)).toEqual(['pi', 'zcode'])
    expect(rows[0]).toMatchObject({ command: 'C:/tools/pi.cmd', configured: true, availability: 'ready' })
    expect(rows[1]).toMatchObject({
      command: 'zcode', configured: false, availability: 'unconfigured', reason: 'ZCode runtime is not installed',
    })
  })

  it('falls back to the upstream command when the host named none', () => {
    // A host that predates the executable field still answers; the upstream's
    // own command is what it probes.
    const rows = runtimeOptions([NATIVE, { ...NATIVE, id: 'pi', name: 'Pi' }])
    expect(rows[0]).toMatchObject({ command: 'pi', configured: false })
  })
})

describe('external runtime reads', () => {
  it('publishes the catalog the host answered with', async () => {
    const ctx = new Context()
    new TestRemote(ctx, {
      agentPresets: {
        backends: () => Promise.resolve({ ok: true as const, value: { backends: CATALOG } }),
      },
    })
    const controller = new AgentRuntimeController(ctx)
    await controller.load()
    const state = controller.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.options.map(row => row.id)).toEqual(['pi', 'zcode'])
    expect(state.options[0]).toMatchObject({ command: 'C:/tools/pi.cmd', configured: true })
  })
})

describe('external runtime writes', () => {
  it('writes the executable into the deployment configuration', async () => {
    const writes: object[] = []
    const ctx = new Context()
    new TestRemote(ctx, {
      settings: {
        update: (_ns: string, patch: object) => {
          writes.push(patch)
          return Promise.resolve({ ok: true as const, value: {} })
        },
      },
    })
    const controller = new AgentRuntimeController(ctx)
    expect(await controller.save('pi', '  C:/tools/pi.cmd  ')).toBeUndefined()
    expect(writes).toEqual([{ externalRuntimes: { pi: 'C:/tools/pi.cmd' } }])
  })

  it('reports a refused write as the failure the page shows', async () => {
    const ctx = new Context()
    new TestRemote(ctx, {
      settings: {
        update: () => Promise.resolve({
          ok: false as const,
          error: new Error('settings write disconnected'),
        }),
      },
    })
    const controller = new AgentRuntimeController(ctx)
    expect(await controller.save('pi', 'C:/tools/pi.cmd')).toBe('settings write disconnected')
    expect(controller.store.getSnapshot().error).toBe('settings write disconnected')
  })
})
