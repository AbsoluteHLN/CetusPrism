// @vitest-environment jsdom
/**
 * The completion-chime dock: renders nothing, and plays its chime exactly on
 * the session's running→idle edge (never on mount, never while running).
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChimeDockProps } from '../src/client/skeleton/ChimeDock.tsx'
import { ChimeDock, chimeDockEntry } from '../src/client/skeleton/ChimeDock.tsx'

afterEach(cleanup)

const SNAPSHOT: SessionSnapshot = {
  sessionId: 's' as SessionSnapshot['sessionId'],
  pendingSubmissions: [],
  running: false,
  subagent: null,
  removed: false,
  openState: 'open',
  openError: null,
  hasMore: false,
  loadingOlder: false,
  promptError: null,
  blank: false,
  lastAgentError: null,
  promptAttempted: false,
  awaitingFirstTurn: false,
}

/** Dock props stub over a live snapshot store; `play` is the test seam. */
function dockProps(
  store: ReturnType<typeof createSnapshotStore<SessionSnapshot>>,
  play: () => void,
): ChimeDockProps & { play: () => void } {
  const useSession = bindSnapshotSelector(store)
  return { useSession, play }
}

it('renders nothing while mounted', () => {
  const store = createSnapshotStore<SessionSnapshot>(SNAPSHOT)
  const { container } = render(<ChimeDock {...dockProps(store, vi.fn())} />)
  expect(container.innerHTML).toBe('')
})

it('plays exactly on the running→idle edge and never on mount', () => {
  const store = createSnapshotStore<SessionSnapshot>(SNAPSHOT)
  const play = vi.fn()
  render(<ChimeDock {...dockProps(store, play)} />)
  expect(play).not.toHaveBeenCalled()
  // Mount while running: still no chime (the transition is what counts).
  act(() => { store.set({ ...SNAPSHOT, running: true }) })
  expect(play).not.toHaveBeenCalled()
  act(() => { store.set({ ...SNAPSHOT, running: false }) })
  expect(play).toHaveBeenCalledOnce()
})

it('does not chime again while the session stays idle', () => {
  const store = createSnapshotStore<SessionSnapshot>(SNAPSHOT)
  const play = vi.fn()
  render(<ChimeDock {...dockProps(store, play)} />)
  act(() => { store.set({ ...SNAPSHOT, running: true }) })
  act(() => { store.set({ ...SNAPSHOT, running: false }) })
  expect(play).toHaveBeenCalledOnce()
  act(() => { store.set({ ...SNAPSHOT, running: false }) })
  expect(play).toHaveBeenCalledOnce()
})

it('chimes again after a second run completes', () => {
  const store = createSnapshotStore<SessionSnapshot>(SNAPSHOT)
  const play = vi.fn()
  render(<ChimeDock {...dockProps(store, play)} />)
  act(() => { store.set({ ...SNAPSHOT, running: true }) })
  act(() => { store.set({ ...SNAPSHOT, running: false }) })
  act(() => { store.set({ ...SNAPSHOT, running: true }) })
  act(() => { store.set({ ...SNAPSHOT, running: false }) })
  expect(play).toHaveBeenCalledTimes(2)
})

it('registers as a session-scoped dock entry with its own id', () => {
  expect(chimeDockEntry.name).toBe('conversation-chime-dock')
  expect(chimeDockEntry.inject).toEqual(['slots'])
  const register = vi.fn(() => () => undefined)
  const inject = vi.fn((_name: string, callback: () => () => void) => callback())
  chimeDockEntry.apply({ slots: { inject, register } } as never)
  expect(inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
  expect(register).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'conversation.input.dock', id: 'chime', order: 1 }),
    ChimeDock,
  )
})
