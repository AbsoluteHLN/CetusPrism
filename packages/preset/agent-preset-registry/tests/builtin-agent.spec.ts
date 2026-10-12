import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BUILTIN_AGENT_RELEASE,
  BuiltinAgentConfigError,
  BuiltinAgentConfigStore,
  defaultBuiltinAgentDirectory,
  defineBuiltinAgent,
  validateBuiltinAgentConfig,
} from '../src/builtin-agent.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function store(): Promise<BuiltinAgentConfigStore> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-builtin-agent-'))
  directories.push(dir)
  return new BuiltinAgentConfigStore(join(dir, 'config', 'builtin-agents.json'))
}

const agent = () => defineBuiltinAgent({
  id: 'reviewer', enabled: true, driver: 'native', version: '1.0.0', source: 'cetusprism',
  compatibility: { protocolVersion: 1, minCetusPrismVersion: BUILTIN_AGENT_RELEASE },
})

describe('built-in agent protocol', () => {
  it('defaults first install beside the configuration file and validates future driver names', async () => {
    const target = await store()
    expect(defaultBuiltinAgentDirectory(target.configPath)).toBe(join(target.configPath, '..'))
    const declaration = defineBuiltinAgent({ ...agent(), id: 'zcode-reviewer', driver: 'zcode' })
    expect(declaration.driver).toBe('zcode')
    expect(target.defaultConfig().installDirectory).toBe(join(target.configPath, '..'))
  })

  it('rejects secrets and driver-private fields before persistence', () => {
    expect(() => validateBuiltinAgentConfig({
      schemaVersion: 1, release: BUILTIN_AGENT_RELEASE, installDirectory: 'agents', agents: [{ ...agent(), credentials: 'secret' }],
    })).toThrow(BuiltinAgentConfigError)
    expect(() => validateBuiltinAgentConfig({
      schemaVersion: 1, release: BUILTIN_AGENT_RELEASE, installDirectory: 'agents', agents: [], privateConfig: { token: 'secret' },
    })).toThrow(BuiltinAgentConfigError)
  })

  it('saves atomically, keeps a previous version, and rolls back', async () => {
    const target = await store()
    const first = { ...target.defaultConfig(), agents: [agent()] }
    const second = { ...first, agents: [{ ...agent(), enabled: false }] }
    await target.save(first)
    await target.save(second)
    expect((await target.load()).agents[0]?.enabled).toBe(false)
    expect(JSON.parse(await readFile(target.backupPath, 'utf8')).agents[0].enabled).toBe(true)
    expect((await target.rollback()).agents[0]?.enabled).toBe(true)
    expect((await target.load()).agents[0]?.enabled).toBe(true)
  })
})
