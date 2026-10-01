// CetusPrism brand mark (rail glyph): the prism triangle from the wordmark.
// Square canvas so it slots into icon rows; ink rides currentColor and the
// prism core carries the tactical accent (wordmark ink).

import type { IconProps } from './icons/props.ts'

/** Native viewBox of {@link FISH_LOGO_PATH} (width and height in user units). */
export const FISH_LOGO_VIEWBOX = { width: 24, height: 21 }

/** The prism silhouette path data, exported for consumers that compose their own svg (entrance effects, masks) around the same geometry. */
export const FISH_LOGO_PATH =
  'M12 1.6 22.6 20.2H1.4Z M12 8.2 17.2 15.8H6.8Z'

/**
 * Render the prism brand mark.
 * @param props.size - width in px (default 24; height keeps the 24:21 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function FishLogo({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={(size * FISH_LOGO_VIEWBOX.height) / FISH_LOGO_VIEWBOX.width}
      className={className}
      viewBox={`0 0 ${FISH_LOGO_VIEWBOX.width} ${FISH_LOGO_VIEWBOX.height}`}
      fill="none"
      aria-hidden="true"
    >
      <path d="M12 1.6 22.6 20.2H1.4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="bevel" />
      <path d="M12 8.2 17.2 15.8H6.8Z" fill="var(--dsw-alias-state-business-primary, #00e5ff)" />
    </svg>
  )
}
