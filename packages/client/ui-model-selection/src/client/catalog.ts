/** One Host-generation model catalog shared by every Session selector. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelCatalog, ModelSelection, ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Upper bound for one Host catalog discovery round-trip. */
export const MODEL_CATALOG_TIMEOUT_MS = 10_000

/** Stable error code for a catalog request that did not settle in time. */
export const MODEL_CATALOG_TIMEOUT_CODE = 'session/model-catalog-timeout'

/** Error surfaced to the selector when Host catalog discovery exceeds its budget. */
export class ModelCatalogTimeoutError extends Error {
  readonly code = MODEL_CATALOG_TIMEOUT_CODE

  constructor() {
    super(`model catalog request timed out after ${MODEL_CATALOG_TIMEOUT_MS}ms`)
    this.name = 'ModelCatalogTimeoutError'
  }
}

/** Observable lifecycle of the shared model catalog. */
export interface ModelCatalogState {
  value: ModelCatalog | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
}

/** Loads at most one model catalog for the current Host generation. */
export class ModelCatalogDirectory {
  /** Current shared catalog value and load lifecycle. */
  readonly store: SnapshotStore<ModelCatalogState> = createSnapshotStore({
    value: null,
    status: 'idle',
    error: null,
  })

  private readonly reasoning = new Map<string, ModelProviderGroup['models'][number]['reasoning']>()

  /**
   * Read the last advertised reasoning metadata, including unavailable models.
   * @param selection - provider and model whose effort is displayed.
   * @returns reasoning metadata observed during this Host generation.
   */
  reasoningFor(selection: ModelSelection): ModelProviderGroup['models'][number]['reasoning'] {
    return this.reasoning.get(JSON.stringify([selection.provider, selection.model]))
  }

  private generation = 0
  private inflight: Promise<ModelCatalog> | undefined

  /**
   * @param ctx - the providing plugin's context, whose `remote.session`
   * namespace carries the Host-generation catalog.
   */
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Return the current generation's catalog, sharing its one in-flight load.
   * @returns the loaded global catalog.
   */
  load(): Promise<ModelCatalog> {
    const state = this.store.getSnapshot()
    if (state.status === 'ready' && state.value !== null) return Promise.resolve(state.value)
    if (this.inflight !== undefined) return this.inflight
    const generation = this.generation
    this.store.update((draft) => {
      draft.status = 'loading'
      draft.error = null
    })
    // The generated remote method currently has no AbortSignal parameter. Keep
    // a logical cancellation bit next to the generation so a timed-out or
    // superseded response can never publish after a newer load has started.
    let timedOut = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const remote = Promise.resolve().then(() => this.ctx.remote.session.modelCatalog())
    const response = remote.then((response) => {
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      if (!timedOut && generation === this.generation) {
        for (const group of response.value.groups) {
          for (const model of group.models) {
            this.reasoning.set(JSON.stringify([group.id, model.id]), model.reasoning)
          }
        }
        this.store.set({ value: response.value, status: 'ready', error: null })
      }
      return response.value
    })
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        reject(new ModelCatalogTimeoutError())
      }, MODEL_CATALOG_TIMEOUT_MS)
    })
    const operation = Promise.race([response, timeout]).catch((error: unknown) => {
      if (generation === this.generation) {
        this.store.update((draft) => {
          draft.status = 'error'
          draft.error = error instanceof Error ? error.message : String(error)
        })
      }
      throw error
    }).finally(() => {
      if (timeoutId !== undefined) clearTimeout(timeoutId)
      if (generation === this.generation && this.inflight === operation) this.inflight = undefined
    })
    this.inflight = operation
    return operation
  }

  /**
   * Invalidate the loaded catalog; the next explicit menu read reloads it.
   * @param clear - whether values from the previous Host generation must be hidden.
   */
  private invalidate(clear = false): void {
    this.generation += 1
    this.inflight = undefined
    const value = clear ? null : this.store.getSnapshot().value
    this.store.set({ value, status: 'idle', error: null })
  }

  /** Invalidate and reload the catalog after a Host-side model input changes. */
  refresh(): void {
    this.invalidate()
    void this.load().catch(() => { /* the selector exposes the shared error */ })
  }

  /** Clear Host-specific values and load the replacement Host generation. */
  resetGeneration(): void {
    this.reasoning.clear()
    this.invalidate(true)
    void this.load().catch(() => { /* the selector exposes the shared error */ })
  }
}
