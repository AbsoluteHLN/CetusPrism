import { useEffect } from 'react'
import type { ConversationSessionSlotProps } from '../contract/slots.ts'
import { conversationPhase } from '../contract/snapshot.ts'
import { resolveActiveView } from '../view-selection.ts'
import css from './ConversationRoot.module.css'

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function DefaultConversationViews({
  view, useSession, useConversation, useConversationViews, useInput, inputActions, useStore, actions,
  renderSlot, bindDraftMirror, openView, useInspectCall,
}: ConversationSessionSlotProps) {
  const tabs = useConversationViews(value => value)
  const inspectCall = useInspectCall(value => value)
  const selectedId = useStore(s => s.view)
  const active = resolveActiveView(tabs, selectedId)
  // Field-level subscriptions: Session/Conversation snapshots are replaced on
  // every streaming flush and store.draft mirrors every keystroke, while this
  // shell only reads the lifecycle fields below — whole-value subscriptions
  // would re-render the resident conversation.view tree per frame.
  const blank = useSession(s => s.blank)
  const awaitingFirstTurn = useSession(s => s.awaitingFirstTurn)
  const running = useSession(s => s.running)
  const promptAttempted = useSession(s => s.promptAttempted)
  const activeTargets = useConversation(s => s.activeTargets, (a, b) => a.size === b.size)
  const inputEmpty = useInput(s => s.draft === '')
  const storedDraft = useStore(s => s.draft, () => true)
  const viewRequest = useStore(s => s.viewRequest ?? null)

  useEffect(() => {
    if (inputEmpty && storedDraft !== '') inputActions.setDraft(storedDraft)
    const unmirror = bindDraftMirror(actions.setDraft)
    return () => { unmirror() }
    // Mount-only (deps pinned to inputActions): later store writes come from
    // the machine mirror, not this seed effect.
  }, [inputActions])

  if (blank && conversationPhase(
    { blank, awaitingFirstTurn, running, promptAttempted },
    { activeTargets },
  ) === 'blank') return null
  const viewId = view ?? active?.id
  return (
    <div className={css.viewArea}>
      {viewId !== undefined && renderSlot('conversation.view', {
        inspectCall,
        viewRequest,
        openView,
        completeViewRequest: actions.completeViewRequest,
      }, { only: viewId })}
    </div>
  )
}
