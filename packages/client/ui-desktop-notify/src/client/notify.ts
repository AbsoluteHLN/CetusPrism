/**
 * Turn-ended toast decision, isolated from Cordis so the suppression rules
 * stay unit-testable: only a user-started session's `completed` or `error`
 * turn end notifies, and only while the document is unfocused.
 */

/** The desktop shell's toast entry point, `dshDesktop.notify`. */
export type DesktopToastBridge = (options: { title: string; body: string }) => void

/** Locale face the toast copy resolves through. */
export type NotifyTranslate = (
  key: 'completeTitle' | 'failedTitle' | 'completeBody' | 'failedBody',
  params?: Record<string, unknown>,
) => string

/** Everything the notification decision reads. */
export interface TurnEndedNotifyInput {
  /** Turn-end reason kind, as carried by `api-session/turn-ended`. */
  kind: string
  /** Session identity whose turn ended; labels the toast when the row is gone. */
  sessionId: string
  /** The Session's list row; absent rows and subagent rows stay silent. */
  summary: { displayTitle: string; origin?: 'subagent' } | undefined
  /** Whether the document currently holds focus. */
  hasFocus: boolean
  /** The desktop bridge's notify member; absent outside the desktop shell. */
  toast: DesktopToastBridge | undefined
  /** Locale-bound translator for this plugin's namespace. */
  t: NotifyTranslate
}

/**
 * Resolve the toast a turn end should raise, or undefined to stay silent.
 * @param input - Every input the decision reads; nothing else is observed.
 * @returns Toast options for `dsh_notify`, or undefined when silent.
 */
export function turnEndedToast(input: TurnEndedNotifyInput): { title: string; body: string } | undefined {
  // Subagent turns end inside a parent task; the user's task is the parent.
  if (input.summary === undefined || input.summary.origin === 'subagent') return undefined
  // Focused means the user is looking at the result already.
  if (input.hasFocus) return undefined
  if (input.toast === undefined) return undefined
  const title = input.summary.displayTitle
  if (input.kind === 'completed') {
    return { title: input.t('completeTitle'), body: input.t('completeBody', { title }) }
  }
  if (input.kind === 'error') {
    return { title: input.t('failedTitle'), body: input.t('failedBody', { title }) }
  }
  return undefined
}
