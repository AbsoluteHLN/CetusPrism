/**
 * The standard preset's compaction budget: the numbers a deployment gets.
 *
 * The pressure shape is configuration, so nothing in the code keeps it from
 * drifting unnoticed — a changed default or a changed preset row would move
 * the point at which a conversation is compacted without any test failing.
 * This file reads the shipped preset, resolves it through the same code the
 * runtime uses, and states the resulting budgets.
 */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { loadCordisYaml } from '../../../../scripts/cordis-yaml.ts'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import {
  resolveCompactSpec,
  resolveConfig,
  resolveTargetPolicy,
} from '@deepseek-ai/dsh-compaction-basic/src/config.ts'

interface PluginRow {
  id: string
  name?: string
  group?: boolean
  config?: unknown
}

interface PresetRow {
  id: string
  config: { id: string; plugins: PluginRow[] }
}

const parsed = loadCordisYaml(
  readFileSync(new URL('../presets/standard.patch.yml', import.meta.url), 'utf8'),
) as { insert: PresetRow[] }[]

/** The preset row that owns the compaction group, and the engine inside it. */
function compactionConfig(): BasicCompactionConfig {
  const standard = parsed[0]!.insert[0]!
  const group = standard.config.plugins.find(row => row.id === 'compaction')
  const rows = (group?.config ?? []) as PluginRow[]
  const engine = rows.find(row => row.id === 'compaction-basic')
  if (engine === undefined) throw new Error('the standard preset mounts no compaction engine')
  return engine.config as BasicCompactionConfig
}

it('gives the model its window instead of a flat reserve', () => {
  const config = resolveConfig(compactionConfig())
  const policy = resolveTargetPolicy(config, { provider: 'any', model: 'any' })
  const thresholdOf = (contextWindow: number): number =>
    resolveCompactSpec(policy, contextWindow, 32_768).thresholdTokens

  // A 128K window and the service defaults left 29,696 tokens before
  // compaction — under a quarter of the window. These are the budgets the
  // preset now gives.
  expect(thresholdOf(128_000)).toBe(87_040)
  expect(thresholdOf(200_000)).toBe(159_040)
  expect(thresholdOf(262_144)).toBe(221_184)
})
