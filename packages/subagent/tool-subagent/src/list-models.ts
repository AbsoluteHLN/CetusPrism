/** Model-facing discovery of LLM routes available to child Agents. */

import type { Context } from '@deepseek-ai/cordis'
import type LlmRuntime from '@deepseek-ai/dsh-llm'
import type { LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AllowedModelRoute, ModelSelectionPolicy } from './model-selection.ts'

interface ListSubagentModelsRequest {
  readonly provider?: string
  readonly model?: string
}

/** Resolve one registered provider with a model-correctable diagnostic. */
function registeredProvider(
  llm: LlmRuntime,
  policy: ModelSelectionPolicy,
  providerId: string,
): LlmProviderInfo {
  const providers = llm.listProviders()
  const provider = providers.find(candidate => candidate.id === providerId)
  if (provider !== undefined) return provider
  const available = providers
    .filter(candidate => policy.routes.some(route => route.provider === candidate.id))
    .map(candidate => candidate.id)
    .join(', ') || '(none)'
  throw new Error(`LLM provider "${providerId}" is not registered; available providers: ${available}`)
}

/** Render one advertised or resolved model. */
function modelLine(provider: string, model: { id: string; name: string; description?: string }): string {
  return `${provider}/${model.id} — ${model.name}${model.description === undefined ? '' : `: ${model.description}`}`
}

/** Read the requested provider, advertised models, or exact-model efforts. */
async function listSubagentModels(
  ctx: Context,
  policy: ModelSelectionPolicy,
  request: ListSubagentModelsRequest,
  signal: AbortSignal,
): Promise<string> {
  const llm = ctx.get('llm')
  if (llm === undefined) {
    throw new Error('cannot discover child LLM routes because the `llm` service is unavailable')
  }
  if (request.model !== undefined && request.provider === undefined) {
    throw new Error('`model` requires `provider`')
  }
  if (request.provider === undefined) {
    const providers = llm.listProviders()
      .filter(provider => policy.routes.some(route => route.provider === provider.id))
    return providers.length === 0
      ? '(no LLM providers)'
      : providers.map(provider => `${provider.id} — ${provider.name}`).join('\n')
  }
  if (request.provider.length === 0) throw new Error('`provider` must be non-empty')
  const allowedRoutes = policy.routes.filter(route => route.provider === request.provider)
  if (allowedRoutes.length === 0) {
    throw new Error(`LLM provider "${request.provider}" is not allowed for this Session`)
  }
  const provider = registeredProvider(llm, policy, request.provider)
  if (request.model === undefined) {
    const models = (await llm.listModels(provider.id))
      .filter(model => allowedRoutes.some(route => route.model === model.id))
    return models.length === 0
      ? `(no advertised models for ${provider.id})`
      : models.map(model => modelLine(provider.id, model)).join('\n')
  }
  if (request.model.length === 0) throw new Error('`model` must be non-empty')
  if (!allowedRoutes.some(route => route.model === request.model)) {
    throw new Error(`child LLM route "${provider.id}/${request.model}" is not allowed for this Session`)
  }
  const model = await llm.resolveModelInfo(provider.id, request.model, signal)
  const efforts = model.reasoning?.efforts.map(effort => (
    `${effort.id}${model.reasoning?.defaultEffort === effort.id ? ' (default)' : ''} — ${effort.name}`
    + (effort.description === undefined ? '' : `: ${effort.description}`)
  )).join('\n') || '(no advertised reasoning efforts)'
  return `${modelLine(provider.id, model)}\nReasoning efforts:\n${efforts}`
}

/** One scope's contribution to the shared discovery policy. */
interface Contributor {
  /** Context whose lifetime bounds this contribution. */
  readonly ctx: Context
  /** Route policy or its current-value reader for this Session. */
  readonly policySource: ModelSelectionPolicy | (() => ModelSelectionPolicy)
}

/**
 * One registration scope's discovery state: the single tool registration plus
 * every policy that narrows it.
 */
interface ScopeState {
  /** Live contributors, in registration order. */
  readonly contributors: Set<Contributor>
  /** Context that owns the scope's single tool registration. */
  owner: Context | undefined
  /** Disposer of the scope's single tool registration. */
  disposeTool: (() => void) | undefined
}

/**
 * Registry key shared by every build of this package.
 *
 * The package ships two entry points — the package entry and the standalone
 * `list-models` entry — and each build carries its own module scope.
 */
const kScopeStates = Symbol.for('dsh.tool-subagent.discovery.scope-states')

/** Process-wide holder for the per-scope discovery states. */
const scopeStateRegistry = globalThis as unknown as Record<symbol, WeakMap<object, ScopeState> | undefined>

/**
 * Per-scope discovery state. The key is the scope's registration identity, so
 * two plugins that contribute to one Agent scope share one state — and one
 * tool registration — while separate scopes stay independent.
 *
 * The state lives on the process-wide registry rather than in this module:
 * the package is built into two entry points, each with its own module scope,
 * so a module-level map would hand the delegation tool and the Agent Team one
 * state each. Both would then register the same tool name into the same Agent
 * scope, and the second registration would fail as a duplicate.
 */
