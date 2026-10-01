/**
 * The session header's agent-preset control.
 *
 * The host commits a switch while no turn is open — a blank session, or an
 * idle one between turns — so the header carries a real menu: the options are
 * the healthy roster, the current selection reads from the session's own
 * preset projection, and a refusal (a turn opened before the answer landed)
 * surfaces as a toast. When selection is switched off deployment-side, the
 * roster is empty, or the session is mid-turn, the control degrades to the
 * plain label. The before-the-fact choice for a session about to start lives
 * on the new-session screen ({@link AgentPresetSeat}).
 */

import { useEffect, useRef, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutlineRegular, IconChevronDownOutlineRegular, IconWarningOutlineRegular, Menu, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetLabel.module.css'

/** Duration of a selection-refusal banner, including a turn opening mid-pick. */
const REFUSAL_HOLD_MS = 8000

/** Registration-side business face for the header control. */
export interface AgentPresetLabelInjected {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
  }
  /** Read the roster, so the control can show a name rather than an id. */
  load: () => Promise<void>
  /** Switch this session's composition; resolves to the refusal text, or undefined. */
  select: (sessionId: SessionId, id: string) => Promise<string | undefined>
}

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/**
 * Render this session's agent-preset control beside its title.
 * @param props - composed slot props.
 * @returns the control, or null when the session records no preset.
 */
export function AgentPresetLabel({
  sessionId, useSessions, useAgentPresets, load, select, t,
}: AgentPresetLabelProps) {
  const preset = useSessions((state) => {
    const value = state.byId[sessionId]?.projectionValues?.agentPreset
    return typeof value === 'string' ? value : undefined
  })
  const running = useSessions(state => state.byId[sessionId]?.running === true)
  const roster = useAgentPresets(state => state)

  useEffect(() => {
    // Deployments that compose no presets never label anything, so the roster
    // is only worth a request once a session reports one.
    if (preset !== undefined) void load()
  }, [preset, load])

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  // The seq keys the banner, so a second refusal replays it rather than
  // leaving the first one silently in place.
  const toastSeq = useRef(0)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)

  if (preset === undefined) return null

  const option = roster.options.find(entry => entry.id === preset)
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  const hint = running ? t('headerBusyHint') : text?.description ?? t('headerHint')
  const interactive = roster.modeSelectionEnabled && roster.options.length > 0 && !running && !busy

  if (!interactive) {
    return (
      <span className={css.label} title={hint}>
        <IconAgentPresetOutlineRegular size={14} className={css.icon} />
        {text?.name ?? preset}
      </span>
    )
  }

  return (
    <>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={roster.options.map((entry) => {
          const entryText = presetDisplayText(entry, t)
          return {
            id: entry.id,
            // Name and description together: the id alone never says what a
            // preset does, which is why the roster carries display copy.
            label: (
              <span className={css.item}>
                <span className={css.itemName}>{entryText.name}</span>
                <span className={css.itemDesc}>{entryText.description ?? t('noDescription')}</span>
              </span>
            ),
          }
        })}
        selectedId={preset}
        onSelect={(id) => {
          setOpen(false)
          const picked = roster.options.find(entry => entry.id === id)
          // The fallback is for the row shape `find` cannot promise; the menu's
          // items ARE `roster.options`, so an emitted id is always one of them.
          /* v8 ignore next */
          const name = picked === undefined ? id : presetDisplayText(picked, t).name
          setBusy(true)
          void select(sessionId, id).then((refusal) => {
            if (refusal !== undefined) {
              toastSeq.current += 1
              setToast({ seq: toastSeq.current, text: t('switchRefused', { name, reason: refusal }) })
            }
          }).finally(() => { setBusy(false) })
        }}
        align="start"
        portal
        className={css.menuAnchor}
        anchor={(
          <button
            type="button"
            className={css.label}
            aria-haspopup="menu"
            aria-expanded={open}
            title={text?.description ?? t('headerHint')}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconAgentPresetOutlineRegular size={14} className={css.icon} />
            {text?.name ?? preset}
            <IconChevronDownOutlineRegular size={12} className={css.chevron} />
          </button>
        )}
      />
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutlineRegular />}
          holdMs={REFUSAL_HOLD_MS}
          // The composer card, which is the content column this header sits
          // above rather than inside — hence a page query, not `closest`.
          // Absent, the banner centers on the window, which is off-center
          // whenever the sidebar is open.
          anchor={document.querySelector<HTMLElement>('[data-composer-card]')}
          onDone={() => { setToast(null) }}
        />
      )}
    </>
  )
}
