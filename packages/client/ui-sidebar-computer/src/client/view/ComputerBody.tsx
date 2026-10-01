/**
 * The Computer tab's body: the live desktop frame and the assistant's
 * computer-action feed for the tab's session.
 *
 * Everything shown derives from two framework channels: the session-standard
 * Chat hook (the same transcript source the conversation renders) filtered to
 * the native Cua Driver tool family, and the session's running flag. The
 * component owns only one local fact — the resolved URL of the newest frame —
 * and one gesture, stopping the run the way the composer's stop button does.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { deriveComputerActivity } from '../model.ts'
import type { ComputerAction, ComputerActivity } from '../model.ts'
import type {} from '../locales.ts'
import css from './ComputerBody.module.css'

/** The apply world's face: the stop gesture and the session-authorized image loader. */
export interface ComputerInjected {
  /** Interrupt the session's current run, as the composer's stop button does. */
  stop: () => void
  /**
   * Resolve one durable image reference to a session-authorized browser URL.
   * @param attachment - reference from a settled computer-use result.
   * @returns the browser URL, owned by the Conversation image cache.
   */
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
}

/** The body's composed props: the standard session seat, the inject face, and copy. */
export type ComputerBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & ComputerInjected
  & PropsLocale<'sidebarComputer'>

/**
 * The control panel: a status line with the stop gesture, the newest captured
 * frame, and the capped newest-first action feed.
 * @param props - the tab seat, the inject face, and the copy.
 * @returns the panel body.
 */
export function ComputerBody({ useChat, useSession, t, stop, loadImage }: ComputerBodyProps): ReactNode {
  const chat = useChat(snapshot => snapshot)
  const runningSession = useSession(snapshot => snapshot.running)
  const activity = useMemo(
    () => deriveComputerActivity(chat.nodes.values(), t),
    [chat, t],
  )
  return (
    <div className={css.root}>
      <Header activity={activity} runningSession={runningSession} t={t} stop={stop} />
      <div className={css.scroll}>
        <Frame activity={activity} loadImage={loadImage} t={t} />
        <Feed activity={activity} t={t} />
      </div>
    </div>
  )
}

/** One header row: the live status dot, the state line, and the stop gesture. */
function Header({ runningSession, activity, t, stop }: {
  runningSession: boolean
  activity: ComputerActivity
  t: PropsLocale<'sidebarComputer'>['t']
  stop: () => void
}): ReactNode {
  return (
    <div className={css.header}>
      <div className={clsx(css.status, activity.running && css.statusRunning)}>
        <span
          className={clsx(css.dot, activity.running && css.dotRunning)}
          aria-label={activity.running ? t('status.running') : t('status.idle')}
        />
        <span>{activity.running ? t('status.running') : t('status.idle')}</span>
      </div>
      <button type="button" className={css.stop} disabled={!runningSession} onClick={stop}>
        {t('stop.label')}
      </button>
    </div>
  )
}

/**
 * The newest captured frame. The URL is component-local state resolved
 * through the Conversation image cache, whose entries live as long as the
 * Session binding — the panel never revokes.
 */
function Frame({ activity, loadImage, t }: {
  activity: ComputerActivity
  loadImage: ComputerInjected['loadImage']
  t: PropsLocale<'sidebarComputer'>['t']
}): ReactNode {
  const attachment = activity.latestImage
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (attachment === undefined) {
      setUrl(undefined)
      return
    }
    let live = true
    loadImage(attachment)
      .then((resolved) => { if (live) setUrl(resolved) })
      .catch(() => {
        // A failed load keeps the previous frame; nothing here owns the error.
      })
    return () => { live = false }
  }, [activity, loadImage])
  if (url === undefined) return <div className={css.screenEmpty}>{t('screen.empty')}</div>
  return (
    <div className={css.screen}>
      <img className={css.screenImage} src={url} alt={t('screen.label')} />
    </div>
  )
}

/** The capped, newest-first action feed under its section label. */
function Feed({ activity, t }: { activity: ComputerActivity; t: PropsLocale<'sidebarComputer'>['t'] }): ReactNode {
  return (
    <div className={css.feedArea}>
      <div className={css.feedTitle}>{t('feed.title')}</div>
      {activity.items.length === 0
        ? <div className={css.empty}>{t('feed.empty')}</div>
        : (
          <ol className={css.feed}>
            {activity.items.map(item => <ActionRow key={item.callId} item={item} t={t} />)}
          </ol>
        )}
      {activity.hiddenCount > 0 && (
        <div className={css.more}>{t('feed.more', { count: String(activity.hiddenCount) })}</div>
      )}
    </div>
  )
}

/** One feed row: the state dot, the action line, and the settled duration. */
function ActionRow({ item, t }: { item: ComputerAction; t: PropsLocale<'sidebarComputer'>['t'] }): ReactNode {
  return (
    <li className={css.row} title={item.tool}>
      <span
        className={clsx(
          css.rowDot,
          item.state === 'ok' && css.rowOk,
          item.state === 'error' && css.rowError,
        )}
        aria-label={stateLabel(item.state, t)}
      />
      <span className={css.rowLabel}>{item.label}</span>
      {item.durationMs !== null && (
        <span className={css.rowDuration}>{t('duration.s', { s: (item.durationMs / 1000).toFixed(1) })}</span>
      )}
    </li>
  )
}

/** The row's spoken state for the state dot. */
function stateLabel(state: ComputerAction['state'], t: PropsLocale<'sidebarComputer'>['t']): string {
  return state === 'running' ? t('state.running') : state === 'error' ? t('state.error') : t('state.ok')
}
