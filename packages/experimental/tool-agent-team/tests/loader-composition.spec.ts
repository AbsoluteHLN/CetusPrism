/** Exercise the shipped Agent Team model-discovery path through a real Loader tree. */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as toolSubagent from '@deepseek-ai/dsh-tool-subagent'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import TeamService from '../../agent-team/src/index.ts'
import * as toolTeam from '../src/index.ts'

const roots: string[] = []
const contexts = new Set<Context>()

class TestSessionQuery extends SessionQueryEngine {
  override searchSessions(): Promise<never> {
    return Promise.reject(new Error('session search is not configured in this test'))
  }

  override searchEvents(): Promise<never> {
    return Promise.reject(new Error('event search is not configured in this test'))
  }
}

/** Modules the composition rows import; the Loader mock serves only these. */
const modules = new Map<string, unknown>([
  ['@deepseek-ai/dsh-agent', AgentRegistry],
  ['@deepseek-ai/dsh-agent-loop', AgentLoop],
  ['@deepseek-ai/dsh-llm', LlmRuntime],
  ['@deepseek-ai/dsh-session', SessionStore],
  ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
  ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlSessionPersistence],
  ['@deepseek-ai/dsh-session-query', TestSessionQuery],
  ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ['@deepseek-ai/dsh-subagent', SubagentService],
  ['@deepseek-ai/dsh-subagent-fork-in-process', SubagentFork],
  ['@deepseek-ai/dsh-subagent-spawn-in-process', SubagentSpawn],
  ['@deepseek-ai/dsh-tool-subagent', toolSubagent],
  ['@deepseek-ai/dsh-tool-subagent/model-selection-settings', SubagentModelSelectionConfig],
  ['@deepseek-ai/dsh-tools', ToolRuntime],
  ['@deepseek-ai/dsh-experimental-agent-team', TeamService],
  ['@deepseek-ai/dsh-experimental-tool-agent-team', toolTeam],
])

/** The plugin rows the Team composition loads, in load order. */
const compositionRows = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-agent-loop',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-session-persistence-jsonl',
  '@deepseek-ai/dsh-session-query',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-subagent-fork-in-process',
  '@deepseek-ai/dsh-subagent-spawn-in-process',
  '@deepseek-ai/dsh-tool-subagent/model-selection-settings',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-experimental-agent-team',
  '@deepseek-ai/dsh-experimental-tool-agent-team',
]

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

/** Serve the composition's module specifiers from the in-process module map. */
function mockModuleImports(loader: Loader): void {
  const internal = loader.internal
  if (internal === undefined) throw new Error('Loader internal module hooks are unavailable')
  vi.spyOn(internal, 'import').mockImplementation(async (specifier: string) => {
    if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
    return modules.get(specifier)
  })
}

it('loads the Team profile services from cordis.yml and exposes allowed models and exact reasoning tiers', async () => {
  const scratch = join(process.cwd(), 'temp')
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'agent-team-loader-'))
  roots.push(root)
  const route = { provider: 'fixture-provider', model: 'fixture-model' }
  const configPath = join(root, 'cordis.yml')
  const rows = compositionRows.map(name => ({
    name,
    config: name === '@deepseek-ai/dsh-session-persistence-jsonl' ? { root } :
      name === '@deepseek-ai/dsh-agent-loop' ? { agents: [] } :
        name === '@deepseek-ai/dsh-subagent-spawn-in-process' ? { providerName: 'spawn' } :
          name === '@deepseek-ai/dsh-subagent-fork-in-process' ? { providerName: 'fork' } :
            name === '@deepseek-ai/dsh-tool-subagent/model-selection-settings' ? { enabled: true, allowedModels: [route] } :
              name === '@deepseek-ai/dsh-experimental-agent-team' ? { allowedModels: [route] } :
                name === '@deepseek-ai/dsh-experimental-tool-agent-team'
                  ? { freshProvider: 'spawn', forkProvider: 'fork', modelSelectionSettings: true }
                  : {},
  }))
  await writeFile(configPath, JSON.stringify(rows))

  const ctx = new Context()
  contexts.add(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  mockModuleImports(ctx.loader)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()

  const adapter = new MockAdapter([])
  vi.spyOn(adapter, 'listModels').mockResolvedValue([
    { provider: route.provider, id: route.model, name: 'Fixture model' },
  ])
  vi.spyOn(adapter, 'resolveModel').mockResolvedValue({
    provider: route.provider,
    id: route.model,
    name: 'Fixture model',
    reasoning: {
      efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }, { id: ReasoningEffortId('high'), name: 'High' }],
      defaultEffort: ReasoningEffortId('high'),
    },
  })
  ctx.llm.registerAdapter([route.provider], adapter)
  const lead = await ctx.agentLoop.create(SessionId('agent-team-loader-composition'), { provider: 'fixture-provider', model: 'lead-model' })
  const leadScope = scopeOf(lead.ctx)
  expect(leadScope).toBeDefined()
  expect(ctx.tools.get('list_subagent_models')).toBeUndefined()
  expect(ctx.tools.get('list_subagent_models', leadScope)).toBeDefined()
  const providers = await ctx.tools.execute({
    callId: ToolCallId('loader-model-providers'),
    name: 'list_subagent_models',
    arguments: {},
    signal: new AbortController().signal,
    agent: lead,
  })
  const models = await ctx.tools.execute({
    callId: ToolCallId('loader-model-details'),
    name: 'list_subagent_models',
    arguments: { provider: route.provider, model: route.model },
    signal: new AbortController().signal,
    agent: lead,
  })
  const providersText = providers.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  const modelsText = models.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')

  expect(providers.isError).toBeFalsy()
  expect(providersText).toContain(route.provider)
  expect(models.isError).toBeFalsy()
  expect(modelsText).toContain(`${route.provider}/${route.model}`)
  expect(modelsText).toContain('high (default)')
  expect(modelsText).toContain('Low')
})

