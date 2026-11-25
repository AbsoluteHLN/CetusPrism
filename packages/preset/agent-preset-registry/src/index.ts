/** Declarative Agent capability sets, activation and session binding. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { bindScopeParent, createScope, scopeOf, scopeParentOf, type Scope, type ScopeKey, type ScopeParentBinding } from '@deepseek-ai/dsh-scope'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { dump } from 'js-yaml'
import type { Agent, AgentDriverFactory } from '@deepseek-ai/dsh-agent'
// Type-only: the optional `settings` service this registry keeps off the generated pages.
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import type { AgentBackendCatalog, AgentPresetDocument, AgentPresetRoster } from './types.ts'
import { entryListProblem, type PresetDefinition } from './definition.ts'
import type { AgentPreset, Config } from './preset.ts'
import { agentBackendProjectionDefinition, agentPresetProjectionDefinition } from './session.ts'
import { auditRows, leakedServices, mountPreset, serviceForMount, type PresetMount } from './mount.ts'
import { activeCompositionModules, definitionComposition, mountedCompositionRows, type AgentPresetComposition, type AgentPresetInspection } from './composition-inventory.ts'
import { BuiltinAgentBackendRegistry, createExternalRuntimeProvider, type BuiltinAgentBackendId, type BuiltinAgentBackendProvider } from './backend.ts'
import type { ExternalRuntimeId, ExternalRuntimeLocatorOptions } from './external-runtime.ts'
import { externalBackendDriver } from './backend-driver.ts'

export { agentBackendProjectionDefinition, agentPresetProjectionDefinition } from './session.ts'
export { entryListProblem, type PresetDefinition } from './definition.ts'
export { auditRows, leakedServices, livePresetMounts, type PresetMount, type RowAudit } from './mount.ts'
export type { AgentPresetInspection } from './composition-inventory.ts'
export type { AgentPreset, Config } from './preset.ts'
export {
  builtinAgentBackendCatalog,
  BuiltinAgentBackendRegistry,
  BuiltinAgentBackendSelectionError,
  createExternalRuntimeProvider,
  parseBuiltinAgentBackend,
  resolveBuiltinAgentBackend,
  type BuiltinAgentBackendAvailability,
  type BuiltinAgentBackendCapabilities,
  type BuiltinAgentBackendDescriptor,
  type BuiltinAgentBackendId,
  type BuiltinAgentBackendProbe,
  type BuiltinAgentBackendProvider,
} from './backend.ts'
export {
  compareVersions,
  EXTERNAL_RUNTIME_UPSTREAMS,
  formatRuntimeRequest,
  locateExternalRuntime,
  parseRuntimeFrame,
  type ExternalRuntimeAdapter,
  type ExternalRuntimeCapabilities,
  type ExternalRuntimeEvent,
  type ExternalRuntimeId,
  type ExternalRuntimeLocatorOptions,
  type ExternalRuntimeProbe,
  type ExternalRuntimeUpstream,
  type RuntimeErrorFrame,
  type RuntimeFrame,
  type RuntimeNotificationFrame,
  type RuntimeRequestFrame,
  type RuntimeRequestId,
  type RuntimeResponseFrame,
} from './external-runtime.ts'
export {
  PiRuntimeAdapter,
  type PiRuntimeAdapterOptions,
} from './external-runtime-pi.ts'
export {
  ZCodeRuntimeAdapter,
  type ZCodeRuntimeAdapterOptions,
} from './external-runtime-zcode.ts'
export {
  openRuntimeTransport,
  RuntimeRequests,
  type RuntimeTransport,
  type RuntimeTransportOptions,
} from './external-runtime-transport.ts'
export {
  BaseExternalAgentDriver,
  ExternalAgentDriver,
  type BaseExternalAgentDriverOptions,
  type ExternalAgentDriverOptions,
} from './external-agent-driver.ts'
export {
  createPiLoopDriver,
  PiAgentDriver,
  PiLoopAgent,
  type PiAgentDriverOptions,
  type PiLoopAgentOptions,
} from './pi-loop-agent.ts'
export {
  createZCodeLoopDriver,
  ZCodeAgentDriver,
  ZCodeLoopAgent,
  type ZCodeAgentDriverOptions,
  type ZCodeLoopAgentOptions,
} from './zcode-loop-agent.ts'
export {
  BUILTIN_AGENT_PROTOCOL_VERSION,
  BUILTIN_AGENT_RELEASE,
  BuiltinAgentConfigError,
  BuiltinAgentConfigStore,
  defaultBuiltinAgentDirectory,
  defineBuiltinAgent,
  validateBuiltinAgentConfig,
  type BuiltinAgentCompatibility,
  type BuiltinAgentConfig,
  type BuiltinAgentConfigInput,
  type BuiltinAgentDeclaration,
  type BuiltinAgentDriver,
  type BuiltinAgentId,
} from './builtin-agent.ts'
export {
  prepareBuiltinAgent,
  resolveBuiltinAgent,
  type BuiltinAgentCapabilities,
  type BuiltinAgentExecutionResult,
  type BuiltinAgentRequest,
  type PreparedBuiltinAgent,
} from './builtin-agent-adapter.ts'
export {
  assertUpstreamSource,
  CommandFailure,
  installExternalRuntimeFromSource,
  type ExternalRuntimeSourceRecipe,
  type SourceBuildOptions,
  type SourceBuildReceipt,
} from './source-build.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentPresets: AgentPresetRegistry
  }
}

interface Generation {
  scope: Scope
  key: ScopeKey
  mount: PresetMount
  users: number
  retired: boolean
}
interface Definition {
  config: PresetDefinition
  context: Context
  ready: Promise<void>
  generation?: Generation
  /** Mount failure; unset while a tree is mounted, whose rows {@link AgentPresetRegistry.diagnostic} re-audits on read. */
  broken?: string
}
interface Binding {
  parent: ScopeParentBinding
  generation: Generation
}