const scopeStates: WeakMap<object, ScopeState> = (scopeStateRegistry[kScopeStates]
  ??= new WeakMap<object, ScopeState>())

/**
 * Identify the registration scope one discovery tool belongs to.
 * @param ctx - Context whose scope tag names the registration layer.
 * @returns The scope key, or the root context for an unscoped registration.
 */
function scopeKeyOf(ctx: Context): object {
  return scopeOf(ctx) ?? ctx.root
}

/**
 * Read the routes every contributor of one scope authorizes.
 *
 * The intersection is computed per call, not per registration: a contributor
 * may narrow its own policy at any time (a Team restriction list is live), and
 * the tool must answer with the routes that are still authorized.
 * @param state - One scope's live contributors.
 * @returns The routes all contributors allow, in first-contributor order.
 */
function effectiveRoutes(state: ScopeState): readonly AllowedModelRoute[] {
  let routes: readonly AllowedModelRoute[] | undefined
  for (const contributor of state.contributors) {
    const policy = typeof contributor.policySource === 'function' ? contributor.policySource() : contributor.policySource
    routes = routes === undefined
      ? policy.routes
      : routes.filter(route => policy.routes.some(candidate =>
        candidate.provider === route.provider && candidate.model === route.model))
  }
  return routes ?? []
}

/**
 * Build the fixed discovery definition for one scope.
 * @param ctx - Context whose tool registry owns the definition and whose services it reads.
 * @param state - One scope's live contributors.
 * @returns A registry-ready definition.
 */
function discoveryTool(ctx: Context, state: ScopeState): ToolDefinition {
  return defineTool({
    name: 'list_subagent_models',
    description:
      'Discover LLM routes for subagents without changing the current Agent. Call with no arguments to list '
      + 'registered providers, with `provider` to list its advertised models, or with `provider` and `model` '
      + 'to inspect that exact model and its reasoning efforts. Catalog membership is advisory: an adapter may '
      + 'accept an unlisted model id. Use the returned ids with a delegation tool\'s `provider`, `model`, and '
      + '`reasoning_effort` fields.',
    parameters: {
      provider: {
        type: 'string',
        description: 'Registered LLM provider id. Omit to list providers.',
      },
      model: {
        type: 'string',
        description: 'Exact model id to inspect. Requires provider; omit to list that provider\'s advertised models.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, result) => [{ type: 'text', text: result }],
    },
    execute(args, exec) {
      return listSubagentModels(ctx, { routes: effectiveRoutes(state) }, args, exec.signal)
    },
  })
}

/**
 * Drop one contribution and keep the scope's single registration consistent.
 *
 * A departing contributor loses its policy at once. The registration moves to
 * a surviving contributor when its owner leaves, so the tool stays visible for
 * the policies that remain; the last departure releases the registration.
 * @param key - The scope key the contribution belonged to.
 * @param contributor - The contribution being withdrawn.
 */
function removeContributor(key: object, contributor: Contributor): void {
  const state = scopeStates.get(key)
  if (state === undefined) return
  if (!state.contributors.delete(contributor)) return
  const successor = state.contributors.values().next().value
  if (successor === undefined) {
    state.disposeTool?.()
    state.disposeTool = undefined
    state.owner = undefined
    scopeStates.delete(key)
    return
  }
  if (state.owner !== contributor.ctx) return
  state.disposeTool?.()
  state.owner = successor.ctx
  try {
    state.disposeTool = successor.ctx.tools.register(discoveryTool(successor.ctx, state))
  } catch {
    // The surviving context is already unloading, so it cannot own a new
    // registration; the scope goes down with it.
    state.disposeTool = undefined
  }
}

/**
 * Register `list_subagent_models` for one owning delegation-tool instance.
 *
 * The tool name belongs to the registration scope, not to one caller: several
 * plugins may own discovery in the same Agent scope (a delegation tool and an
 * Agent Team), so the scope keeps one registration and intersects the policies
 * its callers contribute. The effective routes are read at every call, so a
 * live restriction narrows the catalog without a re-registration.
 * @param ctx - Context whose tool registry owns the fixed discovery definition.
 * @param policySource - Route policy or its current-value reader for this Session.
 * @returns A disposer withdrawing this caller's contribution.
 */
export function registerListSubagentModels(
  ctx: Context,
  policySource: ModelSelectionPolicy | (() => ModelSelectionPolicy),
): () => void {
  const key = scopeKeyOf(ctx)
  const state = scopeStates.get(key) ?? { contributors: new Set<Contributor>(), owner: undefined, disposeTool: undefined }
  scopeStates.set(key, state)
  const contributor: Contributor = { ctx, policySource }
  state.contributors.add(contributor)
  if (state.disposeTool === undefined) {
    state.owner = ctx
    state.disposeTool = ctx.tools.register(discoveryTool(ctx, state))
  }
  // The contribution leaves with its own context even when the caller drops
  // the disposer, so a scope never keeps a policy whose owner is gone.
  const release = ctx.effect(function* () {
    yield () => { removeContributor(key, contributor) }
  }, 'list_subagent_models.contribution()')
  let withdrawn = false
  return () => {
    if (withdrawn) return
    withdrawn = true
    void release()
    removeContributor(key, contributor)
  }
}
