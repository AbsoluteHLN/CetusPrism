/**
 * Usage statistics settings section, browser half: one `settings.section`
 * entry (用量统计) that folds every visible Session row's `tokenUsage`,
 * `usageTimeline`, and `sessionStats` projections — values the Host list
 * already carries for cold and live Sessions alike — into bucket totals, a
 * daily token trend chart, and a per-session table. The section owns no
 * Remote calls: the Session list store is the whole data path, so the panel
 * converges on the same pushes the Session sidebar renders.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.locale merge into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings slot declarations (ctx.slots 'settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.sessions merge plus the SessionProjectionMap members this
// section reads (tokenUsage, usageTimeline, sessionStats).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { UsageSection } from './UsageSection.tsx'
import { en, NS, zh, type UsageKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Usage statistics section copy. */
    'settings.usage': UsageKey
  }
}

export type { UsageSectionProps, UsageSectionInjected } from './UsageSection.tsx'
export type { UsageAggregate, UsageRow, UsageSessionRow } from './aggregate.ts'
export { aggregateUsage } from './aggregate.ts'
export { NS, type UsageKey } from './locales.ts'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on its slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Register the `settings.usage` dictionaries and the Usage section, once its
 * slot declaration is on the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-usage: copy dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage',
    order: 12,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ hooks: { sessions: ctx.sessions.list } }),
  }, UsageSection))
}
