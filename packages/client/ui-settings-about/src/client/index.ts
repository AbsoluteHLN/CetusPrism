/**
 * About & acknowledgements settings section, browser half: one
 * `settings.section` entry (关于与鸣谢) carrying the distribution's own
 * version, the harness core build it embeds, the upstream credit, and the
 * non-affiliation statement. The section owns no Host calls — everything it
 * renders is compile-time client build metadata plus static copy, so it
 * renders identically offline.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.locale merge into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings slot declarations (ctx.slots 'settings.section').
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { AboutSection } from './AboutSection.tsx'
import { en, NS, zh, type AboutKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** About & acknowledgements section copy. */
    'settings.about': AboutKey
  }
}

export type { AboutSectionProps } from './AboutSection.tsx'
export { NS, type AboutKey } from './locales.ts'

/**
 * Required services (cordis fiber inject). The target slots are declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on its slot through `slots.inject()`.
 */
export const inject = ['slots', 'locale']

/**
 * Register the `settings.about` dictionaries and the About section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-about: copy dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'about',
    order: 30,
    label: () => t('nav'),
    locale: NS,
  }, AboutSection))
}
