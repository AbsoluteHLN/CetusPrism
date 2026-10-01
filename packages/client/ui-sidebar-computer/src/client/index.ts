/**
 * Browser half: register `computer` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat under the type's `id`.
 * No chip-title registration: the registry's captured title is the label.
 *
 * The file split is this package's layering: what the type IS
 * (`definition.tsx`), what it derives (`model.ts`), what it draws
 * (`view/ComputerBody.tsx`), what it says (`locales.ts`), and this module,
 * which only wires them together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { COMPUTER_ID, computerDefinition } from './definition.tsx'
import { ComputerBody } from './view/ComputerBody.tsx'
import type { ComputerInjected } from './view/ComputerBody.tsx'
import { en, zh } from './locales.ts'

export type { SidebarComputerKey } from './locales.ts'
export type { ComputerInjected, ComputerBodyProps } from './view/ComputerBody.tsx'
export type { ComputerActivity, ComputerAction } from './model.ts'

/** This package's copy namespace. */
const NS = 'sidebarComputer'

/**
 * Resolve the session-scoped Conversation action face, failing loud, exactly as
 * the composer resolves its stop gesture.
 * @param sessions - the Client Session manager.
 * @param id - the tab's Session.
 * @returns the Conversation action face.
 */
function sessionConversation(sessions: ISessions, id: SessionId): IConversation {
  const scoped = sessions.scope(id)
  if (scoped === undefined) throw new Error(`ui-sidebar-computer: session "${id}" resolved no scope`)
  const conversation = scoped.get('conversation')
  if (conversation === undefined) {
    throw new Error('ui-sidebar-computer: conversation service unavailable through the session scope')
  }
  return conversation
}

/**
 * Required browser services: the tab registry, the keyed seat, copy, the
 * Session scope carrier, and the Conversation service.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sessions', 'uiConversation']

/**
 * Client plugin body: register the type, its dictionaries, and its body.
 * @param ctx - client root context carrying the registry, the slots, the
 *   Session scope, and the Conversation service.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(computerDefinition(t)), 'ui-sidebar-computer: computer type')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-computer: dictionaries')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: COMPUTER_ID,
      locale: NS,
      inject: (sessionId): ComputerInjected => ({
        stop: () => {
          sessionConversation(ctx.sessions, sessionId).cancel().catch(() => {
            // Stop failure is published through Session promptError, as the composer's path.
          })
        },
        loadImage: attachment => ctx.uiConversation.imageUrl(sessionId, attachment),
      }),
    },
    ComputerBody,
  )), 'ui-sidebar-computer: computer tab body')
}
