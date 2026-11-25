/**
 * The execution-backend settings section.
 *
 * Pi and ZCode run the agent on their own runtime, and CetusPrism finds that
 * runtime on the PATH by default. An operator who installed the runtime
 * elsewhere names the executable here — this page is the one place the
 * deployment says which runtime it means.
 *
 * Every runtime stays listed, including one that cannot start a session: the
 * reason it cannot is the thing to fix, so it is shown rather than hidden.
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Input, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentRuntimeId, AgentRuntimeOption, AgentRuntimeState } from './runtime-store.ts'
import css from './AgentRuntimeSection.module.css'

/** Settings actions and their shared controller state. */
export interface AgentRuntimeSectionInjected {
  hooks: {
    agentRuntime: SnapshotStore<AgentRuntimeState>
  }
  /** Read the catalog the host publishes. */
  load: () => Promise<void>
  /** Point one runtime at an executable. */
  save: (id: AgentRuntimeId, command: string) => Promise<string | undefined>
}

/** Props assembled by the settings renderer. */
export type AgentRuntimeSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<'settings.agentPreset'> & InjectFace<AgentRuntimeSectionInjected>

/**
 * One runtime row: its state, the executable it runs, and the way to change it.
 * @param props - the runtime, its status line, the pending write and the actions.
 * @returns The row.
 */
function RuntimeRow({
  option, status, saving, onSave, t,
}: {
  option: AgentRuntimeOption
  /** The one line under the runtime's name. */
  status: string
  saving: boolean
  onSave: (id: AgentRuntimeId, command: string) => Promise<string | undefined>
  t: AgentRuntimeSectionProps['t']
}) {
  // The draft holds what the operator typed; the host's answer fills it only
  // while the deployment names no executable of its own.
  const [draft, setDraft] = useState(option.configured ? option.command : '')
  useEffect(() => {
    setDraft(option.configured ? option.command : '')
  }, [option.configured, option.command])
  const dirty = draft.trim() !== (option.configured ? option.command : '')
  return <li className={css.card} data-agent-runtime-id={option.id}>
    <div className={css.cardHead}>
      <span className={css.cardName}>{option.name}</span>
      <Tag tone={option.availability === 'ready' ? 'solid' : 'outline'}>
        {option.availability === 'ready' ? t('backendVersion') : t('backendUnconfigured')}
      </Tag>
    </div>
    <p className={css.cardStatus}>{status}</p>
    <div className={css.field}>
      <label className={css.fieldLabel} htmlFor={`agent-runtime-${option.id}`}>{t('runtimeCommandLabel')}</label>
      <Input
        id={`agent-runtime-${option.id}`}
        className={css.input}
        value={draft}
        placeholder={option.command}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => { setDraft(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          void onSave(option.id, draft)
        }}
      />
      <p className={css.fieldHint}>{t('runtimeCommandHint', { command: option.command })}</p>
    </div>
    <div className={css.cardFoot}>
      {option.configured ? <Button variant="ghost" className={css.footButton}
        disabled={saving}
        onClick={() => { void onSave(option.id, '') }}>{t('runtimeReset')}</Button> : null}
      <Button variant="primary" className={css.footButton}
        disabled={saving || !dirty}
        onClick={() => { void onSave(option.id, draft) }}>{t('runtimeSave')}</Button>
    </div>
  </li>
}

/**
 * Render the execution-backend settings section.
 * @param props Settings actions, snapshot hooks and localized text.
 * @returns The execution-backend settings section.
 */
export function AgentRuntimeSection({ useAgentRuntime, load, save, t }: AgentRuntimeSectionProps) {
  const state = useAgentRuntime(value => value)
  useEffect(() => { void load() }, [load])
  return <section className={css.section}>
    <h2 className={css.title}>{t('runtimeNav')}</h2>
    <p className={css.intro}>{t('runtimeSectionIntro')}</p>
    {state.error === null ? null : <p className={css.error} role="alert">{state.error}</p>}
    {state.status === 'unavailable' ? <p className={css.intro}>{t('runtimeUnavailable')}</p> : null}
    <ul className={css.cards}>
      {state.options.map(option => (
        <RuntimeRow
          key={option.id}
          option={option}
          saving={state.saving === option.id}
          onSave={save}
          t={t}
          status={option.availability === 'ready'
            ? `${t('backendVersion')}: ${option.version}`
            : option.reason ?? t('backendUnconfigured')}
        />
      ))}
    </ul>
  </section>
}
