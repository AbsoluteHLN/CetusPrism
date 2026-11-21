/** Public catalog and selection rules for the three independent execution backends. */

import {
  locateExternalRuntime,
  type ExternalRuntimeId,
  type ExternalRuntimeLocatorOptions,
} from './external-runtime.ts'
import type {
  AgentBackendAvailability,
  AgentBackendCapabilities,
  AgentBackendCatalog,
  AgentBackendRow,
} from './types.ts'

/** Stable backend identities persisted by CetusPrism. */
export type BuiltinAgentBackendId = 'dsh' | 'pi' | 'zcode'

/** The external runtimes: Pi and ZCode are ONE mode with two upstreams. */
export type { ExternalRuntimeId, ExternalRuntimeLocatorOptions }

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
  /** Whether a runtime is installed at all; an absent runtime is unconfigured, not incompatible. */
  readonly installed: boolean
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
 * Build the provider for one external runtime.
 *
 * Pi and ZCode share this ONE adapter contract; only the upstream differs.
 * The provider locates the runtime the operator installed from the upstream's
 * own repository and reports what it found — it never downloads, bundles or
 * reconfigures the runtime.
 *
 * The probe spawns the runtime to read its version, so the answer is cached
 * for a short while: a catalog read must not block the host on a process
 * launch every time the composer refreshes.
 * @param id - the upstream identity.
 * @param options - an explicit executable path and the environment to probe with.
 * @returns a provider that answers the probe for that upstream.
 */
export function createExternalRuntimeProvider(
  id: ExternalRuntimeId,
  options: ExternalRuntimeLocatorOptions = {},
): BuiltinAgentBackendProvider {
  let cached: { readonly at: number; readonly probe: BuiltinAgentBackendProbe } | undefined
  return {
    id,
    describe(): BuiltinAgentBackendProbe {
      const now = Date.now()
      if (cached !== undefined && now - cached.at < PROBE_CACHE_MS) return cached.probe
      const probe = locateExternalRuntime(id, options)
      const answer: BuiltinAgentBackendProbe = {
        version: probe.version,
        source: probe.source,
        installed: probe.installed,
        compatible: probe.compatible,
        ...probe.reason === undefined ? {} : { reason: probe.reason },
      }
      cached = { at: now, probe: answer }
      return answer
    },
  }
}

/** How long one external-runtime probe stays fresh. */
const PROBE_CACHE_MS = 30_000

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
  /** The deployment's own discovery providers, shadowed by an explicit registration. */
  private readonly fallbacks = new Map<'pi' | 'zcode', BuiltinAgentBackendProvider>()
  /** The backend the next created session runs on. */
  private selected: BuiltinAgentBackendId = 'dsh'

  /**
   * Register the deployment's own discovery provider for one backend.
   *
   * Discovery is the DEFAULT answer: a plugin that registers an adapter
   * shadows it, and releasing that adapter hands the backend back to
   * discovery instead of leaving the backend unconfigured.
   * @param provider - the provider that finds the installed runtime.
   */
  discover(provider: BuiltinAgentBackendProvider): void {
    this.fallbacks.set(provider.id, provider)
  }

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
    const providers = new Map(this.fallbacks)
    for (const [id, provider] of this.providers) providers.set(id, provider)
    for (const [id, provider] of providers) {
      try {
        probes[id] = provider.describe()
      } catch (error) {
        // A failing probe leaves the backend visible and unusable rather than
        // removing it: the reason is what the composer shows.
        probes[id] = {
          version: 'unknown',
          source: 'external-runtime',
          installed: true,
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
    return { backends: this.catalog(), current: this.selected }
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

  /**
   * The backend the next created session runs on.
   *
   * The selection lives with the registry, not in the session: a session binds
   * its backend when it is created, and the binding it records in its log is
   * what a resume reads back. This selection therefore only decides what the
   * NEXT session binds.
   * @returns the selected backend identity.
   */
  current(): BuiltinAgentBackendId {
    return this.selected
  }

  /**
   * Choose the backend the next created session runs on.
   *
   * The pick is refused when the backend cannot start a session, so the
   * composer explains the limitation instead of recording a choice nothing
   * would honour.
   * @param id - requested backend identity.
   * @returns the selected backend.
   * @throws when the id is unknown or the backend cannot start a session.
   */
  select(id: string): AgentBackendRow {
    const backend = this.resolve(id)
    this.selected = backend.id
    return backend
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
  if (!probe.installed) {
    // No runtime on this machine: the deployment installed nothing, so the
    // choice stays hidden instead of offering a backend that cannot start.
    return {
      id,
      name,
      version: 'unconfigured',
      source: 'external-runtime',
      availability: 'unconfigured',
      ...(probe.reason === undefined ? {} : { reason: probe.reason }),
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
