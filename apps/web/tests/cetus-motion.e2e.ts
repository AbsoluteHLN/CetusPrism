// Background motion and composer fade contract across themes and viewport sizes.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/cetus-motion', import.meta.url))
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()
const SESSION_ID = 'cetus-motion-web-e2e'
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'CETUS_MOTION',
  title: 'CETUS_MOTION composer and background session',
  turns: 24,
})

const PRESETS = [
  'tensor-stream',
  'neural-dag',
  'fourier-harmonics',
  'procedural-matrix',
  'simplex-contour',
  'clock-bus',
  'swiss-vector',
  'quiet',
] as const

const PRESET_ANIMATIONS: Record<(typeof PRESETS)[number], string> = {
  'tensor-stream': 'hln-cetus-band-glide',
  'neural-dag': 'hln-v35-bg-dag-drift',
  'fourier-harmonics': 'hln-v35-bg-harmonic-wave',
  'procedural-matrix': 'hln-v35-bg-matrix-pan',
  'simplex-contour': 'hln-v35-bg-stream-pulse',
  'clock-bus': 'hln-v35-bg-bus-clock',
  'swiss-vector': 'none',
  quiet: 'none',
}

const THEMES = ['singularity-cyan', 'alabaster-studio'] as const
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 520, height: 740 },
] as const

interface GeometrySample {
  theme: (typeof THEMES)[number]
  viewport: string
  fadeSize: string
  paddingTop: string
  backgroundRepeat: string
  backgroundImage: string
  seatOpacity: string
  cardOpacity: string
  inputOpacity: string
  seatMask: string
  cardMask: string
  inputMask: string
  rootTheme: string | null
  fadeBeforeCard: boolean
  cardFitsViewport: boolean
  cardFitsColumn: boolean
  tailVisibleAboveSeat: boolean
}

interface MotionSample {
  preset: (typeof PRESETS)[number]
  animationName: string
  animationDuration: string
  animationEasing: string
  afterContent: string
  afterAnimation: string
}

async function nextPaint(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>(resolve => requestAnimationFrame(() => {
      requestAnimationFrame(() => { resolve() })
    }))
  })
}

async function openSeed(page: Page): Promise<void> {
  await page.getByText('Ungrouped', { exact: true }).waitFor({ timeout: 30_000 })
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search session names', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  await results.first().waitFor({ timeout: 60_000 })
  const count = await results.count()
  if (count !== 1) throw new Error(`expected one seeded search result, received ${String(count)}`)
  await results.click()
  await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false }).last()
    .waitFor({ timeout: 30_000 })
  await nextPaint(page)
}

async function setPreset(page: Page, preset: (typeof PRESETS)[number]): Promise<void> {
  await page.locator('#root').evaluate((root, value) => {
    root.setAttribute('data-hln-bg-motion', value)
  }, preset)
  await nextPaint(page)
}

async function settleViewport(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport)
  await page.locator('[data-conversation-scroll]').evaluate(async (host) => {
    const deadline = performance.now() + 5_000
    let previous = host.getBoundingClientRect().width
    let stableFrames = 0
    while (performance.now() < deadline) {
      await new Promise<void>(resolve => requestAnimationFrame(() => { resolve() }))
      const current = host.getBoundingClientRect().width
      stableFrames = Math.abs(current - previous) < 0.01 ? stableFrames + 1 : 0
      if (stableFrames >= 3) return
      previous = current
    }
    throw new Error('conversation width did not settle after the viewport changed')
  })
}

async function scrollConversationToEnd(page: Page): Promise<void> {
  const scroll = page.locator('[data-conversation-scroll]')
  await expect.poll(async () => scroll.evaluate((host) => {
    host.scrollTop = host.scrollHeight
    return host.scrollHeight - host.clientHeight - host.scrollTop
  }), { timeout: 10_000 }).toBeLessThanOrEqual(1)
}

