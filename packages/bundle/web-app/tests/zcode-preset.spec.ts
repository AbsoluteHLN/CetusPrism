/** Optional coding guidance retains the shipped native tool composition. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { loadCordisYaml } from '../../../../scripts/cordis-yaml.ts'

interface PresetRow {
  config: { id: string; plugins: { id: string; name: string; config?: { prefix?: string } }[] }
}

it('keeps native capabilities and changes only the optional persona', () => {
  const parsed = loadCordisYaml(readFileSync(new URL('../presets/standard.patch.yml', import.meta.url), 'utf8')) as { insert: PresetRow[] }[]
  const [standard, inspired] = parsed[0]!.insert
  expect(standard!.config.id).toBe('standard')
  expect(inspired!.config.id).toBe('zcode-inspired')
  expect(inspired!.config.plugins.slice(1)).toEqual(standard!.config.plugins.slice(1))
  expect(inspired!.config.plugins[0]!.name).toBe('@deepseek-ai/dsh-persona')
  expect(inspired!.config.plugins[0]!.config!.prefix).toContain('completion evidence')
  expect(standard!.config.plugins[0]!.config!.prefix).not.toContain('completion evidence')
  expect(inspired!.config.plugins.some(row => /zcode|antigravity/.test(row.name))).toBe(false)
})
