/** CSS activity and reduced-motion rules that jsdom does not execute. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/TextShimmer.module.css', import.meta.url), 'utf8')

describe('TextShimmer styles', () => {
  it('animates active text and disables motion and transparent fill for reduced motion', () => {
    expect(css).toMatch(/\.sweep\s*\{[^}]*animation-name: dsh-row-shimmer-sweep/s)
    expect(css).toMatch(/@keyframes dsh-row-shimmer-sweep\s*\{[^}]*transform: translateX\(-100%\)/s)
    const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]+)\}\s*$/.exec(css)?.[1]
    expect(reduced).toContain('.decoration')
    expect(reduced).toContain('display: none')
    expect(reduced).toContain('animation: none')
  })
})