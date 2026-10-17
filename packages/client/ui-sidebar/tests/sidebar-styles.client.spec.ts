/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Merged declarations of every rule whose selector list contains one exact
 * selector; later rules override earlier ones.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.slice(0, css.indexOf('@media (prefers-reduced-motion')).replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(/,(?![^()]*\))/u).map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

describe('SidebarRoot.module.css', () => {
  it('shares and cancels the wide shell trailing padding structurally', () => {
    const root = declarations('.root')
    expect(root?.get('--dsh-sidebar-inline-padding')).toBe('12px')
    expect(root?.get('padding')).toBe('6px var(--dsh-sidebar-inline-padding)')
    expect(declarations('.regionArea')?.get('margin-left')).toBe('-4px')
    expect(declarations('.regionArea')?.get('padding-left')).toBe('4px')
    expect(declarations('.regionArea')?.get('margin-right')).toBe(
      'calc(-1 * var(--dsh-sidebar-inline-padding))',
    )
    expect(declarations('.collapsed .regionArea')?.get('margin-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('padding-left')).toBe('0')
    expect(declarations('.collapsed .regionArea')?.get('margin-right')).toBe('0')
  })

  it('moves the four upper controls while the settings seat only fades', () => {
    const animation = 'rail-in 150ms var(--ds-ease-in-out) backwards'
    for (const selector of [
      '.railIn .iconButton',
      '.railIn .newSession',
      '.railIn .regionArea',
    ]) {
      expect(declarations(selector)?.get('animation')).toBe(animation)
    }
    expect(declarations('.railIn .footArea')?.get('animation')).toBe(
      'rail-fade-in 150ms var(--ds-ease-in-out) backwards',
    )
    expect(css).toMatch(
      /@keyframes rail-in\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateX\(49px\);\s*}\s*}/,
    )
    expect(css).toMatch(/@keyframes rail-fade-in\s*\{\s*from\s*\{\s*opacity: 0;\s*}\s*}/)
  })

  it('gives shell rail controls the same base anchor for their shared translation', () => {
    expect(declarations('.collapsed .logoRow')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.collapsed .newSession')?.get('align-self')).toBe('flex-start')
    expect(declarations('.collapsed .newSession')?.get('width')).toBe('36px')
  })

  it('keeps the slotted brand row at the full artwork height', () => {
    expect(declarations('.brandIdentity')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('line-height')).toBe('24px')
    expect(declarations('.brandName')?.get('font-size')).toBe('18px')
    expect(declarations('.fallbackBrandName')?.get('font-size')).toBe('17px')
    expect(declarations('.fallbackBrandName')?.get('white-space')).toBe('nowrap')
  })

  it('centers New Session against the full button while reserving its shortcut', () => {
    expect(declarations('.newSessionLabelMask')?.get('flex')).toBe('1')
    expect(declarations('.newSessionLabelMask')?.get('min-width')).toBe('0')
    expect(declarations('.newSessionContent')?.get('width')).toBe('100cqw')
    expect(declarations('.newSessionContent')?.get('align-items')).toBe('center')
    expect(declarations('.newSessionContent')?.get('justify-content')).toBe('center')
    expect(declarations('.newSessionContent')?.get('gap')).toBe('6px')
    expect(declarations('.newSessionShortcut')?.get('display')).toBe('inline-flex')
    expect(declarations('.newSessionShortcut')?.get('flex')).toBe('none')
    expect(declarations('.newSessionShortcut')?.get('opacity')).toBe('0')
    expect(
      declarations('.newSession:is(:hover, :focus-visible) .newSessionShortcut')?.get('opacity'),
    ).toBe('1')
    expect(
      declarations(
        '.newSession:is(:hover, :focus-visible) .newSessionLabelMask:has(+ .newSessionShortcut)',
      )?.get('overflow'),
    ).toBe('hidden')
    expect(
      declarations(
        '.newSession:is(:hover, :focus-visible) .newSessionLabelMask:has(+ .newSessionShortcut)',
      )?.get('mask-image'),
    ).toBe('linear-gradient(to right, black calc(100% - 16px), transparent)')
  })

  it('places collapsed Windows caption controls with their reserved geometry', () => {
    expect(
      declarations(':global([data-windows-titlebar]) .root:not(.collapsed) .newSession')?.get('margin-left'),
    ).toBe('0')
    const collapsed = declarations(':global([data-windows-titlebar]) .collapsed .newSession')
    expect(collapsed?.get('position')).toBe('fixed')
    expect(collapsed?.get('top')).toBe('calc((var(--dsh-windows-titlebar-height) - 28px) / 2)')
    expect(collapsed?.get('left')).toBe('48px')
    expect(collapsed?.get('width')).toBe('28px')
    expect(collapsed?.get('height')).toBe('28px')
    expect(collapsed?.get('border-radius')).toBe('50%')
    expect(
      declarations(
        ':global([data-windows-titlebar]) .railIn .newSession',
      )?.get('animation'),
    ).toBe('none')
    expect(
      declarations(
        ":global(html[data-windows-titlebar]:has([data-sidebar-collapsed='true']))",
      )?.get('--dsh-windows-menu-start'),
    ).toBe('84px')
  })

  it('keeps feature-owned text emphasis at 500 or lighter', () => {
    expect(declarations('.brandName')?.get('font-weight')).toBe('500')
    expect(declarations('.newSession')?.get('font-weight')).toBe('500')
    expect(declarations('.newSessionShortcut')?.get('font-weight')).toBe('400')
    expect(declarations('.buildVersion')?.get('font-weight')).toBe('500')
  })
})