async function measureComposer(
  page: Page,
  theme: (typeof THEMES)[number],
  viewport: { width: number; height: number },
): Promise<GeometrySample> {
  const tail = page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false }).last()
  await tail.waitFor({ state: 'visible' })
  const tailBox = await tail.boundingBox()
  if (tailBox === null) throw new Error('final assistant message has no visible layout box')

  const sample = await page.evaluate(({ expectedTheme, expectedViewport, tailTop, tailBottom }) => {
    const seat = document.querySelector<HTMLElement>(
      '[data-content-phase="active"] > [data-conversation-scroll] > [data-composer-seat]',
    )
    const scroll = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    const card = seat?.querySelector<HTMLElement>('[data-composer-card]')
    const input = seat?.querySelector<HTMLElement>('[data-composer-input][contenteditable="true"]')
    if (seat === null || scroll === null || card == null || input == null) {
      throw new Error('active composer seat, card, input, or conversation scrollport is missing')
    }
    const seatStyle = getComputedStyle(seat)
    const cardStyle = getComputedStyle(card)
    const inputStyle = getComputedStyle(input)
    const seatRect = seat.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    const scrollRect = scroll.getBoundingClientRect()
    const fadeSize = getComputedStyle(document.querySelector('#root')!)
      .getPropertyValue('--hln-cetus-composer-fade-size').trim()
    return {
      theme: expectedTheme,
      viewport: `${String(expectedViewport.width)}x${String(expectedViewport.height)}`,
      fadeSize,
      paddingTop: seatStyle.paddingBlockStart,
      backgroundRepeat: seatStyle.backgroundRepeat,
      backgroundImage: seatStyle.backgroundImage,
      seatOpacity: seatStyle.opacity,
      cardOpacity: cardStyle.opacity,
      inputOpacity: inputStyle.opacity,
      seatMask: seatStyle.maskImage,
      cardMask: cardStyle.maskImage,
      inputMask: inputStyle.maskImage,
      fadeBeforeCard: cardRect.top >= seatRect.top + 35,
      cardFitsViewport: cardRect.left >= 0 && cardRect.right <= window.innerWidth
        && cardRect.top >= 0 && cardRect.bottom <= window.innerHeight,
      cardFitsColumn: cardRect.left >= scrollRect.left - 1 && cardRect.right <= scrollRect.right + 1
        && cardRect.bottom <= scrollRect.bottom + 1,
      tailVisibleAboveSeat: tailTop >= scrollRect.top - 1
        && tailBottom <= scrollRect.bottom + 1
        && tailBottom <= seatRect.top + 1,
      rootTheme: document.documentElement.getAttribute('data-hln-theme'),
    }
  }, {
    expectedTheme: theme,
    expectedViewport: viewport,
    tailTop: tailBox.y,
    tailBottom: tailBox.y + tailBox.height,
  })

  expect(sample.rootTheme).toBe(theme)
  return sample
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.setAttribute('data-hln-theme', value)
    document.querySelector('#root')?.setAttribute('data-hln-theme', value)
  }, theme)
  await nextPaint(page)
}

async function typeDraft(page: Page, rows: readonly string[]): Promise<void> {
  const input = page.locator('[data-composer-input][contenteditable="true"]').first()
  await input.click()
  await page.keyboard.press('ControlOrMeta+KeyA')
  await page.keyboard.press('Delete')
  for (const [index, row] of rows.entries()) {
    if (index > 0) await page.keyboard.press('Shift+Enter')
    if (row !== '') await page.keyboard.insertText(row)
  }
}

function renderGeometry(samples: readonly GeometrySample[], draftGrew: boolean, draftFadeFixed: boolean): string {
  return [
    '# Cetus motion and composer geometry',
    '',
    '- Background presets: tensor-stream, neural-dag, fourier-harmonics, procedural-matrix, simplex-contour, clock-bus, swiss-vector, quiet.',
    '- Root ::after remains unpainted and has no animation for every preset.',
    '- prefers-reduced-motion disables both root pseudo-element animations.',
    '- tensor-stream reads its 52s duration and linear easing from local motion tokens.',
    '',
    '## Composer matrix',
    '',
    ...samples.map(sample => `- ${sample.theme} at ${sample.viewport}: ${sample.fadeSize} fade, ${sample.backgroundRepeat}; fade clears card: ${String(sample.fadeBeforeCard)}; card fits viewport and column: ${String(sample.cardFitsViewport && sample.cardFitsColumn)}; seat/card/input stay opaque and unmasked: ${String(
      sample.seatOpacity === '1' && sample.cardOpacity === '1' && sample.inputOpacity === '1'
        && sample.seatMask === 'none' && sample.cardMask === 'none' && sample.inputMask === 'none',
    )}; final assistant stays above seat: ${String(sample.tailVisibleAboveSeat)}.`),
    '',
    '## Growing draft',
    '',
    `- composer grows with a multiline draft: ${String(draftGrew)}`,
    `- fade band remains fixed at 36px and stays above the card: ${String(draftFadeFixed)}`,
  ].join('\n')
}

