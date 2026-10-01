/**
 * Desktop-only custom titlebar for the frameless Electron shell, mounted by
 * the app entry when the preload bridge is present. A fixed top strip owns
 * window dragging and the Windows-convention controls; plain browser tabs
 * never mount it and never see the body flag that reserves the strip's
 * height. Visual styling lives in /hln-cetus-theme.css (dsh-titlebar
 * section) so the look ships with the rest of the tactical theme.
 * @module apps/web/desktop-titlebar
 */

/** Shape of the `dshDesktop` bridge exposed by the Electron preload. */
interface DshDesktopBridge {
  isDesktop: boolean
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  onWindowStateChange: (listener: (maximized: boolean) => void) => () => void
}

declare global {
  interface Window {
    dshDesktop?: DshDesktopBridge
  }
}

/** Strip height; must match the CSS in hln-cetus-theme.css. */
const TITLEBAR_HEIGHT_PX = 36

/**
 * Build one window-control button with an inline SVG glyph.
 * @param glyph - the two path `d` strings: [normal, maximized-state].
 * @param handler - click behavior (window control IPC).
 * @param extraClass - modifier class for hover styling.
 * @returns the button element.
 */
function controlButton(
  glyph: [string, string],
  handler: () => void,
  extraClass: string,
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `dsh-titlebar-btn ${extraClass}`
  button.setAttribute('aria-label', extraClass)
  button.addEventListener('click', handler)
  const normal = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  normal.setAttribute('d', glyph[0])
  const alt = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  alt.setAttribute('d', glyph[1])
  alt.setAttribute('data-maximized', '')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 12 12')
  svg.append(normal, alt)
  button.appendChild(svg)
  return button
}

/** Minimize glyph: a single bottom hairline. */
const GLYPH_MINIMIZE = ['M1 6.5 H11', 'M1 6.5 H11'] as const
/** Restore glyph: two offset squares (used while maximized). */
const GLYPH_RESTORE = ['M1.5 1.5 H10.5 V10.5 H1.5 Z', 'M3.5 3.5 H10.5 V10.5 H3.5 Z M1.5 8.5 V1.5 H8.5'] as const
/** Close glyph: an X. */
const GLYPH_CLOSE = ['M1.5 1.5 L10.5 10.5 M10.5 1.5 L1.5 10.5', 'M1.5 1.5 L10.5 10.5 M10.5 1.5 L1.5 10.5'] as const

/**
 * Mount the titlebar when running inside the desktop shell. In a plain
 * browser (`window.dshDesktop` absent) this is a no-op, so the web build
 * keeps its normal full-window layout.
 */
export function mountDesktopTitlebar(): void {
  const desktop = window.dshDesktop
  if (desktop === undefined || !desktop.isDesktop) return

  document.body.dataset.dshDesktop = ''

  const bar = document.createElement('div')
  bar.className = 'dsh-titlebar'
  bar.style.height = `${TITLEBAR_HEIGHT_PX}px`

  const controls = document.createElement('div')
  controls.className = 'dsh-titlebar-controls'
  controls.appendChild(controlButton([...GLYPH_MINIMIZE], () => { desktop.minimize() }, 'minimize'))
  const maximizeButton = controlButton([...GLYPH_RESTORE], () => { desktop.toggleMaximize() }, 'maximize')
  controls.appendChild(maximizeButton)
  controls.appendChild(controlButton([...GLYPH_CLOSE], () => { desktop.close() }, 'close'))

  bar.appendChild(controls)
  bar.addEventListener('dblclick', (event) => {
    if (event.target instanceof Element && event.target.closest('.dsh-titlebar-controls') !== null) return
    desktop.toggleMaximize()
  })
  document.body.appendChild(bar)

  // The maximize glyph mirrors the live window state pushed by the main
  // process; the drag-strip double-click shares the same toggle.
  desktop.onWindowStateChange((maximized) => {
    bar.classList.toggle('dsh-titlebar-maximized', maximized)
  })
}