/** Registry of YAML-declared presets and the revisions live Agents retain. */
export class AgentPresetRegistry extends TypertRemoteService {
  static inject = ['loader', 'sessionProjections']
  static Config = z.object({
    default: z.string().required(),
    selectedDefault: z.string().volatile(),
    externalRuntimes: z.object({
      pi: z.string(),
      zcode: z.string(),
    }).default({}).volatile(),
  })
  private readonly owner: Context
  private readonly definitions = new Map<string, Definition>()
  private readonly generations = new Map<ScopeKey, Generation>()
  private readonly bindings = new WeakMap<ScopeKey, Binding>()
  private readonly switches = new Map<string, Promise<unknown>>()
  /** Execution backends: DSH plus every registered external runtime. */
  private readonly backends = new BuiltinAgentBackendRegistry()
  /** The locator options each external runtime was discovered with; the driver spawns with the same executable. */
  private readonly runtimeOptions = new Map<ExternalRuntimeId, ExternalRuntimeLocatorOptions>()

  public readonly config: Config

  constructor(ctx: Context, config: Config) {
    super(ctx, 'agentPresets')
    this.config = config
    this.owner = ctx
    ctx.sessionProjections.register(agentPresetProjectionDefinition)
    ctx.sessionProjections.register(agentBackendProjectionDefinition)
    ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'agent-preset/selected') ctx.emit('agent-preset/selected', session.id, event.data.agentPreset)
    })
    // The external runtimes are DISCOVERED, never fetched: the operator
    // installs them from their own repositories. Discovering them here is what
    // makes the catalog tell the truth — without a discovery Pi and ZCode
    // stayed permanently `unconfigured` and the composer never offered them.
    this.syncRuntimes()
  }

  /**
   * Bring the discovered providers in line with the deployment's configuration.
   *
   * The configuration is live: the operator may point a runtime at an
   * executable the PATH does not carry, and that change has to take effect
   * without a restart. A provider is rebuilt whenever the executable it
   * probes changes, which also drops the probe cache — a freshly named
   * executable is probed at once, not thirty seconds later.
   */
  private syncRuntimes(): void {
    const raw = this.config.externalRuntimes as unknown
    const commands = (typeof (raw as { get?: () => unknown })?.get === 'function'
      ? (raw as { get: () => Record<string, string | undefined> }).get()
      : raw as Record<string, string | undefined>) ?? {}
    for (const id of ['pi', 'zcode'] as const) {
      const command = commands[id]
      const named = command !== undefined && command.trim().length > 0
      const options: ExternalRuntimeLocatorOptions = named ? { command } : {}
      const current = this.runtimeOptions.get(id)
      if (current !== undefined && current.command === options.command) continue
      this.runtimeOptions.set(id, options)
      this.backends.discover(createExternalRuntimeProvider(id, options))
    }
  }

  /** Default preset for a subsequently created session. */
  get defaultId(): string {
    const selected = typeof (this.config.selectedDefault as unknown as { get?: () => string })?.get === 'function'
      ? (this.config.selectedDefault as unknown as { get: () => string }).get()
      : this.config.selectedDefault as unknown as string
    return selected ?? this.config.default
  }

  /**
   * Register an installed runtime as an execution backend.
   *
   * This is the one entry an external runtime uses: the adapter answers a
   * probe, and CetusPrism keeps no credential, private configuration or
   * runtime file for it.
   * @param provider - the adapter that owns the runtime.
   * @returns a disposer that removes this registration.
   */
  registerBackend(provider: BuiltinAgentBackendProvider): () => void {
    return this.backends.register(provider)
  }

  /**
   * Read the execution backends this deployment offers.
   * @returns DSH first, then every external backend with its current state.
   */
  @Remote('backends')
  remoteExportBackends(): AgentBackendCatalog {
    this.syncRuntimes()
    return this.backends.wireCatalog()
  }

  /**
   * The backend the next created session runs on.
   *
   * A session binds its backend when it is created, and the binding it
   * records in its own log is what a resume reads back. This selection
   * therefore decides what the NEXT session binds, nothing else.
   * @returns the selected backend identity.
   */
  currentBackend(): BuiltinAgentBackendId {
    return this.backends.current()
  }

  /**
   * Choose the backend the next created session runs on.
   *
   * The pick is refused when the backend cannot start a session: the composer
   * explains the limitation instead of recording a choice nothing would
   * honour.
   * @param agentBackend - requested backend identity.
   * @returns the committed backend identity.
   */
  @Remote('selectBackend')
  selectBackend(agentBackend: string): string {
    this.syncRuntimes()
    try {
      return this.backends.select(agentBackend).id
    } catch (error: unknown) {
      throw new RemoteError('agent-backend/unavailable', error instanceof Error ? error.message : String(error), { agentBackend })
    }
  }

  /**
   * The Agent driver factory for one execution backend.
   *
   * The native backend owns no driver factory: omitting the driver builds the
   * factory's default React loop, which IS the DSH backend. An external
   * backend hands the Agent lifecycle to its own runtime, and the returned
   * factory is what the session factory binds for the session's whole life.
   * @param backend - the backend identity.
   * @returns the driver factory, or undefined for the native backend.
   */
  backendDriver(backend: BuiltinAgentBackendId): AgentDriverFactory | undefined {
    if (backend === 'dsh') return undefined
    this.syncRuntimes()
    const row = this.backends.catalog().find(candidate => candidate.id === backend)
    // A backend that cannot start a session owns no driver: the composer
    // refuses the pick, and a resume falls back instead of spawning a runtime
    // the probe already reported as missing or incompatible.
    if (row === undefined || row.availability !== 'ready') return undefined
    return externalBackendDriver(backend, {
      ...this.runtimeOptions.get(backend),
      ...(row.version === undefined || row.version === 'unknown' ? {} : { version: row.version }),
    })
  }

  /** Register and eagerly load a definition; activation failure remains visible in the roster.
   * @param definition Parsed configuration supplied by the declaring plugin.
   * @returns Definition disposer after activation or its diagnostic settles; the declaring plugin owns it.
   */
  async register(definition: PresetDefinition): Promise<() => Promise<void>> {
    const context = this.ctx
    if (!definition.id.trim()) throw new Error('Preset id must not be empty')
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate agent preset: ${definition.id}`)
    const record: Definition = { config: definition, context, ready: Promise.resolve() }
    this.definitions.set(definition.id, record)
    let disposed = false
    const unregister = async (): Promise<void> => {
      if (disposed) return
      disposed = true
      this.definitions.delete(definition.id)
      await record.ready
      if (record.generation !== undefined) {
        record.generation.retired = true
        await this.collect(record.generation)
      }
    }
    record.ready = this.activate(record)
    await record.ready
    return unregister
  }

  private async activate(record: Definition): Promise<void> {
    const key = {}
    const scope = createScope(this.owner, key)
    try {
      const problem = entryListProblem(record.config.plugins)
      if (problem !== undefined) throw new Error(problem)
      const context = scope.ctx.extend({ baseUrl: record.context.baseUrl })
      const mount = await mountPreset(context, record.config.id, record.config.plugins)
      const generation: Generation = { scope, key, mount, users: 0, retired: false }
      context.effect(() => {
        this.generations.set(key, generation)
        return () => { this.generations.delete(key) }
      }, 'agent-preset.mount')
      record.generation = generation
    } catch (error) {
      record.broken = (error as Error).message
      this.owner.logger.warn(`agent preset ${record.config.id}: ${record.broken}`)
      await scope.dispose()
    }
  }

  /**
   * Current activation diagnostic of a definition.
   *
   * A mount failure is final. A mounted tree is re-audited on every read: a
   * row waiting for a Host service activates by itself once that provider
   * finishes, so the audit waits for the Host Loader tree to settle before
   * reporting the row as unusable. Callers therefore must not run inside a
   * Host row's own activation, which the settlement would wait on.
   * @param record - the definition to audit.
   * @returns one line per unusable row, or undefined when the definition is usable.
   */
  private async diagnostic(record: Definition): Promise<string | undefined> {
    await record.ready
    if (record.generation === undefined) return record.broken
    const tree = record.generation.mount.tree
    let audit = await auditRows(tree)
    if (audit.pending.length > 0) {
      await this.owner.loader.await()
      audit = await auditRows(tree)
    }
    const lines = [...audit.failed, ...audit.pending]
    return lines.length === 0 ? undefined : lines.join('\n')
  }

  private async collect(generation: Generation): Promise<void> {
    if (!generation.retired || generation.users !== 0) return
    this.generations.delete(generation.key)
    await generation.scope.dispose()
  }

  private generationFor(ctx: Context): Generation | undefined {
    const key = scopeOf(ctx)
    const parent = key === undefined ? undefined : scopeParentOf(key)
    return parent === undefined ? undefined : this.generations.get(parent)
  }

  /** Inspect retained revisions, or the exact revision an Agent joined.
   * @param ctx - optional Agent context; omission includes all retained revisions.
   * @returns detached module references and isolation diagnostics; no match returns an empty list.
   */
  inspectCompositions(ctx?: Context): AgentPresetInspection[] {
    const joined = ctx === undefined ? undefined : this.generationFor(ctx)
    const generations = ctx === undefined ? [...this.generations.values()] : joined === undefined ? [] : [joined]
    return generations.map(({ mount }) => ({
      id: mount.presetId,
      modules: activeCompositionModules(mount.tree),
      leakedServices: leakedServices(this.owner, mount.fiber),
    }))
  }

  /** Read every declared preset, including activation failures.
   * @returns Display metadata and loading diagnostics.
   */
  async list(): Promise<AgentPreset[]> {
    const rows = await Promise.all([...this.definitions.values()].map(async (record) => {
      const broken = await this.diagnostic(record)
      return {
        id: record.config.id,
        ...(record.config.name === undefined ? {} : { name: record.config.name }),
        ...(record.config.description === undefined ? {} : { description: record.config.description }),
        ...(record.config.order === undefined ? {} : { order: record.config.order }),
        ...(broken === undefined ? {} : { broken }),
      }
    }))
    return rows.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.id.localeCompare(b.id))
  }

  /** Read the selection roster.
   * @returns Current presets, each marked when it is the default.
   */
  @Remote('list')
  async remoteExportList(): Promise<AgentPresetRoster> {
    const defaultId = this.defaultId
    return { presets: (await this.list()).map(row => ({ ...row, isDefault: row.id === defaultId })) }
  }

  /** Resolve an identity without starting an Agent.
   * @param id Explicit preset or the current default.
   * @returns Current metadata, including failure when activation failed.
   */
  async resolve(id?: string): Promise<AgentPreset> {
    const wanted = id ?? this.defaultId
    const record = this.definitions.get(wanted)
    if (record === undefined) throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`,
      { agentPreset: wanted, available: [...this.definitions.keys()] })
    const broken = await this.diagnostic(record)
    return { id: wanted, ...(broken === undefined ? {} : { broken }) }
  }

  /** Read one declaration's child plugin list as YAML, for viewing only.
   * @param agentPreset Preset identity.
   * @returns The declared composition beside its published metadata.
   */
  @Remote('read')
  readDocument(agentPreset: string): Promise<AgentPresetDocument> {
    const record = this.definitions.get(agentPreset)
    if (record === undefined) {
      return Promise.reject(new RemoteError('agent-preset/not-found', `Unknown agent preset: ${agentPreset}`,
        { agentPreset, available: [...this.definitions.keys()] }))
    }
    const { id, name, description, plugins } = record.config
    // The Loader's own dialect, so `!!js` conditions read as declared rather than as expression objects.
    const content = dump(plugins, { schema: entryListSchema, noRefs: true, lineWidth: -1 })
    return Promise.resolve({
      agentPreset: id, content, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }),
    })
  }

  private async retain(id?: string): Promise<Generation> {
    const wanted = id ?? this.defaultId
    while (true) {
      const record = this.definitions.get(wanted)
      if (record === undefined) throw new RemoteError('agent-preset/not-found', `Unknown agent preset: ${wanted}`,
        { agentPreset: wanted, available: [...this.definitions.keys()] })
      const broken = await this.diagnostic(record)
      if (this.definitions.get(wanted) !== record) continue
      const generation = record.generation
      if (broken !== undefined || generation === undefined) {
        const reason = broken as string
        throw new RemoteError('agent-preset/invalid', reason, { agentPreset: wanted, reason })
      }
      generation.users++
      return generation
    }
  }

  private async bind(ctx: Context, generation: Generation): Promise<void> {
    const key = scopeOf(ctx)
    if (key === undefined) throw new Error('Agent preset binding requires a scoped context')
    const binding = this.bindings.get(key)
    if (binding?.generation === generation) return
    if (binding !== undefined) {
      binding.parent.rebind(generation.key)
      const old = binding.generation
      generation.users++
      binding.generation = generation
      old.users--
      await this.collect(old)
    } else this.join(ctx, key, generation)
  }

  private join(ctx: Context, key: ScopeKey, generation: Generation): void {
    const binding = { parent: bindScopeParent(key, generation.key), generation }
    generation.users++
    this.bindings.set(key, binding)
    ctx.effect(() => async () => {
      this.bindings.delete(key)
      binding.generation.users--
      await this.collect(binding.generation)
    }, 'agent-preset.binding')
  }

  /** Bind an unpublished Agent to the current preset revision.
   * @param ctx Agent context from its setup callback.
   * @param id Requested preset, or the default.
   * @returns Bound preset identity.
   */
  async mount(ctx: Context, id?: string): Promise<AgentPreset> {
    const generation = await this.retain(id)
    try {
      await this.bind(ctx, generation)
      return { id: generation.mount.presetId }
    } finally {
      generation.users--
      await this.collect(generation)
    }
  }

  /** Join a child to the exact revision retained by its parent.
   * @param ctx Child Agent context.
   * @param parent Parent Agent context.
   * @returns Inherited preset id, or undefined in a preset-free composition.
   */
  composeFrom(ctx: Context, parent: Context): string | undefined {
    const generation = this.generationFor(parent)
    if (generation === undefined) {
      if (parent.get('agentPresets')?.composedPreset(parent) !== undefined) {
        throw new Error('Parent preset revision is unavailable')
      }
      return undefined
    }
    // A child has no existing binding, so this path has no asynchronous cleanup.
    const key = scopeOf(ctx)
    if (key === undefined) throw new Error('Child preset binding requires a scope')
    if (this.bindings.has(key)) throw new Error('Child already joined a preset')
    this.join(ctx, key, generation)
    return generation.mount.presetId
  }

  /** Read the preset a live Agent uses.
   * @param ctx Agent context.
   * @returns Its preset id, if bound.
   */
  composedPreset(ctx: Context): string | undefined { return this.generationFor(ctx)?.mount.presetId }

  /** Read a service supplied inside an Agent's isolated preset group.
   * @param agent Agent whose composition is queried.
   * @param name Cordis service name.
   * @returns The service, or undefined.
   */
  serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined {
    const mount = this.generationFor(agent.ctx)?.mount
    return mount === undefined ? undefined : serviceForMount(this.owner, mount, name)
  }

  /** Rebind a blank Agent; the caller owns the blank-session check.
   * @param ctx Agent context.
   * @param id Requested preset.
   * @returns The bound identity.
   */
  async recompose(ctx: Context, id: string): Promise<AgentPreset> {
    const preset = await this.mount(ctx, id)
    try { this.owner.emit('tools/change') }
    catch (error) { this.owner.logger.warn(`Preset tools observer: ${String(error)}`) }
    return preset
  }

  /** Select a preset before a session starts its first turn.
   * @param agent Target Agent.
   * @param agentPreset Requested identity.
   * @returns Committed preset identity.
   */
  @Remote('select')
  async select(agent: Agent, agentPreset: string): Promise<string> {
    const turn = (this.switches.get(agent.id) ?? Promise.resolve()).then(async () => {
      const boundary = this.owner.sessionProjections.stateOf(agent.session, 'turnBoundary')
      if (boundary !== undefined && (boundary.openTurnStartSeq !== null || boundary.lastTurn > 0)) {
        throw new RemoteError('agent-preset/locked', 'This session has already started', { sessionId: agent.id, agentPreset })
      }
      const preset = await this.recompose(agent.ctx, agentPreset)
      agent.session.append('agent-preset/selected', { agentPreset: preset.id })
      return preset.id
    })
    const guard = turn.catch(() => undefined)
    this.switches.set(agent.id, guard)
    try { return await turn } finally {
      if (this.switches.get(agent.id) === guard) this.switches.delete(agent.id)
    }
  }

  /** Read current registrations for cold transcript presentation.
   * @param id Preset identity or the default.
   * @returns A revision lease; dispose it after the scoped read completes.
   */
  async acquireScope(id?: string): Promise<{ key: ScopeKey } & AsyncDisposable> {
    const generation = await this.retain(id)
    let disposed = false
    return { key: generation.key, [Symbol.asyncDispose]: async () => {
      if (disposed) return
      disposed = true
      generation.users--
      await this.collect(generation)
    } }
  }

  /** Read plugin rows without creating an Agent.
   * @returns Current declaration metadata and activation states.
   */
  compositionInventory(): Promise<AgentPresetComposition[]> {
    return Promise.all([...this.definitions.values()].map(async (record) => {
      const { id, name, description } = record.config
      const broken = await this.diagnostic(record)
      const read = definitionComposition(record.config.plugins, () => { throw new Error('Inactive definition') })
      return { id, ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }),
        isDefault: id === this.defaultId,
        ...(broken === undefined ? {} : { broken }),
        rows: record.generation === undefined ? ('rows' in read ? read.rows : []) : mountedCompositionRows(record.generation.mount.tree) }
    }))
  }
}
export default AgentPresetRegistry
