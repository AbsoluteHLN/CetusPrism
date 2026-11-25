/** Real-browser coverage for the Kalcirite v4 contracts the application adopts:
 *  the field contract, the scroll contract, the engine-owned Wash, the three
 *  radius tracks, and the runtime skin.
 *
 *  Every assertion reads computed geometry from a live Chromium. jsdom has no
 *  layout, so a rule that never reaches the screen cannot fail there — these
 *  checks are the only place the contracts are proven to reach the surface.
 */
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { launchWebScaffold, watchConsole } from './scaffold.ts'

/** Chrome's computed colour for a token value, so a Wash assertion can compare against the engine's accent. */
function rgbOf(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('rgb')) return trimmed.replace(/\s+/g, ' ')
  const hex = trimmed.replace('#', '')
  const full = hex.length === 3 ? hex.split('').map(part => part + part).join('') : hex
  const channel = (offset: number): number => Number.parseInt(full.slice(offset, offset + 2), 16)
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`
}

it('binds the application to the v4 field, scroll, wash, radius and skin contracts', async () => {
  const scaffold = await launchWebScaffold({})
  onTestFinished(() => scaffold.close())
  const browser = await chromium.launch()
  onTestFinished(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' })
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.locator('[data-sidebar-new-session]').waitFor()

  // The runtime publishes the control vocabulary the application asks for by
  // name, and refuses an unknown one the way it refuses an unknown theme.
  const vocabulary = await page.evaluate(() => {
    const scope = window as Window & {
      HLN?: {
        controlVariants?: readonly string[]
        controlStates?: readonly string[]
        isControlVariant?: (variant: string) => boolean
      }
    }
    const hln = scope.HLN
    return {
      variants: hln?.controlVariants ?? [],
      states: hln?.controlStates ?? [],
      accent: hln?.isControlVariant?.('accent') ?? false,
      wash: hln?.isControlVariant?.('wash') ?? false,
      unknown: hln?.isControlVariant?.('neon') ?? true,
    }
  })
  expect(vocabulary.variants).toEqual(['accent', 'ghost', 'quiet', 'danger'])
  expect(vocabulary.states).toEqual(['wash'])
  expect(vocabulary.accent).toBe(true)
  expect(vocabulary.wash).toBe(true)
  expect(vocabulary.unknown).toBe(false)

  // The scroll contract: the application's own scroll surfaces carry the
  // engine's attribute, and the engine's scrollbar geometry is in force.
  const scrollContract = await page.evaluate(() => {
    const transcript = document.querySelector('[data-conversation-scroll]')
    if (transcript === null) return { annotated: false, width: '', color: '' }
    const style = getComputedStyle(transcript)
    return {
      annotated: transcript.hasAttribute('data-hln-ui-scroll'),
      width: style.getPropertyValue('scrollbar-width').trim(),
      color: style.getPropertyValue('scrollbar-color').trim(),
    }
  })
  expect(scrollContract.annotated).toBe(true)
  expect(scrollContract.width).toBe('thin')
  expect(scrollContract.color).not.toBe('')

  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '设置', exact: true })

  // The settings panel scrolls on the engine's contract too.
  const settingsScroll = await settings.evaluate(node => {
    const surfaces = Array.from(node.querySelectorAll('[data-hln-ui-scroll]'))
    return surfaces.length
  })
  expect(settingsScroll).toBeGreaterThan(0)

  // The field contract: the input's frame IS the field the user sees, and the
  // engine paints it — the field height, the small radius, the form face.
  await settings.getByRole('button', { name: '执行底座', exact: true }).click()
  const piRuntime = settings.locator('[data-agent-runtime-id="pi"]')
  await piRuntime.waitFor({ timeout: 15_000 })
  const field = await piRuntime.evaluate(node => {
    const input = node.querySelector('input')
    const frame = input?.parentElement ?? null
    if (input === null || frame === null) return { annotated: false, height: 0, radius: '' }
    const style = getComputedStyle(frame)
    return {
      annotated: frame.hasAttribute('data-hln-ui-field'),
      height: frame.getBoundingClientRect().height,
      radius: style.borderTopLeftRadius,
    }
  })
  expect(field.annotated).toBe(true)
  expect(field.height).toBe(34)
  expect(field.radius).toBe('4px')

  // Three radius tracks: the runtime row is a card (md), the input frame is a
  // control (sm), the settings panel is a surface (lg).
  const tracks = await settings.evaluate(node => {
    const panel = node.querySelector('[role="dialog"]') ?? node
    const card = node.querySelector('li[class*="card"]')
    const control = node.querySelector('input')?.parentElement ?? null
    return {
      panel: panel === null ? '' : getComputedStyle(panel).borderTopLeftRadius,
      card: card === null ? '' : getComputedStyle(card).borderTopLeftRadius,
      control: control === null ? '' : getComputedStyle(control).borderTopLeftRadius,
    }
  })
  expect(tracks.panel).toBe('8px')
  expect(tracks.card).toBe('6px')
  expect(tracks.control).toBe('4px')

  // The engine owns the Wash: the selected appearance card is an engine
  // control, so the v4 layer paints it with accent ink — the application
  // keeps no private copy of the selected state.
  await settings.getByRole('button', { name: '外观与皮肤', exact: true }).click()
  const gallery = settings.locator('[data-hln-appearance]')
  await gallery.waitFor()
  // The card transitions its own ink, so the comparison waits for the
  // transition to settle instead of racing it.
  await expect.poll(async () => {
    const wash = await gallery.locator('[data-hln-ui-control][data-active="true"]').first().evaluate(node => {
      const root = document.getElementById('root')
      const accent = root === null ? '' : getComputedStyle(root).getPropertyValue('--hln-ui-accent').trim()
      return { accent, color: getComputedStyle(node).color }
    })
    return wash.accent !== '' && wash.color === rgbOf(wash.accent)
  }).toBe(true)

  // The runtime skin: the theme card drives the engine's skin layer through
  // the dist's own createHlnSkin / applyHlnSkin, so a theme the stylesheet
  // has no block for still paints its pigments.
  await gallery.getByRole('button', { name: '奇点青', exact: true }).click()
  await expect.poll(async () => (await page.locator('#root').evaluate(node => (
    node.style.getPropertyValue('--hln-ui-accent')
  ))).trim().toLowerCase()).toBe('#00f0ff')
  await expect.poll(async () => {
    const skinned = await gallery.locator('[data-hln-ui-control][data-active="true"]').first().evaluate(node => ({
      color: getComputedStyle(node).color,
      accent: getComputedStyle(document.getElementById('root') ?? document.body).getPropertyValue('--hln-ui-accent').trim(),
    }))
    return skinned.color === rgbOf(skinned.accent)
  }).toBe(true)
  expect(tripwire.pageErrors).toEqual([])
  expect(tripwire.warnings).toEqual([])
}, 120_000)
