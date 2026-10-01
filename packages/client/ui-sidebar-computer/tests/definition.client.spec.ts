// @vitest-environment jsdom
/**
 * Stage one, as the registry sees it: the type is a page that claims no
 * address, sits in the builtin band, and offers the guide page one entry that
 * opens its kind.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { cleanup, render } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { COMPUTER_ID, COMPUTER_KIND, computerDefinition } from '../src/client/definition.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

describe('computerDefinition', () => {
  it('registers under its kind and id and claims no address', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(computerDefinition(t))
    expect(registry.get(COMPUTER_KIND)?.id).toBe(COMPUTER_ID)
    expect(registry.candidates('dsh-resource://file/session/s-1/a.ts')).toEqual([])
  })

  it('offers the guide page one entry at order 35 that opens the computer kind', () => {
    const registry = new SidebarRightTabRegistry(new Context())
    registry.register(computerDefinition(t))
    const computer = registry.guide().find(entry => entry.kind === COMPUTER_KIND)
    expect(computer?.order).toBe(35)
    expect(computer?.title()).toBe(zh['guide.title'])
    expect(computer?.description?.()).toBe(zh['guide.description'])
    if (computer?.icon === undefined) throw new Error('expected the guide icon')
    const icon = render(createElement(computer.icon, { size: 26 }))
    expect(icon.container.querySelector('svg')?.getAttribute('width')).toBe('26')
  })

  it('sits in the builtin band and titles itself from the dictionary', () => {
    const definition = computerDefinition(t)
    expect(definition.priority).toBe('builtin')
    expect(definition.patterns).toBeUndefined()
    expect(definition.title('')).toBe(zh['type.label'])
  })
})