it('keeps one discovery registration when a delegation tool and a Team share an Agent scope', async () => {
  const scratch = join(process.cwd(), 'temp')
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'agent-team-loader-'))
  roots.push(root)
  // The Session authorizes both routes; the Team narrows the catalog to its own.
  const teamRoute = { provider: 'fixture-provider', model: 'fixture-model' }
  const sessionRoute = { provider: 'fixture-provider', model: 'session-model' }
  const configPath = join(root, 'cordis.yml')
  const rows = [...compositionRows, '@deepseek-ai/dsh-tool-subagent'].map(name => ({
    name,
    config: name === '@deepseek-ai/dsh-session-persistence-jsonl' ? { root } :
      name === '@deepseek-ai/dsh-agent-loop' ? { agents: [] } :
        name === '@deepseek-ai/dsh-subagent-spawn-in-process' ? { providerName: 'spawn' } :
          name === '@deepseek-ai/dsh-subagent-fork-in-process' ? { providerName: 'fork' } :
            name === '@deepseek-ai/dsh-tool-subagent/model-selection-settings' ? { enabled: true, allowedModels: [teamRoute, sessionRoute] } :
              name === '@deepseek-ai/dsh-experimental-agent-team' ? { allowedModels: [teamRoute] } :
                name === '@deepseek-ai/dsh-experimental-tool-agent-team'
                  ? { freshProvider: 'spawn', forkProvider: 'fork', modelSelectionSettings: true }
                  : name === '@deepseek-ai/dsh-tool-subagent'
                    ? { provider: 'spawn', modelSelectionSettings: true }
                    : {},
  }))
  await writeFile(configPath, JSON.stringify(rows))

  const ctx = new Context()
  contexts.add(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  mockModuleImports(ctx.loader)

  // A standing delegation composition lives in a scoped preset context, so the
  // whole tree is mounted under one and the Agent joins that scope. The scope
  // resolves the Loader through the injection that owns it.
  await ctx.inject(['loader'], async (injected) => {
    const composition = createScope(injected, {})
    const scoped = composition.ctx.isolate('loader')
    await scoped.plugin(Loader)
    const loader = scoped.get('loader')
    if (loader === undefined) throw new Error('the scoped Loader is unavailable')
    loader.builtins.include = Include
    mockModuleImports(loader)
    await loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await loader.await()
    for (const entry of loader.entries()) await entry.fiber?.await()

    const adapter = new MockAdapter([])
    vi.spyOn(adapter, 'listModels').mockResolvedValue([
      { provider: teamRoute.provider, id: teamRoute.model, name: 'Fixture model' },
      { provider: sessionRoute.provider, id: sessionRoute.model, name: 'Session model' },
    ])
    vi.spyOn(adapter, 'resolveModel').mockResolvedValue({
      provider: teamRoute.provider,
      id: teamRoute.model,
      name: 'Fixture model',
      reasoning: {
        efforts: [{ id: ReasoningEffortId('low'), name: 'Low' }, { id: ReasoningEffortId('high'), name: 'High' }],
        defaultEffort: ReasoningEffortId('high'),
      },
    })
    ctx.llm.registerAdapter([teamRoute.provider], adapter)
    const register = vi.spyOn(ctx.tools, 'register')
    const handle = await ctx.agents.create({
      sessionId: SessionId('agent-team-loader-shared-discovery'),
      agentOptions: { provider: teamRoute.provider, model: 'lead-model' },
      setup: (agentCtx) => {
        // The Agent joins the composition scope, so the delegation tool owns a
        // definition in the same scope the Team installs its own tools into.
        bindScopeParent(scopeOf(agentCtx)!, scopeOf(composition.ctx)!)
      },
    })
    const lead = handle.agent
    const leadScope = scopeOf(lead.ctx)
    expect(leadScope).toBeDefined()

    // One scope keeps one discovery tool: the second owner contributes its
    // policy instead of registering the name a second time.
    const discoveryRegistrations = register.mock.calls.filter(([definition]) => definition.name === 'list_subagent_models')
    expect(discoveryRegistrations).toHaveLength(1)
    expect(ctx.tools.get('list_subagent_models')).toBeUndefined()
    expect(ctx.tools.get('list_subagent_models', leadScope)).toBeDefined()
    // The delegation composition finished installing beside the Team tools.
    expect(ctx.tools.get('subagent', leadScope)).toBeDefined()

    const models = await ctx.tools.execute({
      callId: ToolCallId('loader-shared-models'),
      name: 'list_subagent_models',
      arguments: { provider: teamRoute.provider },
      signal: new AbortController().signal,
      agent: lead,
    })
    const modelsText = models.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(models.isError).toBeFalsy()
    expect(modelsText).toContain(`${teamRoute.provider}/${teamRoute.model}`)
    // The Session allows the second route, the Team does not: the shared
    // catalog answers with the intersection only.
    expect(modelsText).not.toContain(sessionRoute.model)

    const denied = await ctx.tools.execute({
      callId: ToolCallId('loader-shared-denied'),
      name: 'list_subagent_models',
      arguments: { provider: teamRoute.provider, model: sessionRoute.model },
      signal: new AbortController().signal,
      agent: lead,
    })
    const deniedText = denied.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    expect(denied.isError).toBe(true)
    expect(deniedText).toContain('is not allowed for this Session')
  })
})
