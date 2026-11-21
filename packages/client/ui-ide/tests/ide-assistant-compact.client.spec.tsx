// @vitest-environment jsdom

/**
 * The IDE's assistant column asks for the REDUCED composer.
 *
 * The column shows a conversation BESIDE the code, not the product's own
 * conversation panel. The full composer is the product's control surface:
 * the access mode, the computer-use delivery switch, the agent preset and
 * backend, the plan mode, the model selector and the metric row. A second
 * copy of all of that, squeezed into a side column, is noise — and the
 * computer-use switch in particular has no business beside a code view.
 *
 * The reduced form is OPT-IN and owned by the host: the shared composer keeps
 * every control it has for the main panel, and the IDE asks for the smaller
 * one. The embedding itself is not a second semantics — `variant:
 * 'embedded'` is also the Sidebar's subagent chat, which must not change —
 * so the reduction rides on its own flag.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { IdeConversation, type IdeConversationProps } from '../src/client/IdeAssistant.tsx'

const SID = 'session-one' as SessionId

/**
 * Render the IDE's conversation occurrence over stubbed Session sources.
 * @returns the factory calls the occurrence made.
 */
function renderOccurrence(): { name: string; props: Record<string, unknown> }[] {
  const calls: { name: string; props: Record<string, unknown> }[] = []
  const props = {
    sessionId: SID,
    useSession: ((selector: (value: unknown) => unknown) => selector({
      blank: false,
      awaitingFirstTurn: false,
      running: false,
      openState: 'open',
    })) as never,
    useConversation: ((selector: (value: unknown) => unknown) => selector({
      activeTargets: new Set<string>(),
    })) as never,
    useSessions: ((selector: (value: unknown) => unknown) => selector({
      byId: { [SID]: { blank: false } },
    })) as never,
    renderFactorySlot: ((name: string, factoryProps: Record<string, unknown>) => {
      calls.push({ name, props: factoryProps })
      return null
    }) as never,
  } as unknown as IdeConversationProps
  render(<IdeConversation {...props} />)
  return calls
}

describe('the IDE assistant column', () => {
  it('asks the shared conversation for its reduced composer', () => {
    const calls = renderOccurrence()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe('conversation.content')
    expect(calls[0]?.props.variant).toBe('embedded')
    // The flag is what withholds the chips, the model seat and the metric row.
    expect(calls[0]?.props.compact).toBe(true)
  })

  it('keeps the occurrence a plain embedded one otherwise', () => {
    const calls = renderOccurrence()

    // `embedded` is the Sidebar's subagent chat too: the reduction must not
    // become a second meaning of the variant.
    expect(calls[0]?.props.variant).toBe('embedded')
    expect(calls[0]?.props.phase).toBe('active')
  })
})
