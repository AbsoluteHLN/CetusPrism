/**
 * The Host-side model catalog cache: one current answer, one build at a time.
 *
 * The catalog is a full traversal of every registered provider's models, and
 * several browser surfaces read it independently. These cases pin the
 * behavior that keeps a burst of readers from turning into a burst of
 * rebuilds.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ModelCatalogCache } from '../src/model-catalog-cache.ts'

interface Fixture {
  readonly ctx: Context
  /** How many provider traversals the cache performed. */
  readonly builds: () => number
  /** Change the deployment default the catalog publishes. */
  readonly setDefault: (model: string) => void
}

/** A Context with just the faces the catalog reads. */
function fixture(): Fixture {
  let defaultModel = 'first'
  const listModels = vi.fn(async (provider: string) => [
    { provider, id: `${provider}-model`, name: `${provider} model` },
  ])
  const ctx = new Context()
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: defaultModel }),
  } as never)
  ctx.provide('llm', {
    listProviders: () => [{ id: 'fixture', name: 'Fixture' }],
    listModels,
    resolveModelInfo: async (provider: string, id: string) => ({ provider, id, name: id }),
  } as never)
  return {
    ctx,
    builds: () => listModels.mock.calls.length,
    setDefault: (model: string) => { defaultModel = model },
  }
}

describe('ModelCatalogCache', () => {
  it('shares one build between concurrent readers', async () => {
    const f = fixture()
    const cache = new ModelCatalogCache(f.ctx)

    const [first, second] = await Promise.all([cache.get(), cache.get()])

    expect(second).toBe(first)
    expect(f.builds()).toBe(1)
  })

  it('answers a later reader from the current entry', async () => {
    const f = fixture()
    const cache = new ModelCatalogCache(f.ctx)

    const first = await cache.get()
    const second = await cache.get()

    expect(second).toBe(first)
    expect(f.builds()).toBe(1)
  })

  it('rebuilds after an invalidation', async () => {
    const f = fixture()
    const cache = new ModelCatalogCache(f.ctx)

    await cache.get()
    cache.invalidate()
    await cache.get()

    expect(f.builds()).toBe(2)
  })

  it('rebuilds when the deployment default changes', async () => {
    const f = fixture()
    const cache = new ModelCatalogCache(f.ctx)

    const first = await cache.get()
    f.setDefault('second')
    const second = await cache.get()

    expect(second).not.toBe(first)
    expect(second.default).toEqual({ provider: 'fixture', model: 'second' })
    expect(f.builds()).toBe(2)
  })

  it('does not cache a build that was already running when the topology changed', async () => {
    const f = fixture()
    const cache = new ModelCatalogCache(f.ctx)

    const running = cache.get()
    cache.invalidate()
    await running
    await cache.get()

    // The retired build answered its own reader but did not become the entry.
    expect(f.builds()).toBe(2)
  })
})
