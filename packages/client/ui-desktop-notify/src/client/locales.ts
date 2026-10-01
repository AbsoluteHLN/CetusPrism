/** Locale bundles for the desktop task-notification toasts. */

/** Locale keys the notification toasts render. */
export type DesktopNotifyKey =
  | 'completeTitle'
  | 'failedTitle'
  | 'completeBody'
  | 'failedBody'

/** English copy. */
export const en: Record<DesktopNotifyKey, string> = {
  completeTitle: 'Task completed',
  failedTitle: 'Task failed',
  completeBody: '“{title}” finished.',
  failedBody: '“{title}” did not finish.',
}

/** Simplified Chinese copy. */
export const zh: Record<DesktopNotifyKey, string> = {
  completeTitle: '任务完成',
  failedTitle: '任务失败',
  completeBody: '「{title}」的任务已完成',
  failedBody: '「{title}」的任务未能完成',
}
