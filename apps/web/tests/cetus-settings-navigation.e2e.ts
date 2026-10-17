/** Keyless built-client coverage for CetusPrism settings and sidebar navigation. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, watchConsole, webSnapshotMode,
} from './scaffold.ts'

const EXPECTED = fileURLToPath(new URL('./expected/cetus-settings-navigation', import.meta.url))
const EVIDENCE = fileURLToPath(new URL('../../../dev-docs/evidence', import.meta.url))

it('exposes Team model settings and canonical appearance controls with aligned sidebar actions', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' })
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  const newSession = page.locator('[data-sidebar-new-session]')
  await newSession.waitFor()
  const centered = () => newSession.evaluate(button => {
    const label = button.querySelector('[class*="newSessionContent"]')
    const bounds = button.getBoundingClientRect()
    const content = label?.getBoundingClientRect()
    return content === undefined ? null : Math.abs((content.left + content.right - bounds.left - bounds.right) / 2)
  })
  expect(await centered()).toBeLessThanOrEqual(1)
  await newSession.hover()
  expect(await centered()).toBeLessThanOrEqual(1)

  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })
  await settings.getByRole('button', { name: '智能体团队', exact: true }).click()
  expect(await settings.evaluate(node => getComputedStyle(node).backgroundColor)).not.toContain('rgba')
  await settings.getByText('允许子智能体与智能体团队选择模型', { exact: true }).waitFor()
  const permission = settings.getByRole('switch', { name: '允许子智能体与智能体团队选择模型', exact: true })
  await permission.click()
  const model = settings.getByRole('checkbox').first()
  await model.check()
  await settings.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(() => settings.getByRole('button', { name: '保存', exact: true }).isDisabled()).toBe(true)
  await page.reload({ waitUntil: 'load' })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await settings.getByRole('button', { name: '智能体团队', exact: true }).click()
  await expect.poll(() => permission.getAttribute('aria-checked')).toBe('true')
  await expect.poll(() => model.isChecked()).toBe(true)
  mkdirSync(EXPECTED, { recursive: true })
  await compareOrRefreshGolden(join(EXPECTED, 'models.expected.md'),
    await captureStableAria(page, '[role="dialog"]', scaffold.workspaceCwd), webSnapshotMode())
  mkdirSync(EVIDENCE, { recursive: true })
  const evidence = mkdtempSync(join(EVIDENCE, 'cetus-settings-'))
  await page.screenshot({ path: join(evidence, 'cetus-team-model-settings.png') })

  await settings.getByRole('button', { name: '外观与皮肤', exact: true }).click()
  const gallery = settings.locator('[data-hln-appearance]')
  expect(await gallery.locator('[data-hln-ui-surface]').count()).toBe(4)
  expect(await gallery.locator('[data-hln-ui-control]').count()).toBe(31)
  await gallery.getByRole('button', { name: '雪花石膏', exact: true }).click()
  await expect.poll(() => page.locator('html').getAttribute('data-hln-theme')).toBe('alabaster-studio')
  expect(await gallery.locator('[data-hln-ui-control][data-active="true"]').count()).toBe(4)
  await compareOrRefreshGolden(join(EXPECTED, 'appearance.expected.md'),
    await captureStableAria(page, '[data-hln-appearance]', scaffold.workspaceCwd), webSnapshotMode())
  await page.screenshot({ path: join(evidence, 'cetus-appearance-light.png') })
  await gallery.getByRole('button', { name: '奇点青', exact: true }).click()
  await page.screenshot({ path: join(evidence, 'cetus-appearance-dark.png') })
  await page.setViewportSize({ width: 640, height: 800 })
  expect(await gallery.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.setViewportSize({ width: 1280, height: 900 })
  await settings.getByRole('button', { name: '关闭', exact: true }).click()
  await newSession.click()
  await page.locator('[data-composer-input]').waitFor()
  const preset = page.locator('button[title="选择新任务使用的 Agent 预设"]')
  await preset.click()
  await page.getByRole('menuitem', { name: /ZCode 原则模式/ }).click()
  await expect.poll(() => preset.textContent()).toContain('ZCode 原则模式')
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
}, 120_000)
