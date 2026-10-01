/** Static identity of the Computer tab type and its guide entry. */
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { IconPersonalizationOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from './locales.ts'

/** The tab kind this package owns. */
export const COMPUTER_KIND = 'computer'

/** This implementation's identity in the tab system, and the key its body registers under. */
export const COMPUTER_ID = '@deepseek-ai/dsh-client-ui-sidebar-computer'

/**
 * The Computer type's registry definition.
 * @param t - namespace-bound translate, read fresh on every label call.
 * @returns the definition to register.
 */
export function computerDefinition(t: TranslateNS<'sidebarComputer'>): SidebarRightTabDefinition {
  return {
    id: COMPUTER_ID,
    kind: COMPUTER_KIND,
    priority: 'builtin',
    title: () => t('type.label'),
    guide: [{
      id: 'computer',
      order: 35,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: IconPersonalizationOutlineRegular,
    }],
  }
}