describe('web e2e: Cetus background motion and composer fade', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser, VIEWPORTS[0].height)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeed(page)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('uses one tokenized scene layer and stops all root motion for reduced-motion users', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cetus-motion-presets'))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const normal: MotionSample[] = []
    for (const preset of PRESETS) {
      await setPreset(page, preset)
      const sample = await page.evaluate((value) => {
        const root = document.querySelector<HTMLElement>('#root')
        if (root === null) throw new Error('Cetus UI root is missing')
        const before = getComputedStyle(root, '::before')
        const after = getComputedStyle(root, '::after')
        return {
          preset: value,
          animationName: before.animationName,
          animationDuration: before.animationDuration,
          animationEasing: before.animationTimingFunction,
          afterContent: after.content,
          afterAnimation: after.animationName,
        }
      }, preset)
      expect(sample.animationName).toBe(PRESET_ANIMATIONS[preset])
      expect(sample.afterContent).toBe('none')
      expect(sample.afterAnimation).toBe('none')
      normal.push(sample)
    }

    const tokens = await page.locator('#root').evaluate((root) => {
      const style = getComputedStyle(root)
      return {
        duration: style.getPropertyValue('--hln-cetus-bg-motion-duration').trim(),
        easing: style.getPropertyValue('--hln-cetus-bg-motion-easing').trim(),
      }
    })
    expect(tokens.duration).toBe('52s')
    expect(tokens.easing).toBe('linear')
    const band = normal.find(sample => sample.preset === 'tensor-stream')
    expect(band?.animationDuration).toBe(tokens.duration)
    expect(band?.animationEasing).toBe(tokens.easing)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const preset of PRESETS) {
      await setPreset(page, preset)
      const reduced = await page.locator('#root').evaluate((root) => {
        const before = getComputedStyle(root, '::before')
        const after = getComputedStyle(root, '::after')
        return {
          before: { animationName: before.animationName, willChange: before.willChange },
          after: { animationName: after.animationName, willChange: after.willChange },
        }
      })
      expect(reduced.before.animationName, `${preset} ::before`).toBe('none')
      expect(reduced.after.animationName, `${preset} ::after`).toBe('none')
      expect(reduced.before.willChange, `${preset} ::before will-change`).toBe('auto')
      expect(reduced.after.willChange, `${preset} ::after will-change`).toBe('auto')
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' })
  }, 60_000)

  it('keeps the fade fixed and the final message readable across themes and viewport sizes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-cetus-motion-composer'))
    const samples: GeometrySample[] = []
    for (const theme of THEMES) {
      await setTheme(page, theme)
      for (const viewport of VIEWPORTS) {
        await settleViewport(page, viewport)
        await scrollConversationToEnd(page)
        const sample = await measureComposer(page, theme, viewport)
        expect(sample.fadeSize).toBe('36px')
        expect(sample.paddingTop).toBe('36px')
        expect(sample.backgroundRepeat).toBe('no-repeat')
        expect(sample.backgroundImage).toContain('linear-gradient')
        expect(sample.fadeBeforeCard).toBe(true)
        expect(sample.cardFitsViewport).toBe(true)
        expect(sample.cardFitsColumn).toBe(true)
        expect(sample.seatOpacity).toBe('1')
        expect(sample.cardOpacity).toBe('1')
        expect(sample.inputOpacity).toBe('1')
        expect(sample.seatMask).toBe('none')
        expect(sample.cardMask).toBe('none')
        expect(sample.inputMask).toBe('none')
        expect(sample.tailVisibleAboveSeat).toBe(true)
        samples.push(sample)
      }
    }

    await settleViewport(page, VIEWPORTS[1])
    await setTheme(page, 'alabaster-studio')
    const before = await page.locator('[data-composer-seat]').evaluate((seat) => ({
      height: seat.getBoundingClientRect().height,
      fade: getComputedStyle(seat).backgroundSize,
    }))
    const draftRows = Array.from({ length: 10 }, (_unused, index) => `CETUS_DRAFT_LINE_${String(index + 1)}`)
    await typeDraft(page, draftRows)
    const after = await page.locator('[data-composer-seat]').evaluate((seat) => {
      const card = seat.querySelector<HTMLElement>('[data-composer-card]')
      const input = seat.querySelector<HTMLElement>('[data-composer-input]')
      if (card === null || input === null) throw new Error('composer card or input is missing after draft growth')
      return {
        height: seat.getBoundingClientRect().height,
        fade: getComputedStyle(seat).backgroundSize,
        paddingTop: getComputedStyle(seat).paddingBlockStart,
        cardTop: card.getBoundingClientRect().top,
        seatTop: seat.getBoundingClientRect().top,
        inputOpacity: getComputedStyle(input).opacity,
      }
    })
    const draftGrew = after.height > before.height + 20
    const draftFadeFixed = before.fade === '100% 36px'
      && after.fade === '100% 36px'
      && after.paddingTop === '36px'
      && after.cardTop >= after.seatTop + 35
      && after.inputOpacity === '1'
    expect(draftGrew).toBe(true)
    expect(draftFadeFixed).toBe(true)
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(samples, draftGrew, draftFadeFixed), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 90_000)

  it('owns only its local expected file and made no model calls', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
