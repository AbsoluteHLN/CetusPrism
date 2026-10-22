/**
 * The execution-backend chip in the composer tool row, beside the agent-preset
 * chip.
 *
 * The preset says what the Agent does; the backend says what runs it. The two
 * are separate choices, so they are separate controls: this one lists the
 * execution backends the deployment offers, their installed version and
 * whether they can start a session at all.
 *
 * A backend that cannot start a session stays visible. The reason it cannot
 * is what this chip is for, so the menu never hides an option the user would
 * otherwise look for.
 */

import { useEffect, useRef, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconBranchOutlineRegular, IconChevronDownOutlineRegular, IconWarningOutlineRegular, Menu, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the composer seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentBackendOption, AgentBackendSeatState } from './backend-store.ts'
import css from './AgentBackendSeat.module.css'

/** Registration-side business face for the backend chip. */
export interface AgentBackendSeatInjected {
  hooks: {
    /** Seat snapshot bound by the renderer as useAgentBackendSeat. */
    agentBackendSeat: SnapshotStore<AgentBackendSeatState>
  }
  /** Read the catalog when the chip first renders. */
  load: () => Promise<void>
  /** Pick the backend for the next session; resolves to a refusal, or undefined. */
  select: (id: string) => Promise<string | undefined>
  /** Acknowledge the refusal whose Toast finished. */
  dismissRefusal: () => void
}

/** Duration of a selection-refusal banner. */
const REFUSAL_HOLD_MS = 8000

/** Full component props. */
export type AgentBackendSeatProps =
  PropsRuntime<'conversation.input.agentBackend'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentBackendSeatInjected>

/** The locale keys the backend status line reads. */
type BackendStatusKey = 'backendVersion' | 'backendUnconfigured' | 'backendIncompatible'

/**
 * The status line a backend row carries: its version when it is installed,
 * and the reason it cannot start a session when it cannot.
 * @param backend - the backend the row renders.
 * @param t - the locale binding of the chip.
 * @returns the one line the row shows under its name.
 */
function backendStatusText(
  backend: AgentBackendOption,
  t: (key: BackendStatusKey, params?: Record<string, string | number>) => string,
): string {
  if (backend.availability === 'ready') return `${t('backendVersion')}: ${backend.version}`
  if (backend.availability === 'incompatible') return t('backendIncompatible')
  return backend.reason ?? t('backendUnconfigured')
}

/**
 * Render the composer execution-backend chip.
 * @param props - composed slot props.
 * @returns The chip and any pending selection refusal, or null when the host
 * offers no backend at all.
 */
export function AgentBackendSeat({
  load, select, dismissRefusal, useAgentBackendSeat, t,
}: AgentBackendSeatProps) {
  const state = useAgentBackendSeat(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  // The seq keys the banner, so picking the same broken backend twice
  // replays it rather than leaving the first one silently in place.
  const toastSeq = useRef(0)
  const [toast, setToast] = useState<{ seq: number; reason: string } | null>(null)

  useEffect(() => {
    if (state.refusal !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, reason: state.refusal })
    } else setToast(null)
  }, [state.refusal])

  useEffect(() => {
    void load()
  }, [load])

  // A deployment that publishes no backend offers nothing to choose; DSH is
  // always there, so this only happens when the service is absent entirely.
  if (state.status === 'idle' || state.status === 'loading' || state.options.length === 0) return null

  const current = state.options.find(option => option.id === state.current) ?? state.options[0]
  const label = current?.name ?? state.current

  return (
    <>
      <Menu
        open={open && state.options.length > 0}
        onClose={() => { setOpen(false) }}
        items={state.options.map((option) => ({
          id: option.id,
          label: (
            <span className={css.item}>
              <span className={css.itemName}>{option.name}</span>
              <span className={css.itemDesc}>{backendStatusText(option, t)}</span>
            </span>
          ),
        }))}
        selectedId={state.current}
        onSelect={(id) => {
          setOpen(false)
          void select(id)
        }}
        align="start"
        portal
        className={css.menuAnchor}
        anchor={(
          <button
            type="button"
            className={css.seat}
            aria-haspopup="menu"
            aria-expanded={open && state.options.length > 0}
            title={t('backendSeatHint')}
            disabled={state.options.length === 0}
            onClick={() => { setOpen(value => !value) }}
          >
            <IconBranchOutlineRegular className={css.seatIcon} />
            <span className={css.seatLabel}>{label}</span>
            <IconChevronDownOutlineRegular className={css.chevron} />
          </button>
        )}
      />
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={t('backendSwitchRefused', { reason: toast.reason })}
          icon={<IconWarningOutlineRegular />}
          holdMs={REFUSAL_HOLD_MS}
          // The composer card, which now holds this chip, so the banner
          // anchors to the card rather than to the chip's own row.
          anchor={document.querySelector<HTMLElement>('[data-composer-card]')}
          onDone={() => { dismissRefusal() }}
        />
      )}
    </>
  )
}
