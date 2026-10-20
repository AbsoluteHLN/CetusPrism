/**
 * The execution-backend catalog as the composer reads it.
 *
 * A backend owns the Agent lifecycle, the request scheduling and the tool
 * execution. It is a separate dimension from the preset (the prompt, the tool
 * set and the runtime constraints) and from the model (the provider, the model
 * and the effort routing).
 *
 * The catalog comes from one `agentPresets.backends` call. Every backend stays
 * visible even when it cannot start a session, because the reason it cannot
 * is exactly what the composer has to explain.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AgentBackendCatalog } from '@deepseek-ai/dsh-agent-preset-registry/types'

/** One execution backend as the composer renders it. */
export interface AgentBackendOption {
  /** Stable backend identity. */
  readonly id: 'dsh' | 'pi' | 'zcode'
  /** Display name of the backend. */
  readonly name: string
  /** Installed runtime version, or `unconfigured` when no runtime answered. */
  readonly version: string
  /** Whether this backend can start a session. */
  readonly availability: 'ready' | 'unconfigured' | 'incompatible'
  /** Why this backend cannot start a session; absent when it can. */
  readonly reason?: string
}

/** The backend every session runs on unless a registered runtime replaces it. */
export const DEFAULT_AGENT_BACKEND = 'dsh'

/** Backend chip snapshot. */
export interface AgentBackendSeatState {
  /** The catalog read state; `unavailable` means the host offers no backends. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** The read failure, when the host answered with one. */
  error: string | null
  /** Every backend, DSH first. */
  options: readonly AgentBackendOption[]
  /** The backend the next session runs on. */
  current: string
  /** The refusal a pick produced, with the reason the host gave. */
  refusal: string | null
}

const INITIAL: AgentBackendSeatState = {
  status: 'idle', error: null, options: [], current: DEFAULT_AGENT_BACKEND, refusal: null,
}

/**
 * Read the backend catalog, turning a refusal into the message the chip shows.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @returns the catalog, or the message to show in its place.
 */
export async function readBackendCatalog(ctx: ClientContext): Promise<
  { ok: true; value: AgentBackendCatalog } | { ok: false; error: string }
> {
  const result = await ctx.remote.agentPresets.backends()
  if (result.ok) return { ok: true, value: result.value }
  // Execution backends are optional: without that service every session runs
  // on DSH, so callers receive the same empty catalog as a mounted service
  // that offers none.
  if (result.error.code === 'gateway/invocation-unavailable') return { ok: true, value: { backends: [] } }
  return { ok: false, error: result.error.message }
}

/**
 * The catalog rows as the chip renders them.
 * @param backends - the catalog the host answered with.
 * @returns one option per backend, in host order.
 */
export function backendOptions(
  backends: readonly {
    id: 'dsh' | 'pi' | 'zcode'
    name: string
    version: string
    availability: 'ready' | 'unconfigured' | 'incompatible'
    reason?: string
  }[],
): AgentBackendOption[] {
  return backends.map(backend => ({
    id: backend.id,
    name: backend.name,
    version: backend.version,
    availability: backend.availability,
    ...backend.reason === undefined ? {} : { reason: backend.reason },
  }))
}

/**
 * The controller behind the composer backend chip.
 *
 * It reads the catalog the host publishes and answers one question per pick:
 * can this backend start the next session, and if not, why not.
 */
export class AgentBackendSeatController {
  /** Chip snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentBackendSeatState> = createSnapshotStore(INITIAL)

  /** Only the newest catalog read may publish after overlapping refreshes. */
  private loadGeneration = 0

  /**
   * @param ctx - the browser plugin context (the catalog read).
   */
  constructor(private readonly ctx: ClientContext) {}

  private set(patch: Partial<AgentBackendSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the backend catalog.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    this.set({ status: 'loading', error: null })
    const catalog = await readBackendCatalog(this.ctx)
    if (generation !== this.loadGeneration) return
    if (!catalog.ok) {
      this.set({ status: 'error', error: catalog.error })
      return
    }
    const options = backendOptions(catalog.value.backends)
    if (options.length === 0) {
      this.set({ status: 'unavailable', options: [] })
      return
    }
    this.set({
      status: 'ready',
      error: null,
      options,
      current: DEFAULT_AGENT_BACKEND,
      refusal: null,
    })
  }

  /**
   * Pick the backend the next session runs on.
   *
   * A backend that cannot start a session is refused with the reason the host
   * published, so the composer explains the limitation instead of silently
   * falling back to DSH.
   * @param id - the requested backend identity.
   * @returns the refusal text, or undefined once the pick settled.
   */
  async select(id: string): Promise<string | undefined> {
    const state = this.store.getSnapshot()
    const backend = state.options.find(option => option.id === id)
    if (backend === undefined) {
      const refusal = `unknown agent backend: ${id}`
      this.set({ refusal })
      return refusal
    }
    if (backend.availability !== 'ready') {
      const refusal = backend.reason ?? `${backend.name} backend is not configured`
      this.set({ refusal })
      return refusal
    }
    if (backend.id !== DEFAULT_AGENT_BACKEND) {
      // An external runtime answered, but sessions still bind to DSH: the
      // session-level backend binding is not part of this build, so the pick
      // is refused rather than recorded where nothing would honor it.
      const refusal = `${backend.name} sessions are not supported by this build yet`
      this.set({ refusal })
      return refusal
    }
    this.set({ current: backend.id, refusal: null })
    return undefined
  }

  /**
   * Acknowledge a displayed refusal.
   */
  dismissRefusal(): void {
    this.set({ refusal: null })
  }
}
