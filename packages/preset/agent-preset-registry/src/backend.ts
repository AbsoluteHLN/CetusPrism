/** Public catalog and selection rules for the three independent execution backends. */

import type {
  AgentBackendAvailability,
  AgentBackendCapabilities,
  AgentBackendCatalog,
  AgentBackendRow,
} from './types.ts'

/** Stable backend identities persisted by CetusPrism. */
export type BuiltinAgentBackendId = 'dsh' | 'pi' | 'zcode'

/** Availability reported without inspecting provider credentials or private runtime state. */
export type { AgentBackendAvailability as BuiltinAgentBackendAvailability }

/** Capability facts shown before a new session is created. */
export type { AgentBackendCapabilities as BuiltinAgentBackendCapabilities }

/** One backend row in the composer and settings catalog. */
export type { AgentBackendRow as BuiltinAgentBackendDescriptor }

/** A probe result supplied by an external runtime adapter. */
export interface BuiltinAgentBackendProbe {
  readonly version: string
  readonly source: string
  readonly compatible: boolean
  readonly reason?: string
}

/**
 * An installed runtime that can execute an Agent on its own backend.
 *
 * The adapter answers a probe and nothing else. It does not hand CetusPrism
 * credentials, private configuration, or runtime files, and CetusPrism never
 * reads them either: the probe result is the whole contract.
 */
export interface BuiltinAgentBackendProvider {
  /** Which backend this adapter implements. */
  readonly id: 'pi' | 'zcode'
  /**
   * Describe the installed runtime.
   * @returns the version, its source and whether CetusPrism can speak to it.
   */
  describe(): BuiltinAgentBackendProbe
}

/** Invalid or unavailable backend selection. */
export class BuiltinAgentBackendSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuiltinAgentBackendSelectionError'
  }
}

/** The native backend: CetusPrism's own Agent loop. */
const DSH_BACKEND: AgentBackendRow = {
  id: 'dsh',
  name: 'DSH',
  version: 'native',
  source: 'cetusprism',
  availability: 'ready',
  capabilities: { cancel: true, resume: true, tools: true, modelRouting: 'cetus' },
}

/**
 * Build the user-visible catalog without discovering credentials or private files.
 * @param probes - explicit results from installed external adapters.
 * @returns the three independent backends in composer order.
 */
export function builtinAgentBackendCatalog(
  probes: Partial<Record<'pi' | 'zcode', BuiltinAgentBackendProbe>> = {},
): readonly AgentBackendRow[] {
  return [DSH_BACKEND, externalBackend('pi', 'Pi', probes.pi), externalBackend('zcode', 'ZCode', probes.zcode)]
}

/**
 * Validate one selection against the current catalog.
 * @param id - requested backend identity.
 * @param catalog - current capability catalog.
 * @returns the selected descriptor.
 * @throws when the id is unknown or the backend is unavailable.
 */
export function resolveBuiltinAgentBackend(
  id: string,
  catalog: readonly AgentBackendRow[] = builtinAgentBackendCatalog(),
): AgentBackendRow {
  const backend = catalog.find(candidate => candidate.id === id)
  if (backend === undefined) throw new BuiltinAgentBackendSelectionError(`unknown agent backend: ${id}`)
  if (backend.availability !== 'ready') {
    throw new BuiltinAgentBackendSelectionError(backend.reason ?? `${backend.name} backend is not configured`)
  }
  return backend
}

/**
 * Return the persisted default, retaining DSH compatibility for older files.
 * @param value - untrusted persisted value.
 * @returns a supported backend id.
 */
export function parseBuiltinAgentBackend(value: unknown): BuiltinAgentBackendId {
  if (value === undefined) return 'dsh'
  if (value === 'dsh' || value === 'pi' || value === 'zcode') return value
  throw new BuiltinAgentBackendSelectionError(`agent backend must be dsh, pi, or zcode; received ${String(value)}`)
}

/**
 * The execution backends a deployment offers, plus the entry external runtimes
 * register through.
 *
 * DSH is always present and always ready: it is CetusPrism's own Agent loop.
 * Pi and ZCode appear only after an adapter registers, and until then they
 * stay visible as unconfigured rather than disappearing, so the composer can
 * explain why they cannot start instead of hiding the option.
 */
export class BuiltinAgentBackendRegistry {
  private readonly providers = new Map<'pi' | 'zcode', BuiltinAgentBackendProvider>()

  /**
   * Register an installed runtime as one execution backend.
   *
   * Registering the same backend twice replaces the earlier adapter, and the
   * earlier disposer stays valid: it removes whatever it registered.
   * @param provider - the adapter that owns the runtime.
   * @returns a disposer that removes this registration.
   */
  register(provider: BuiltinAgentBackendProvider): () => void {
    const previous = this.providers.get(provider.id)
    this.providers.set(provider.id, provider)
    return () => {
      const current = this.providers.get(provider.id)
      if (current !== provider) {
        // A later registration already replaced this one; only that one may remove it.
        if (previous !== undefined) this.providers.set(provider.id, previous)
        return
      }
      this.providers.delete(provider.id)
    }
  }

  /**
   * The current catalog, in composer order.
   * @returns DSH first, then every external backend and its current state.
   */
  catalog(): readonly AgentBackendRow[] {
    const probes: Partial<Record<'pi' | 'zcode', BuiltinAgentBackendProbe>> = {}
    for (const [id, provider] of this.providers) {
      try {
        probes[id] = provider.describe()
      } catch (error) {
        // A failing probe leaves the backend visible and unusable rather than
        // removing it: the reason is what the composer shows.
        probes[id] = {
          version: 'unknown',
          source: 'external-runtime',
          compatible: false,
          reason: error instanceof Error ? error.message : String(error),
        }
      }
    }
    return builtinAgentBackendCatalog(probes)
  }

  /**
   * The catalog as a client reads it.
   * @returns the wire shape of the current catalog.
   */
  wireCatalog(): AgentBackendCatalog {
    return { backends: this.catalog() }
  }

  /**
   * Resolve one selection against the current catalog.
   * @param id - requested backend identity.
   * @returns the selected backend.
   * @throws when the id is unknown or the backend cannot start a session.
   */
  resolve(id: string): AgentBackendRow {
    return resolveBuiltinAgentBackend(id, this.catalog())
  }
}

function externalBackend(
  id: 'pi' | 'zcode',
  name: string,
  probe: BuiltinAgentBackendProbe | undefined,
): AgentBackendRow {
  if (probe === undefined) {
    return {
      id,
      name,
      version: 'unconfigured',
      source: 'external-runtime',
      availability: 'unconfigured',
      reason: `${name} runtime is not configured`,
      capabilities: { cancel: false, resume: false, tools: false, modelRouting: 'external-runtime' },
    }
  }
  return {
    id,
    name,
    version: probe.version,
    source: probe.source,
    availability: probe.compatible ? 'ready' : 'incompatible',
    ...(probe.reason === undefined ? {} : { reason: probe.reason }),
    capabilities: { cancel: probe.compatible, resume: probe.compatible, tools: probe.compatible, modelRouting: 'external-runtime' },
  }
}
