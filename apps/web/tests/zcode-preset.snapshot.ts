/** Authored keyless Web session exercising the optional native ZCode principles. */
import { mkdirSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { launchWebScaffold, seedSession, watchConsole, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspaceZh, writeComposerDraft } from './support.ts'

const DIR = fileURLToPath(new URL('../../../snapshots/web/zcode-preset', import.meta.url))
const EVIDENCE = fileURLToPath(new URL('../../../dev-docs/evidence', import.meta.url))

/** Pin the scenario's shell catalog without changing the shipped OS selection. */
async function snapshotOverlay(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-zcode-snapshot-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const source = fileURLToPath(new URL('../../../packages/bundle/web-app/presets/standard.patch.yml', import.meta.url))
  const row = composeEntries([loadOverlayPatches('zcode snapshot', source)])
    .find(entry => entry.id === 'preset-zcode-inspired')
  if (row === undefined) throw new Error('shipped ZCode preset is missing')
  const config = row.config as PresetDefinition
  const plugins = config.plugins.map(plugin => plugin.id === 'tool-bash'
    ? { ...plugin, disabled: false }
    : plugin.id === 'tool-pwsh' ? { ...plugin, disabled: true } : plugin)
  const path = join(directory, 'cordis.patch.yml')
  await writeFile(path, yaml.dump([{ id: row.id, config: { ...config, plugins } }], { schema: entryListSchema }))
  return path
}

it.skipIf(webSnapshotMode() === 'record')('records and restores the selected native ZCode preset without changing the default', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: await snapshotOverlay(),
    replayFixture: join(DIR, 'session.v4.jsonl'),
    replayOverride: join(DIR, 'replay.override.json'),
    compareReplaySession: true,
  })
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' })
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await connectFreshWorkspaceZh(page, scaffold.workspaceCwd)
  const preset = page.locator('button[title="选择新任务使用的 Agent 预设"]')
  await preset.click()
  mkdirSync(EVIDENCE, { recursive: true })
  await page.screenshot({ path: join(EVIDENCE, '2026-10-18-zcode-menu.png') })
  await page.getByRole('menuitem', { name: /ZCode 原则模式/ }).click()
  await expect.poll(() => preset.textContent()).toContain('ZCode 原则模式')
  const settled = scaffold.whenTurnSettled()
  const composer = page.locator('[data-composer-input][contenteditable="true"]')
  await writeComposerDraft(page, composer, 'Reply exactly ZCODE_NATIVE_PRESET_OK.')
  await composer.press('Enter')
  const id = await settled
  const agent = scaffold.ctx.agents.get(id)
  if (agent === undefined) throw new Error('selected preset session has no live agent')
  expect(agent.session.snapshotEvents().filter(event => event.type === 'agent-preset/selected')
    .map(event => event.data.agentPreset)).toContain('zcode-inspired')
  const system = agent.session.deriveMessages().filter(message => message.role === 'system')
    .flatMap(message => message.content).flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  expect(system).toContain('Inspect relevant files and repository instructions before editing.')
  expect(agent.session.requestHeader()?.tools?.some(tool => tool.name === 'read')).toBe(true)
  expect(agent.session.requestHeader()?.tools?.some(tool => tool.name === 'bash')).toBe(true)
  expect(agent.session.requestHeader()?.tools?.some(tool => tool.name === 'pwsh')).toBe(false)
  expect((await scaffold.ctx.agentPresets.remoteExportList()).presets.find(row => row.isDefault)?.id).toBe('standard')
  const reader = await scaffold.ctx.sessionPersistence.open(id, 'read')
  try {
    const persisted = await reader.read()
    expect(persisted.events.filter(event => event.type === 'agent-preset/selected')
      .map(event => event.data.agentPreset)).toContain('zcode-inspired')
  } finally {
    await reader.close()
  }
  await page.reload({ waitUntil: 'load' })
  await page.getByText('ZCODE_NATIVE_PRESET_OK', { exact: true }).waitFor()
  await page.getByText('ZCode 原则模式', { exact: true }).waitFor()
  await page.screenshot({ path: join(EVIDENCE, '2026-10-18-zcode-session-dark.png') })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('button', { name: '外观与皮肤', exact: true }).click()
  await settings.getByRole('button', { name: '雪花石膏', exact: true }).click()
  await expect.poll(() => page.locator('html').getAttribute('data-hln-theme')).toBe('alabaster-studio')
  await settings.getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('[data-composer-card]').evaluate(async element => {
    const deadline = performance.now() + 4_000
    let previous = ''
    let stable = 0
    while (performance.now() < deadline) {
      await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))
      const style = getComputedStyle(element)
      const sample = `${style.backgroundColor}/${style.color}`
      stable = sample === previous ? stable + 1 : 0
      if (stable >= 3) return
      previous = sample
    }
    throw new Error('light theme colors did not settle')
  })
  await page.screenshot({ path: join(EVIDENCE, '2026-10-18-zcode-session-light.png') })
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
}, 90_000)

it.skipIf(webSnapshotMode() === 'record')('cold-restores the logged selection with the shipped Web composition', async () => {
  const scaffold = await launchWebScaffold({ extraOverlayPath: await snapshotOverlay() })
  onTestFinished(() => scaffold.close())
  const id = await seedSession(scaffold, readFileSync(join(DIR, 'session.v4.jsonl'), 'utf8'), 'zcode-cold-restore', 'standard')
  const resolved = await scaffold.ctx.sessionController.resolveAgent(id)
  if ('error' in resolved) throw resolved.error
  expect(scaffold.ctx.agentPresets.composedPreset(resolved.agent.ctx)).toBe('zcode-inspired')
  expect(resolved.agent.session.snapshotEvents().filter(event => event.type === 'agent-preset/selected')
    .map(event => event.data.agentPreset)).toContain('zcode-inspired')
  expect((await scaffold.ctx.agentPresets.remoteExportList()).presets.find(row => row.isDefault)?.id).toBe('standard')
}, 30_000)
