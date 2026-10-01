/**
 * Computer-use delivery toggle plugin, browser half — one composer chip hung
 * beside the permission control: reads the `computerDelivery` projection view
 * (absent key = no policy service = hidden chip) and writes the other mode
 * through the `/foreground` command line, so both surfaces share one write
 * path and the pushed projection frame is the one confirmation. A rejected
 * submit surfaces through the composer's own notice channel — a session held
 * by another DSH instance reads as the session-in-use refusal, everything
 * else as the host's error message.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ComputerUseDeliveryMode } from '@deepseek-ai/dsh-computer-use-policy/client'
import { DeliveryToggle } from './DeliveryToggle.tsx'
import type { DeliveryToggleInjected } from './DeliveryToggle.tsx'
import { en, zh } from './locales.ts'

export type { DeliveryForegroundKey } from './locales.ts'
export type { DeliveryToggleInjected, DeliveryToggleProps } from './DeliveryToggle.tsx'

/** This package's copy namespace. */
const NS = 'computerForeground'

/**
 * Submit one delivery mode through the `/foreground` command writer, failing
 * loud on an absent session, a failed execution, or a host without the
 * command; the thrown message is already the composer notice copy — a
 * writer-held session reads as the session-in-use refusal, everything else as
 * the foreground-switch failure.
 * @param sessions - the Client Session manager.
 * @param sessionId - the composer's Session.
 * @param mode - the delivery mode to switch to.
 * @param t - the package's translator, for the notice copy.
 * @returns true when the host accepted the switch.
 */
async function submitDelivery(
  sessions: ISessions,
  sessionId: SessionId,
  mode: ComputerUseDeliveryMode,
  t: TranslateNS<typeof NS>,
): Promise<boolean> {
  const live = sessions.binding(sessionId)?.session
  if (live === undefined) throw new Error(t('error.submit', { message: 'this session is not materialized yet' }))
  const result = await live.command(`/foreground ${mode}`)
  if (!result.ok) {
    throw new Error(
      result.error.code === 'session/writer-held'
        ? t('error.sessionInUse')
        : t('error.submit', { message: `${result.error.code}: ${result.error.message}` }),
    )
  }
  if (!result.value.matched) throw new Error(t('error.submit', { message: 'the host offers no /foreground command' }))
  return true
}

/** Required browser services: the slot seat, copy, and the Session manager. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Client plugin body: register the dictionaries and the composer toggle seat.
 * @param ctx - client root context carrying the slots, locale, and Sessions.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-computer-foreground: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.slots.inject('conversation.input.computerDelivery', () => ctx.slots.register(
    {
      name: 'conversation.input.computerDelivery',
      locale: NS,
      inject: (sessionId: SessionId): DeliveryToggleInjected => ({
        submit: (mode) => {
          const noticed = (error: unknown): false => {
            const message = error instanceof Error ? error.message : String(error)
            const actx = ctx.sessions.scope(sessionId)
            if (actx !== undefined) {
              actx.get('conversation')?.input.for(actx).notify('error', message)
            } else {
              console.error('[ui-computer-foreground] submit failed:', error)
            }
            return false
          }
          return submitDelivery(ctx.sessions, sessionId, mode, t).catch(noticed)
        },
      }),
    },
    DeliveryToggle,
  )), 'ui-computer-foreground: composer toggle seat')
}
