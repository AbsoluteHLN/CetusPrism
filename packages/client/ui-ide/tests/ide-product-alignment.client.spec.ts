/**
 * The IDE's alignment with the CetusPrism product surface, as CSS text.
 *
 * The IDE is a panel of THIS product, not a second product wearing a code
 * editor's skin. Its shapes are taken from the application's own central
 * panel (ui-conversation ConversationRoot.module.css) and from the Sidebar's
 * rows (ui-workspace Rows.module.css):
 *
 * - the title bar is the conversation header's geometry — 20/28px side
 *   padding, a 0.5px l3 rule under it, the session title as the current crumb
 *   (500, label-primary), the project path as its ancestor crumbs with "/"
 *   separators, and ghost controls with a hover wash;
 * - the tab strip is the conversation's view tabs — 13px/500, tertiary, the
 *   active one business-primary with a 2px underline;
 * - the file tree rows are the Sidebar's rows — radius-md and the interactive
 *   hover fill, for hover and for the current row alike;
 * - the column headers are section labels and the status bar is the
 *   composer's metric row: no band behind them, no rule under them.
 *
 * jsdom has no layout, so these read the declarations that hold the
 * alignment — and the ones that would break it again.
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

describe('the IDE panel alignment with the product surface', () => {
  it('borrows the conversation header’s geometry for its title bar', () => {
    expect(declarationsFrom(css, '.titleBar')).toEqual(expect.arrayContaining([
      'height: 40px',
      'padding: 0 28px 0 20px',
      'border-bottom: 0.5px solid var(--dsw-alias-border-l3)',
      'background: transparent',
    ]))
    // The session title is the CURRENT CRUMB: the app's own header weight and
    // colour, not a bolder stand-in.
    expect(declarationsFrom(css, '.titleSession')).toEqual(expect.arrayContaining([
      'font-weight: 500',
      'color: var(--dsw-alias-label-primary)',
    ]))
    // The path's separators are the app's caption-coloured "/".
    expect(declarationsFrom(css, '.titlePathSep')).toEqual(expect.arrayContaining([
      'color: var(--dsw-alias-label-caption)',
    ]))
  })

  it('uses the product’s ghost controls instead of bordered buttons', () => {
    const button = declarationsFrom(css, '.titleButton')
    expect(button).toContain('border: 0')
    expect(button).toContain('background: transparent')
    expect(button).not.toContain('border: 1px solid var(--dsw-alias-border-l2)')
    expect(declarationsFrom(css, '.titleButton:hover')).toContain(
      'background: var(--dsw-alias-interactive-bg-hover)',
    )
  })

  it('labels the columns with type, not with a banded toolbar', () => {
    const header = declarationsFrom(css, '.paneHeader')
    // No band behind the label and no rule under it: the columns are
    // separated by their own seams.
    expect(header).not.toContain('border-bottom: 1px solid var(--dsw-alias-border-l1)')
    expect(header).not.toContain('background: var(--dsw-alias-bg-layer-2)')
    const title = declarationsFrom(css, '.paneTitle')
    expect(title).toContain('font-size: 13px')
    // The product never shouts its section labels.
    expect(title).not.toContain('text-transform: uppercase')
    expect(title).not.toContain('letter-spacing: 0.06em')
  })

  it('marks the current file with the product’s underline tab', () => {
    expect(declarationsFrom(css, '.tab')).toEqual(expect.arrayContaining([
      'font-size: 13px',
      'font-weight: 500',
      'color: var(--dsw-alias-label-tertiary)',
    ]))
    expect(declarationsFrom(css, ".tab[data-active='true']")).toContain(
      'color: var(--dsw-alias-state-business-primary)',
    )
    expect(declarationsFrom(css, ".tab[data-active='true']::after")).toContain(
      'background: var(--dsw-alias-state-business-primary)',
    )
  })

  it('marks the current tree row the way the Sidebar marks its rows', () => {
    const row = declarationsFrom(css, '.treeRow')
    expect(row).toContain('border-radius: var(--dsw-radius-md)')
    expect(row).not.toContain('text-transform: uppercase')
    // The current row washes like the hovered one: the product has no accent
    // bar on a selected row.
    expect(declarationsFrom(css, ".treeRow[data-active='true']")).toEqual(expect.arrayContaining([
      'background: var(--dsw-alias-interactive-bg-hover)',
      'color: var(--dsw-alias-label-primary)',
    ]))
  })

  it('keeps the status bar flat, like the composer’s metric row', () => {
    const status = declarationsFrom(css, '.statusBar')
    expect(status).toContain('background: transparent')
    expect(status).toContain('font-size: 12px')
    expect(status).not.toContain('border-top: 1px solid var(--dsw-alias-border-l2)')
    expect(status).not.toContain('background: var(--dsw-alias-bg-layer-2)')
  })

  it('gives the frame one row of columns and keeps the status bar under the code', () => {
    // The title bar and the three columns: the status bar is no longer a
    // third row spanning the whole frame.
    expect(declarationsFrom(css, '.workspace')).toContain('grid-template-rows: auto minmax(0, 1fr)')
    const status = declarationsFrom(css, '.statusBar')
    expect(status).not.toContain('grid-column: 1 / -1')
    expect(status).toContain('flex: none')
  })

  it('lets the source fill its column instead of floating as a card', () => {
    const surface = declarationsFrom(css, '.codeSurface')
    expect(surface).toContain('position: relative')
    expect(surface).toContain('overflow: hidden')
    // The text does not wrap: a source line is a line.
    expect(declarationsFrom(css, '.codeInput')).toEqual(expect.arrayContaining([
      'white-space: pre',
      'overflow: auto',
    ]))
    // No margin and no card around the source.
    expect(declarationsFrom(css, '.codeLayer')).not.toContain('margin: 16px')
  })

  it('gives the gutter its own width, so a line number is never clipped', () => {
    const gutter = declarationsFrom(css, '.gutter')
    expect(gutter).toContain('flex: none')
    expect(gutter).toContain('overflow: hidden')
    // A fixed column, not a two-character box that cuts "11" down to "1".
    expect(gutter.some(declaration => /^width: \d+px$/.test(declaration))).toBe(true)
    expect(declarationsFrom(css, '.gutterLine')).toContain('text-align: end')
  })

  it('scrolls the tab strip sideways instead of letting two tabs overlap', () => {
    expect(declarationsFrom(css, '.tabs')).toContain('overflow-x: auto')
    expect(declarationsFrom(css, '.tab')).toContain('flex: none')
    expect(declarationsFrom(css, '.tab')).toContain('white-space: nowrap')
  })
})
