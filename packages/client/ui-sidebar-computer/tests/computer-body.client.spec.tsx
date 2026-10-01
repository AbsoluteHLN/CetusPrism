// @vitest-environment jsdom
/**
 * The panel's presentation: the status line, the stop gesture, the newest
 * frame resolved through the injected loader, and the capped feed. The hooks
 * are stubs over fixed snapshots, because the seat's standard kit is
 * framework-injected; what the spec exercises is what the body draws from
 * them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { createElement } from 'react'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment/types'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { ComputerInjected } from '../src/client/view/ComputerBody.tsx'
import { ComputerBody } from '../src/client/view/ComputerBody.tsx'
import type { ComputerBodyProps } from '../src/client/view/ComputerBody.tsx'
import { zh } from '../src/client/locales.ts'
import { CUA_TOOL_PREFIX } from '../src/client/model.ts'

const t = makeTranslate(zh) as TranslateNS<'sidebarComputer'>

afterEach(cleanup)

function imageRef(id: string): ImageAttachmentRef {
  return { attachmentId: AttachmentId(id), mediaType: 'image/png', bytes: 16, width: 8, height: 8 }
}

/** A settled computer call, attributable through its backfilled call head. */
function settledNode(anchorSeq: number, tool: string, options?: {
  readonly isError?: boolean
  readonly images?: readonly ImageAttachmentRef[]
}): ChatConversationViewNode {
  return {
    key: `n${anchorSeq}`,
    id: `n${anchorSeq}`,
    kind: 'tool-call',
    target: 'chat',
    data: {
      root: {
        kind: 'tool-result',
        seq: anchorSeq,
        time: anchorSeq * 100 + 200,
        callId: `c${anchorSeq}`,
        call: { name: `${CUA_TOOL_PREFIX}${tool}`, argsRaw: '{"x":1,"y":2}' },
        callTime: anchorSeq * 100,
        content: (options?.images ?? []).map(attachment => ({ type: 'image' as const, attachment })),
        isError: options?.isError ?? false,
        subCalls: [],
      },
    },
    anchorSeq,
    location: { kind: 'session' },
    visibility: 'visible',
  }
}

/** A dispatched but unsettled computer call. */
function runningNode(anchorSeq: number, tool: string): ChatConversationViewNode {
  return {
    key: `r${anchorSeq}`,
    id: `r${anchorSeq}`,
    kind: 'tool-call',
    target: 'chat',
    data: {
      root: { callId: `c${anchorSeq}`, name: `${CUA_TOOL_PREFIX}${tool}`, turn: 3, step: 1, time: 1, subCalls: [], phase: 'start', argsRaw: '{"x":1}' },
    },
    anchorSeq,
    location: { kind: 'session' },
    visibility: 'visible',
  }
}

interface HarnessOptions {
  readonly nodes?: readonly ChatConversationViewNode[]
  /** The Session's running flag, which gates the stop gesture. */
  readonly running?: boolean
  readonly loadImage?: (attachment: ImageAttachmentRef) => Promise<string>
}

/** Mount one body over a fixed Chat snapshot and a recording face. */
function mountBody(options?: HarnessOptions) {
  const stop = vi.fn()
  const loadImage = options?.loadImage ?? vi.fn(async () => 'blob:frame')
  // The body reads only chat.nodes.values() off the snapshot; the cast keeps
  // the stub to the read surface, exactly as the seat narrows the rest.
  const snapshot = { nodes: { values: () => options?.nodes ?? [] } } as unknown as ChatSnapshot
  const props = {
    sessionId: 's-test',
    useChat: (select: (snap: ChatSnapshot) => unknown) => select(snapshot),
    useSession: (select: (snap: { running: boolean }) => unknown) => select({ running: options?.running ?? false }),
    t,
    stop,
    loadImage,
  } as unknown as ComputerBodyProps
  const view = render(createElement(ComputerBody, props))
  return { view, stop, loadImage }
}

describe('ComputerBody', () => {
  it('shows the idle status, an empty screen, and an empty feed before any action', () => {
    const { view } = mountBody()
    expect(view.container.textContent).toContain(zh['status.idle'])
    expect(view.container.textContent).toContain(zh['screen.empty'])
    expect(view.container.textContent).toContain(zh['feed.empty'])
  })

  it('feeds computer actions newest first with their durations, and resolves the newest frame', async () => {
    const { view } = mountBody({
      nodes: [
        settledNode(20, 'click', { images: [imageRef('frame-1')] }),
        settledNode(30, 'list_apps'),
      ],
    })
    const rows = [...view.container.querySelectorAll('ol li')]
    expect(rows.map(row => row.textContent)).toEqual([
      `${zh['verb.listApps']}0.2 s`,
      `${t('verb.click', { detail: t('detail.coords', { x: '1', y: '2' }) })}0.2 s`,
    ])
    await vi.waitFor(() => {
      expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:frame')
    })
    expect(view.container.textContent).not.toContain(zh['feed.empty'])
  })

  it('speaks the running state while an action is in flight and arms stop for a running session', () => {
    const { view, stop } = mountBody({ nodes: [settledNode(20, 'list_apps'), runningNode(30, 'click')], running: true })
    expect(view.container.textContent).toContain(zh['status.running'])
    const stopButton = view.getByRole('button', { name: zh['stop.label'] })
    expect(stopButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(stopButton)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('disables stop while the session itself is settled', () => {
    const { view } = mountBody()
    expect(view.getByRole('button', { name: zh['stop.label'] }).hasAttribute('disabled')).toBe(true)
  })

  it('stays on the empty placeholder when a frame load fails', async () => {
    const loadImage = vi.fn<ComputerInjected['loadImage']>(async () => {
      throw new Error('gone')
    })
    const { view } = mountBody({
      nodes: [settledNode(20, 'get_desktop_state', { images: [imageRef('f1')] })],
      loadImage,
    })
    await vi.waitFor(() => { expect(loadImage).toHaveBeenCalled() })
    expect(view.container.querySelector('img')).toBeNull()
    expect(view.container.textContent).toContain(zh['screen.empty'])
  })
})
