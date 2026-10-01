/**
 * Composer toggle for the session's computer-use delivery policy: reads the
 * `computerDelivery` projection view and submits the other mode through the
 * `/foreground` command — one write path shared with the slash command, the
 * pushed projection frame is the one confirmation. Hidden on hosts without
 * the delivery-policy service (the projection key never appears).
 */
import { useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ComputerUseDeliveryMode } from '@deepseek-ai/dsh-computer-use-policy/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { DeliveryForegroundKey } from './locales.ts'
import css from './DeliveryToggle.module.css'

/** Business face injected by the delivery package's slot registration. */
export interface DeliveryToggleInjected {
  /** Submit one current-session mode through the `/foreground` command writer. */
  submit: (mode: ComputerUseDeliveryMode) => Promise<boolean>
}

/** Complete props derived from the conversation slot, injected hooks, and locale. */
export type DeliveryToggleProps =
  PropsRuntime<'conversation.input.computerDelivery'>
  & InjectFace<DeliveryToggleInjected>
  & PropsLocale<'computerForeground'>

/**
 * Render the foreground toggle chip beside the permission control.
 * @param props - composed slot props.
 * @returns the chip, or null when the host offers no delivery policy.
 */
export function DeliveryToggle({ locked, submit, useProjection, t }: DeliveryToggleProps) {
  const view = useProjection('computerDelivery')
  const [pending, setPending] = useState(false)

  if (view === undefined) return null
  const blocked = view.mode === 'background-only'

  const toggle = (): void => {
    setPending(true)
    void submit(blocked ? 'allow-foreground' : 'background-only')
      .catch(() => false)
      .then(() => { setPending(false) })
  }

  return (
    <button
      type="button"
      className={css.trigger}
      aria-pressed={blocked}
      title={t('description')}
      disabled={locked || pending}
      onClick={toggle}
    >
      <span className={css.triggerIcon} aria-hidden>
        <svg viewBox="0 0 16 16" width="16" height="16">
          <rect x="1.5" y="3.5" width="9" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <rect x="6.5" y="6.5" width="8" height="7" rx="1.5" fill="currentColor" />
        </svg>
      </span>
      <span className={css.triggerLabel}>{blocked ? t('state.blocked') : t('state.allow')}</span>
    </button>
  )
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Composer computer-use delivery toggle copy. */
    computerForeground: DeliveryForegroundKey
  }
}
