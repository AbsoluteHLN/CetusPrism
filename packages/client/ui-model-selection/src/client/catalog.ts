/** One Host-generation model catalog shared by every Session selector. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ModelCatalog, ModelSelection, ModelProviderGroup } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Upper bound for one Host catalog discovery round-trip. */
export const MODEL_CATALOG_TIMEOUT_MS = 10_000

/**
 * How long invalidation events are merged into one catalog reload.
 *
 * The Host announces a topology change as a payload-free event, and several
 * unrelated surfaces react to it. Merging the events that arrive together
 * keeps one notification from turning into a burst of identical catalog
 * reads.
 */
export const MODEL_CATALOG_COALESCE_MS = 60

/** Stable error code for a catalog request that did not settle in time. */
export const MODEL_CATALOG_TIMEOUT_CODE = 'session/model-catalog-timeout'

/** Error surfaced to the selector when Host catalog discovery exceeds its budget. */
export class ModelCatalogTimeoutError extends Error {
  /** Stable timeout classification for catalog consumers. */
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
  /** The merged reload a reader waits for while an invalidation is pending. */
  private pending: Promise<ModelCatalog> | undefined
  private pendingResolve: ((value: ModelCatalog) => void) | undefined
  private pendingReject: ((error: unknown) => void) | undefined
  /** The pending merged reload's timer, if one is scheduled. */
  private reloadTimer: ReturnType<typeof setTimeout> | undefined

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
    const inflight = this.inflight
    if (inflight !== undefined) return inflight
    // A merged reload is already scheduled: the reader waits for it rather
    // than starting a read of its own.
    const pending = this.pending
    if (pending !== undefined) return pending
    return this.startRead()
  }

  /**
   * Start one catalog read and publish it when it settles.
   * @returns the read's result.
   */
  private startRead(): Promise<ModelCatalog> {
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
      // A settled read releases the shared slot even when its generation was
      // retired while it was in flight.
      if (this.inflight === operation) this.inflight = undefined
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

  /**
   * Reload the catalog after a Host-side model input changed.
   *
   * The invalidations are merged: every notification that arrives before the
   * merged reload runs produces ONE read, not one read each. The retired value
   * stops answering readers the moment it is retired — a reader that asks now
   * waits for the merged read instead of being handed the stale catalog — and
   * a read that is already running is never abandoned: it is allowed to settle
   * and the merged reload follows it.
   */
  refresh(): void {
    this.store.set({ ...this.store.getSnapshot(), status: 'loading', error: null })
    if (this.pending !== undefined) return
    this.pending = new Promise<ModelCatalog>((resolve, reject) => {
      this.pendingResolve = resolve
      this.pendingReject = reject
    })
    // A merged reload that no reader waits for must not surface as an
    // unhandled rejection; the readers that do wait still see the failure.
    this.pending.catch(() => { /* the selector exposes the shared error */ })
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = undefined
      void this.runReload()
    }, MODEL_CATALOG_COALESCE_MS)
  }

  /**
   * Run the merged reload and hand its outcome to the waiting readers.
   */
  private async runReload(): Promise<void> {
    const resolve = this.pendingResolve
    const reject = this.pendingReject
    this.pending = undefined
    this.pendingResolve = undefined
    this.pendingReject = undefined
    if (resolve === undefined || reject === undefined) return
    const inflight = this.inflight
    if (inflight !== undefined) {
      // A running read is never abandoned; the merged read follows it.
      await inflight.catch(() => { /* the selector exposes the shared error */ })
    }
    this.invalidate()
    try {
      resolve(await this.startRead())
    } catch (error) {
      reject(error)
    }
  }

  /** Clear Host-specific values and load the replacement Host generation. */
  resetGeneration(): void {
    this.reasoning.clear()
    if (this.reloadTimer !== undefined) {
      clearTimeout(this.reloadTimer)
      this.reloadTimer = undefined
    }
    this.pending = undefined
    this.pendingResolve = undefined
    this.pendingReject = undefined
    this.invalidate(true)
    void this.load().catch(() => { /* the selector exposes the shared error */ })
  }
}
