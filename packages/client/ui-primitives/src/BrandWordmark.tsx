// CetusPrism brand wordmark: prism-triangle mark + "CETUS//PRISM" letterforms.
// Ink rides currentColor; the prism core carries the tactical accent so the
// mark reads on both obsidian and steel surfaces.

import type { IconProps } from './icons/props.ts'

/** Display options for the CetusPrism brand wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading prism mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width follows the intrinsic ratio).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading prism mark.
 * @returns the wordmark (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.42, height: size }}
      aria-hidden="true"
    >
      {includeMark && (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M12 2.4 22 20.6H2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="bevel" />
          <path d="M12 8.4 16.9 17.3H7.1Z" fill="var(--dsw-alias-state-business-primary, #00e5ff)" />
        </svg>
      )}
      <span
        style={{
          fontFamily: 'var(--hln-ui-font-display, var(--dsw-font-family, sans-serif))',
          fontSize: size * 0.82,
          fontWeight: 700,
          letterSpacing: '0.13em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          color: 'currentColor',
        }}
      >
        CETUS
        <span style={{ color: 'var(--dsw-alias-state-business-primary, #00e5ff)' }}>//</span>
        PRISM
      </span>
    </span>
  )
}
