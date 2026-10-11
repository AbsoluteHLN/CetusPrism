import type { ModelCatalog } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it, vi } from 'vitest'
import {
  MODEL_CATALOG_TIMEOUT_CODE,
  MODEL_CATALOG_TIMEOUT_MS,
  ModelCatalogDirectory,
} from '../src/client/catalog.ts'

const catalog = (model: string): ModelCatalog => ({
  default: { provider: 'fixture', model },
  routableProviders: ['fixture'],
  groups: [{ id: 'fixture', name: 'Fixture', models: [{ id: model, name: model }] }],
  failures: [],
})

function directory(models: () => Promise<unknown>): ModelCatalogDirectory {
  // The providing plugin's context, scripted down to the one method it calls.
  return new ModelCatalogDirectory({ remote: { session: { modelCatalog: models } } } as never)
}

describe('ModelCatalogDirectory', () => {
  it('shares one failing request, exposes the RPC error, and permits a retry', async () => {
    const models = vi.fn()
      .mockResolvedValueOnce({
        ok: false, error: new RemoteError('gateway/internal', 'catalog offline', {}),
      })
      .mockResolvedValueOnce({ ok: true, value: catalog('recovered') })
    const subject = directory(models)

    const first = subject.load()
    expect(subject.load()).toBe(first)
    await expect(first).rejects.toThrow('gateway/internal: catalog offline')
    expect(subject.store.getSnapshot()).toMatchObject({ status: 'error', error: 'gateway/internal: catalog offline' })
    await expect(subject.load()).resolves.toEqual(catalog('recovered'))
    expect(models).toHaveBeenCalledTimes(2)
  })

  it('does not publish a successful result from an invalidated generation', async () => {
    const first = Promise.withResolvers<unknown>()
    const second = Promise.withResolvers<unknown>()
    const models = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const subject = directory(models)

    const stale = subject.load()
    subject.resetGeneration()
    first.resolve({ ok: true, value: catalog('stale') })
    await expect(stale).resolves.toEqual(catalog('stale'))
    expect(subject.store.getSnapshot()).toMatchObject({ value: null, status: 'loading' })
    second.resolve({ ok: true, value: catalog('fresh') })
    await vi.waitFor(() => {
      expect(subject.store.getSnapshot()).toMatchObject({ value: catalog('fresh'), status: 'ready' })
    })
  })

  it('does not publish a failure from an invalidated generation', async () => {
    const first = Promise.withResolvers<unknown>()
    const second = Promise.withResolvers<unknown>()
    const models = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const subject = directory(models)

    const stale = subject.load()
    subject.resetGeneration()
    first.reject(new Error('stale failure'))
    await expect(stale).rejects.toThrow('stale failure')
    expect(subject.store.getSnapshot()).toMatchObject({ value: null, status: 'loading', error: null })
    second.resolve({ ok: true, value: catalog('fresh') })
    await vi.waitFor(() => {
      expect(subject.store.getSnapshot()).toMatchObject({ value: catalog('fresh'), status: 'ready' })
    })
  })

  it('contains refresh failures while retaining old data and clears it on a failed Host reset', async () => {
    const models = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: catalog('old') })
      .mockRejectedValueOnce('refresh failed')
      .mockRejectedValueOnce(new Error('reset failed'))
    const subject = directory(models)
    await subject.load()

    subject.refresh()
    await vi.waitFor(() => {
      expect(subject.store.getSnapshot()).toEqual({
        value: catalog('old'), status: 'error', error: 'refresh failed',
      })
    })

    subject.resetGeneration()
    await vi.waitFor(() => {
      expect(subject.store.getSnapshot()).toEqual({
        value: null, status: 'error', error: 'reset failed',
      })
    })
  })

  it('converges a hung discovery to a retryable timeout error', async () => {
    vi.useFakeTimers()
    try {
      const first = Promise.withResolvers<unknown>()
      const models = vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ ok: true, value: catalog('recovered-after-timeout') })
      const subject = directory(models)

      const pending = subject.load()
      const timeout = expect(pending).rejects.toMatchObject({ code: MODEL_CATALOG_TIMEOUT_CODE })
      await vi.advanceTimersByTimeAsync(MODEL_CATALOG_TIMEOUT_MS)
      await timeout
      expect(subject.store.getSnapshot()).toMatchObject({
        status: 'error',
        error: `model catalog request timed out after ${MODEL_CATALOG_TIMEOUT_MS}ms`,
      })

      // The late transport settlement is logically cancelled and cannot
      // replace the retry's result or re-open the loading state.
      first.resolve({ ok: true, value: catalog('late-stale') })
      await expect(subject.load()).resolves.toEqual(catalog('recovered-after-timeout'))
      expect(subject.store.getSnapshot()).toMatchObject({ value: catalog('recovered-after-timeout'), status: 'ready' })
      expect(models).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats an empty model catalog as a successful ready value', async () => {
    const empty: ModelCatalog = {
      default: { provider: 'fixture', model: 'unavailable' },
      routableProviders: [], groups: [], failures: [],
    }
    const models = vi.fn().mockResolvedValue({ ok: true, value: empty })
    const subject = directory(models)

    await expect(subject.load()).resolves.toEqual(empty)
    expect(subject.store.getSnapshot()).toEqual({ value: empty, status: 'ready', error: null })
  })
})
