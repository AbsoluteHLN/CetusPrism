/**
 * The Host's model catalog, cached and de-duplicated.
 *
 * Building a catalog walks every registered provider's models and resolves
 * each model's metadata. Several browser surfaces read that catalog on their
 * own schedule — the composer selector, the Models settings page, the
 * subagent and team model cards — so the same read used to be rebuilt several
 * times over, and every rebuild occupied a same-origin HTTP/1.1 connection.
 * This cache keeps one answer for the current topology and shares it with
 * every reader that asks while it is still current.
 *
 * Freshness has two independent inputs: the provider topology (announced by
 * `llm/adapters-updated`) and the deployment's default selection. A topology
 * change invalidates the entry outright; a default-selection change
 * invalidates it as well, because the catalog publishes that default.
 */

import type { Context } from '@deepseek-ai/cordis'
import { buildModelCatalog } from './catalog.ts'
import type { ModelCatalog, ModelSelection } from './types.ts'

/**
 * How long one cached catalog stays current without an explicit invalidation.
 *
 * The lifetime is a safety net for reads that no invalidation event covers;
 * the topology event is what normally retires an entry.
 */
export const MODEL_CATALOG_TTL_MS = 3_000

/** One cached catalog and the facts that make it current. */
interface CatalogEntry {
  /** The catalog as it was built. */
  readonly value: ModelCatalog
  /** When the entry was built. */
  readonly at: number
  /** The default selection the entry publishes. */
  readonly defaultKey: string
}

/**
 * Build one catalog entry key for a default selection.
 * @param selection - the deployment default the catalog would publish.
 * @returns a comparable key.
 */
function defaultKeyOf(selection: ModelSelection): string {
  return JSON.stringify([selection.provider, selection.model, selection.reasoningEffort ?? null])
}

/**
 * The Host-side model catalog cache: one current answer, one build at a time.
 */
export class ModelCatalogCache {
  /** The current entry, when one exists. */
  private entry: CatalogEntry | undefined

  /** The build currently running, shared by every reader that asks. */
  private inflight: Promise<ModelCatalog> | undefined

  /** Bumped by every invalidation, so a late build cannot publish a stale entry. */
  private generation = 0

  /**
   * @param ctx - Host context carrying the live LLM registry.
   * @param ttlMs - how long an entry stays current without an invalidation.
   */
  constructor(
    private readonly ctx: Context,
    private readonly ttlMs: number = MODEL_CATALOG_TTL_MS,
  ) {}

  /**
   * Retire the cached catalog. The next read rebuilds it.
   */
  invalidate(): void {
    this.generation += 1
    this.entry = undefined
  }

  /**
   * The current catalog, building it when no current answer exists.
   *
   * Concurrent readers share one build: the first one starts it, the others
   * receive the same promise. A build that was already running when the
   * topology changed still answers its own readers, but it no longer becomes
   * the cached entry.
   * @returns the current catalog.
   */
  async get(): Promise<ModelCatalog> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const defaultKey = defaultKeyOf(selection)
    const entry = this.entry
    if (entry !== undefined && entry.defaultKey === defaultKey && Date.now() - entry.at < this.ttlMs) {
      return entry.value
    }
    const inflight = this.inflight
    if (inflight !== undefined) return inflight
    const generation = this.generation
    const operation = buildModelCatalog(this.ctx, selection).then(
      (value) => {
        this.inflight = undefined
        if (generation === this.generation) {
          this.entry = { value, at: Date.now(), defaultKey }
        }
        return value
      },
      (error: unknown) => {
        this.inflight = undefined
        throw error
      },
    )
    this.inflight = operation
    return operation
  }
}
