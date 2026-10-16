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
import { scopeOf } from '@deepseek-ai/dsh-scope'
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

afterEach(async () => {
  for (const ctx of contexts) await ctx.fiber.dispose()
  contexts.clear()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('loads the Team profile services from cordis.yml and exposes allowed models and exact reasoning tiers', async () => {
  const scratch = join(process.cwd(), 'temp')
  await mkdir(scratch, { recursive: true })
  const root = await mkdtemp(join(scratch, 'agent-team-loader-'))
  roots.push(root)
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
    ['@deepseek-ai/dsh-tool-subagent/model-selection-settings', SubagentModelSelectionConfig],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-experimental-agent-team', TeamService],
    ['@deepseek-ai/dsh-experimental-tool-agent-team', toolTeam],
  ])
  const route = { provider: 'fixture-provider', model: 'fixture-model' }
  const configPath = join(root, 'cordis.yml')
  const rows = [...modules.keys()].map(name => ({
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
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
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
