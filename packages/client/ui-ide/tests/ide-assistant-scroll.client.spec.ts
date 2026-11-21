/**
 * The IDE's assistant column scroll contract, as CSS text.
 *
 * The right column hosts the SHARED Conversation content in its `embedded`
 * variant. That conversation owns its own scrolling: `.body` is a flex column
 * whose `.scrollBody` child carries `overflow-y: auto` and whose composer seat
 * is `position: sticky; bottom: 0` — the composer stays pinned to the bottom
 * of the column while the transcript scrolls under it.
 *
 * That only holds when the host gives the conversation a DEFINITE height. The
 * slot anchors are `display: contents`, so `.body` is the layout child of the
 * IDE's assistant body: a block box there leaves `.body` height-auto,
 * `.scrollBody` never overflows, and the sticky composer has no scrollport to
 * stick to. The whole column — transcript, composer and footer — then scrolls
 * as one block and the composer rides away with the messages.
 *
 * jsdom has no layout, so these read the declarations that hold the column's
 * scroll ownership, the same way ui-chat reads its font-size axis.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/client/${name}`, import.meta.url)), 'utf8')

function declarationsFrom(source: string, selector: string): string[] {
  const declarationText = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const rule = new RegExp(`(?:^|[{}])\\s*${selector.replace(/[.[\]():*+^$\\]/g, '\\$&')}\\s*\\{([^{}]*)\\}`).exec(declarationText)
  if (rule === null) throw new Error(`no \`${selector}\` rule`)
  return (rule[1] ?? '').split(';').map(part => part.trim()).filter(Boolean)
}

const css = read('IdeWorkspace.module.css')

describe('the IDE assistant column scroll contract', () => {
  it('gives the embedded conversation a definite height to fill', () => {
    // The pane is the column: a flex column whose children (the pane header
    // and the conversation body) stack, so the body can be sized.
    expect(declarationsFrom(css, '.assistantPane')).toEqual(expect.arrayContaining([
      'display: flex',
      'flex-direction: column',
      'min-height: 0',
    ]))
    // The body is the conversation's HOST: a flex row whose single layout
    // child (the conversation body) stretches to the pane's height.
    expect(declarationsFrom(css, '.assistantBody')).toEqual(expect.arrayContaining([
      'display: flex',
      'flex: 1',
      'min-width: 0',
      'min-height: 0',
    ]))
  })

  it('leaves the scrolling to the conversation instead of scrolling the column', () => {
    const body = declarationsFrom(css, '.assistantBody')
    // `overflow: auto` here would make THIS box the scrollport: the composer
    // seat's sticky bottom would have no scrollport of its own to stick to,
    // and the whole column would scroll as one block.
    expect(body).toContain('overflow: hidden')
    expect(body).not.toContain('overflow: auto')
    expect(body).not.toContain('overflow-y: auto')
  })
})
