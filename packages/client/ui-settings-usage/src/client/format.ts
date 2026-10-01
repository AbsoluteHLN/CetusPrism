/**
 * Shared formatting for the usage section: the section translate face and the
 * compact token figure used by the summary cards, the table, and the chart.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-usage/client
 */

import type { UsageKey } from './locales.ts'

/** The section's translate face: one namespace key plus interpolation params. */
export type UsageTranslate = (key: UsageKey, params?: Record<string, string | number>) => string

/**
 * Compact token figure: K/M above the four-digit mark, exact below it.
 * @param value - the token count to render.
 * @param t - the section translate face, owning the unit copy.
 * @returns the localized compact figure.
 */
export function formatTokens(value: number, t: UsageTranslate): string {
  if (value >= 1_000_000) return t('tokens.million', { value: Number((value / 1_000_000).toFixed(1)) })
  if (value >= 10_000) return t('tokens.thousand', { value: Math.round(value / 1000) })
  return String(value)
}
