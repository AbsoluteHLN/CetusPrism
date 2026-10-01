/**
 * Desktop task-notification plugin, browser half — raises a Windows toast
 * when a session's turn ends while the window is unfocused. The payload
 * travels the `api-session/turn-ended` forwarded event; the toast itself
 * goes out through the desktop bridge's `notify` member, so a browser
 * surface without the shell stays a no-op.
 */

// Type-only: pulls the Session Controller service merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (the turn-ended event rides the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { en, zh, type DesktopNotifyKey } from './locales.ts'
import { turnEndedToast } from './notify.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop task-notification copy. */
    'desktop.notify': DesktopNotifyKey
  }
}

export type { DesktopNotifyKey } from './locales.ts'
export type { DesktopToastBridge, TurnEndedNotifyInput } from './notify.ts'
export { turnEndedToast } from './notify.ts'

/** Required services (cordis fiber inject). */
export const inject = ['locale', 'remote', 'sessions']

/** The dshDesktop member this plugin consumes; the shell injects the carrier. */
type DesktopNotifyCarrier = { readonly notify?: (options: { title: string; body: string }) => void }

/**
 * Register the dictionaries and the turn-ended listener.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('desktop.notify', { zh, en }), 'ui-desktop-notify: dictionaries')
  ctx.effect(() => {
    const t = ctx.locale.bind('desktop.notify')
    return ctx.remote.$on('api-session/turn-ended', (sessionId, kind) => {
      const notify = (globalThis as typeof globalThis & { dshDesktop?: DesktopNotifyCarrier }).dshDesktop?.notify
      const toast = turnEndedToast({
        kind,
        sessionId,
        summary: ctx.sessions.list.getSnapshot().byId[sessionId],
        hasFocus: document.hasFocus(),
        toast: notify,
        t,
      })
      if (toast !== undefined) notify?.(toast)
    })
  }, 'ui-desktop-notify: turn-ended listener')
}
