/** The IDE workspace's geometry in a real browser: three columns, two seams, one gutter.

 * The IDE is the product's workbench, so its LAYOUT is a product surface: the
 * three columns must tile the frame without a gap or an overlap, the two
 * seams must sit exactly between them, the editor's gutter must track the
 * code line for line, and the status bar must stay visible under the code it
 * describes. jsdom has no layout, so these are measured in Chromium against
 * the shipped composition.
 *
 * Two regressions are guarded here as well: the title bar's path is a crumb
 * RUN (no segment may be squeezed into a single letter, and a narrow frame
 * folds the middle segments into one "\u2026" crumb instead of crushing them),
 * and the composer's fade band must land on the app's own surface rather than
 * on the dist's default plane.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/fresh-round-trip/session.v4.jsonl', import.meta.url))
const SEED_ID = 'ide-layout-web-e2e'

/** The file the IDE opens: long enough for a gutter and a scroll to matter. */
const SOURCE = Array.from({ length: 40 }, (_, index) =>
  `export const value${index} = ${index} // line ${index + 1}`).join('\n')

/** One measured box. */
interface Box {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

/** One segment of the title bar's path. */
interface Segment {
  /** The segment's own text. */
  readonly text: string
  /** The segment's measured width. */
  readonly width: number
  /** Whether the segment's text is cut off (an ellipsis stands in for it). */
  readonly clipped: boolean
  /** Whether this segment is a middle one (the ones a narrow frame folds). */
  readonly middle: boolean
  /** Whether this segment is the last one (the project name). */
  readonly last: boolean
}

/** The IDE's measured geometry. */
interface IdeGeometry {
  readonly workspace: Box
  readonly titleBar: Box
  readonly files: Box
  readonly code: Box
  readonly assistant: Box
  readonly seams: readonly Box[]
  readonly statusBar: Box
  readonly editor: Box
  readonly gutterLine: Box
  readonly codeLine: Box
  readonly gutterLines: number
  readonly codeLines: number
  readonly overflowX: number
  readonly segments: readonly Segment[]
  readonly folded: boolean
  readonly foldCrumb: boolean
}

/**
 * Measure the IDE's geometry in the page.
 * @param page - the page under test.
 * @returns the measured boxes.
 */
async function measure(page: Page): Promise<IdeGeometry> {
  return page.evaluate(() => {
    const box = (element: Element | null): Box | null => {
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return {
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        width: rect.width, height: rect.height,
      }
    }
    const workspace = document.querySelector('[data-ide-workspace]')
    if (workspace === null) throw new Error('the IDE workspace is not on screen')
    const gutterLines = [...document.querySelectorAll('[data-ide-gutter] span')]
    const codeLines = [...document.querySelectorAll('[data-ide-code-layer] code > span')]
    const path = document.querySelector('[data-ide-breadcrumb]')
    return {
      workspace: box(workspace)!,
      titleBar: box(document.querySelector('[data-ide-titlebar]'))!,
      files: box(document.querySelector('[data-ide-pane="files"]'))!,
      code: box(document.querySelector('[data-ide-pane="code"]'))!,
      assistant: box(document.querySelector('[data-ide-pane="assistant"]'))!,
      seams: [...workspace.querySelectorAll('[role="separator"]')].map(element => box(element)!),
      statusBar: box(document.querySelector('[data-ide-statusbar]'))!,
      editor: box(document.querySelector('[data-ide-editor]'))!,
      gutterLine: box(gutterLines[0] ?? null)!,
      codeLine: box(codeLines[0] ?? null)!,
      gutterLines: gutterLines.length,
      codeLines: codeLines.length,
      overflowX: workspace.scrollWidth - workspace.clientWidth,
      segments: [...document.querySelectorAll('[data-ide-path-part]')].map(element => {
        const text = element.querySelector('[data-ide-path-text]')
        return {
          text: text?.textContent ?? '',
          width: element.getBoundingClientRect().width,
          clipped: text !== null && text.scrollWidth > text.clientWidth + 1,
          middle: element.getAttribute('data-middle') === 'true',
          last: element.getAttribute('data-last') === 'true',
        }
      }),
      folded: path?.getAttribute('data-collapsed') === 'true',
      foldCrumb: document.querySelector('[data-ide-path-fold]') !== null,
    }
  })
}

/**
 * Open the IDE for the seeded session.
 * @param page - the page under test.
 */
async function openIde(page: Page): Promise<void> {
  const groupRow = page.locator('[role="treeitem"]').first()
  await groupRow.waitFor({ timeout: 15_000 })
  await groupRow.click()
  const sessionRow = page.locator('[role="treeitem"]').nth(1)
  await sessionRow.waitFor({ timeout: 10_000 })
  await sessionRow.hover()
  const entry = page.getByRole('button', { name: 'Open in IDE' })
  if (await entry.count() > 0 && await entry.first().isVisible()) {
    await entry.first().click()
  } else {
    await page.getByRole('button', { name: /^Session actions for/ }).first().click()
    await page.getByRole('menuitem', { name: 'Open in IDE' }).click()
  }
  await page.locator('[data-ide-workspace]').waitFor({ state: 'attached', timeout: 20_000 })
}

describe('web e2e: the IDE workspace layout', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  it('tiles three columns, keeps the seams between them and tracks the code in the gutter', async () => {
    onTestFailed(() => { void saveFailureShot(page, 'web-e2e-ide-layout') })
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(FIXTURE, 'utf8'), SEED_ID)
    await writeFile(join(scaffold.workspaceCwd, 'main.ts'), SOURCE, 'utf8')
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.setViewportSize({ width: 1600, height: 900 })
    const tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    await openIde(page)
    // Open the file so the editor, the gutter and the status bar are real.
    await page.getByRole('treeitem', { name: /main\.ts/ }).click()
    await page.locator('[data-ide-gutter] span').first().waitFor({ state: 'attached', timeout: 15_000 })

    const geometry = await measure(page)

    // The three columns and the two seams tile the frame exactly.
    expect(geometry.seams).toHaveLength(2)
    expect(geometry.files.left).toBeCloseTo(geometry.workspace.left, 1)
    expect(geometry.files.right).toBeCloseTo(geometry.seams[0]!.left, 1)
    expect(geometry.seams[0]!.right).toBeCloseTo(geometry.code.left, 1)
    expect(geometry.code.right).toBeCloseTo(geometry.seams[1]!.left, 1)
    expect(geometry.seams[1]!.right).toBeCloseTo(geometry.assistant.left, 1)
    expect(geometry.assistant.right).toBeCloseTo(geometry.workspace.right, 1)
    // The frame does not scroll sideways.
    expect(geometry.overflowX).toBeLessThanOrEqual(0)
    // The code column keeps its share of the frame.
    expect(geometry.code.width).toBeGreaterThanOrEqual(320)
    // The status bar sits under the code it describes, inside the frame.
    expect(geometry.statusBar.bottom).toBeCloseTo(geometry.code.bottom, 1)
    // The gutter tracks the code line for line (a hairline of font rounding
    // is the tolerance, not a full line).
    expect(geometry.gutterLines).toBe(geometry.codeLines)
    expect(Math.abs(
      (geometry.gutterLine.top + geometry.gutterLine.height / 2)
      - (geometry.codeLine.top + geometry.codeLine.height / 2),
    )).toBeLessThanOrEqual(1)

    // The path is a crumb run: no segment is squeezed into a single letter.
    const squeezed = geometry.segments.filter(segment =>
      segment.width > 0 && !segment.middle && !segment.last && segment.clipped)
    expect(squeezed).toEqual([])
    expect(geometry.segments.length).toBeGreaterThan(1)
    // The project name (the last segment) is readable, not a clipped letter.
    const last = geometry.segments[geometry.segments.length - 1]!
    expect(last.width).toBeGreaterThan(40)

    // A narrow frame folds the middle segments into one "\u2026" crumb rather
    // than crushing every segment into one character.
    await page.setViewportSize({ width: 900, height: 700 })
    await expect.poll(async () => (await measure(page)).folded).toBe(true)
    const narrow = await measure(page)
    expect(narrow.foldCrumb).toBe(true)
    const narrowSqueezed = narrow.segments.filter(segment =>
      segment.width > 0 && !segment.middle && !segment.last && segment.clipped)
    expect(narrowSqueezed).toEqual([])
    // The project name survives the fold.
    const narrowLast = narrow.segments[narrow.segments.length - 1]!
    expect(narrowLast.width).toBeGreaterThan(40)

    // The app root resolves the same palette as the shell: the dist's default
    // plane must not leak into the app.
    const palette = await page.evaluate(() => {
      const read = (selector: string): string => {
        const element = document.querySelector(selector)
        return element === null ? '' : getComputedStyle(element).getPropertyValue('--hln-ui-bg-0').trim()
      }
      return { shell: read('html'), root: read('#root') }
    })
    expect(palette.root).toBe(palette.shell)
    expect(palette.root).not.toBe('#f7f5f1')

    // The composer's fade band lands on the app's own surface: a light band
    // across the dark IDE is the regression this guards.
    const band = await page.evaluate(() => {
      const seat = document.querySelector('[data-composer-seat]')
      if (seat === null) return null
      return getComputedStyle(seat).backgroundImage
    })
    expect(band).not.toBeNull()
    const stops = [...band!.matchAll(/rgba?\(([^)]+)\)/g)]
      .map(match => match[1]!.split(',').map(part => Number.parseFloat(part)))
    expect(stops.length).toBeGreaterThan(0)
    for (const stop of stops) {
      const luminance = 0.2126 * stop[0]! + 0.7152 * stop[1]! + 0.2992 * stop[2]!
      expect(luminance).toBeLessThan(128)
    }

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 120_000)
})
