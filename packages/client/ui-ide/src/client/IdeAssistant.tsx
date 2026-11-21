/**
 * The IDE's right column: the assistant conversation of the bound Session.
 *
 * The column renders the SHARED Conversation content in its `embedded`
 * variant, under an explicit Session binding: the IDE is about one Session,
 * so the conversation beside the code is that Session's, not whatever the
 * sidebar happens to have selected.
 *
 * The conversation itself is not re-implemented here — the shared content
 * factory owns the message flow, the composer and the views; this column
 * only decides WHICH Session it speaks for.
 */

import type { ReactNode } from 'react'
import {
  IconChevronRightOutlineRegular, IconThinkOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  PropsRenderFactories, PropsRenderSlots, PropsRuntime, SessionProviderComponent,
} from '@deepseek-ai/dsh-client-ui-slots'
import { IdePaneHeader } from './IdePaneHeader.tsx'
import type { IdeKey } from './locales.ts'
import css from './IdeWorkspace.module.css'

/** The props of the assistant pane. */
export interface IdeAssistantProps {
  /** The retained Session reference the column speaks for. */
  readonly reference: SessionReference | undefined
  /** The bound Session's display title, for the pane header. */
  readonly sessionTitle: string | undefined
  /** Whether the column is folded to its icon rail. */
  readonly collapsed: boolean
  /** Fold the column to its rail, or bring it back. */
  readonly toggleCollapsed: () => void
  /** Render the declared assistant child slot. */
  readonly renderSlot: PropsRenderSlots<'ide.assistant'>['renderSlot']
  /** Bind the subtree to one Session. */
  readonly SessionProvider: SessionProviderComponent
  /** The localized copy of the column. */
  readonly t: (key: IdeKey) => string
}

/**
 * Render the assistant column.
 * @param props - the Session reference, the slot renderer, and the copy.
 * @returns the right column.
 */
export function IdeAssistant(props: IdeAssistantProps): ReactNode {
  const { reference, sessionTitle, collapsed, toggleCollapsed, renderSlot, SessionProvider, t } = props
  if (collapsed) {
    return (
      <aside className={css.assistantPane} aria-label={t('assistant.aria')} data-ide-pane="assistant" data-collapsed="true">
        <button
          type="button"
          className={css.railButton}
          aria-label={t('assistant.expand')}
          onClick={() => { toggleCollapsed() }}
        >
          <IconThinkOutlineRegular size={15} />
        </button>
      </aside>
    )
  }
  return (
    <aside className={css.assistantPane} aria-label={t('assistant.aria')} data-ide-pane="assistant">
      <IdePaneHeader
        icon={<IconThinkOutlineRegular size={15} />}
        title={t('pane.assistant')}
        detail={sessionTitle === undefined ? undefined : <span title={sessionTitle}>{sessionTitle}</span>}
        ariaLabel={t('pane.assistant.aria')}
        actions={
          <button
            type="button"
            className={css.paneButton}
            aria-label={t('assistant.collapse')}
            title={t('assistant.collapse')}
            onClick={() => { toggleCollapsed() }}
          >
            <IconChevronRightOutlineRegular size={14} />
          </button>
        }
      />
      <div className={css.assistantBody}>
        {reference === undefined
          ? <p className={css.assistantEmpty}>{t('assistant.empty')}</p>
          : (
            <SessionProvider session={reference}>
              {renderSlot('ide.assistant', {})}
            </SessionProvider>
          )}
      </div>
    </aside>
  )
}

/** Fixed Chat selection used by an embedded Conversation occurrence. */
export function FixedChatConversationView(props: ConversationViewsProps): ReactNode {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

/** The props supplied to the assistant's Conversation host. */
export type IdeConversationProps = PropsRuntime<'ide.assistant'> & PropsRenderFactories

/**
 * Render the shared Conversation content for the IDE's bound Session.
 * @param props - the Session sources and the factory renderer.
 * @returns the embedded Conversation.
 */
export function IdeConversation(props: IdeConversationProps): ReactNode {
  const { sessionId, useSession, useConversation, useSessions, renderFactorySlot } = props
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  // Every hook is called before the early return: the Session arrives later
  // than the column does, and a hook behind a conditional would make the
  // next render call fewer hooks than the last one.
  const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
  if (session === undefined || conversation === undefined) return null
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const settling = (shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true)
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  // The IDE's column is a second surface beside the code, not the product's
  // own conversation: it asks for the REDUCED composer, so the column shows
  // the text surface, the command button and the submit action only. The mode
  // chips (including the computer-use delivery switch), the model selector
  // and the metric row stay in the main panel, where they belong.
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero, compact: true }, {
    slots: { views: FixedChatConversationView },
  })
}
