// @vitest-environment jsdom
/**
 * The pure derivation: which chat nodes are computer-use actions, what each
 * row says, and what the newest frame is. Fixtures are honest node values in
 * the shapes the Chat target publishes; malformed wire data degrades the
 * detail and never throws.
 */
import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { ChatConversationViewNode, ToolCallBlock } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { zh } from '../src/client/locales.ts'
import { CUA_TOOL_PREFIX, MAX_ACTIONS, actionLabel, deriveComputerActivity } from '../src/client/model.ts'

/** The dictionary itself, with the same {param} interpolation the seat binds. */
const t = makeTranslate(zh) as TranslateNS<'sidebarComputer'>

function imageRef(id: string): ImageAttachmentRef {
  return { attachmentId: AttachmentId(id), mediaType: 'image/png', bytes: 16, width: 8, height: 8 }
}

/** One chat node whose payload is the given root tool lifecycle. */
function toolNode(anchorSeq: number, root: ToolCallBlock): ChatConversationViewNode {
  return {
    key: `n${anchorSeq}`,
    id: `n${anchorSeq}`,
    kind: 'tool-call',
    target: 'chat',
    data: { root },
    anchorSeq,
    location: { kind: 'session' },
    visibility: 'visible',
  }
}

/** A dispatched but unsettled computer-use call. */
function runningCall(name: string, argsRaw: string, anchorSeq: number): ChatConversationViewNode {
  return toolNode(anchorSeq, { callId: `c${anchorSeq}`, name, turn: 3, step: 1, time: anchorSeq * 10, subCalls: [], phase: 'start', args: PartialArguments.fromText(argsRaw), argsRaw })
}

/** A settled computer-use result, attributable through its backfilled call head. */
function settledCall(name: string, argsRaw: string, anchorSeq: number, options?: {
  readonly isError?: boolean
  readonly images?: readonly ImageAttachmentRef[]
  readonly callTime?: number | null
}): ChatConversationViewNode {
  const content: ContentBlock[] = [
    { type: 'text', text: 'ok' },
    ...(options?.images ?? []).map(attachment => ({ type: 'image' as const, attachment })),
  ]
  return toolNode(anchorSeq, {
    kind: 'tool-result',
    seq: anchorSeq,
    time: anchorSeq * 10 + 150,
    callId: `c${anchorSeq}`,
    name,
    args: PartialArguments.fromText(argsRaw),
    call: { name, argsRaw },
    callTime: options?.callTime ?? anchorSeq * 10,
    content,
    isError: options?.isError ?? false,
    subCalls: [],
  })
}

describe('actionLabel', () => {
  it('names a click by its element handle, coordinates, or process', () => {
    expect(actionLabel('cua_driver_native__click', { element_index: 4 }, t))
      .toBe(t('verb.click', { detail: t('detail.element', { index: '4' }) }))
    expect(actionLabel('cua_driver_native__click', { x: 1, y: 2 }, t))
      .toBe(t('verb.click', { detail: t('detail.coords', { x: '1', y: '2' }) }))
    expect(actionLabel('cua_driver_native__click', { pid: 42 }, t))
      .toBe(t('verb.click', { detail: t('detail.pid', { pid: '42' }) }))
  })

  it('distinguishes double and right clicks', () => {
    expect(actionLabel('cua_driver_native__click', { button: 'right', x: 1, y: 2 }, t))
      .toBe(t('verb.rightClick', { detail: t('detail.coords', { x: '1', y: '2' }) }))
    expect(actionLabel('cua_driver_native__click', { count: 2, pid: 7 }, t))
      .toBe(t('verb.doubleClick', { detail: t('detail.pid', { pid: '7' }) }))
    expect(actionLabel('cua_driver_native__double_click', { element_index: 3 }, t))
      .toBe(t('verb.doubleClick', { detail: t('detail.element', { index: '3' }) }))
  })

  it('renders text input, key chords, and unknown tools', () => {
    expect(actionLabel('cua_driver_native__type_text', { text: '你好世界' }, t)).toBe(t('verb.type', { text: '你好世界' }))
    expect(actionLabel('cua_driver_native__press_key', { key: 'return', modifiers: ['ctrl'] }, t)).toBe(t('verb.pressKey', { keys: 'ctrl+return' }))
    expect(actionLabel('cua_driver_native__hotkey', { keys: ['ctrl', 'shift', 't'] }, t)).toBe(t('verb.hotkey', { keys: 'ctrl+shift+t' }))
    expect(actionLabel('cua_driver_native__install_ffmpeg', {}, t)).toBe(t('verb.unknown', { name: 'install_ffmpeg' }))
  })

  it('truncates long values through the truncation copy', () => {
    expect(actionLabel('cua_driver_native__type_text', { text: 'a'.repeat(60) }, t))
      .toBe(t('verb.type', { text: t('text.truncated', { text: 'a'.repeat(40) }) }))
  })

  it('describes scroll direction and amount, degrading when either is absent', () => {
    expect(actionLabel('cua_driver_native__scroll', { direction: 'down', amount: 3 }, t))
      .toBe(t('verb.scroll', { detail: `${t('direction.down')} ${t('detail.amount', { amount: '3' })}` }))
    expect(actionLabel('cua_driver_native__scroll', { by: 'page' }, t)).toBe(t('verb.scroll', { detail: t('detail.page') }))
  })

  it('prefixes the provider family and strips it for unknown tools', () => {
    expect(CUA_TOOL_PREFIX).toBe('cua_driver_native__')
    expect(actionLabel('install_ffmpeg', {}, t)).toBe(t('verb.unknown', { name: 'install_ffmpeg' }))
  })
})

describe('deriveComputerActivity', () => {
  it('keeps only computer-use calls, newest first, and reads settled states', () => {
    const feed = deriveComputerActivity([
      toolNode(2, { callId: 'bash-1', name: 'bash', turn: 1, step: 1, time: 1, subCalls: [], phase: 'start', args: PartialArguments.fromText('{}'), argsRaw: '{}' }),
      settledCall('cua_driver_native__click', '{"x":1,"y":2}', 20),
      runningCall('cua_driver_native__type_text', '{"text":"hi"}', 30),
    ], t)
    expect(feed.items.map(row => row.seq)).toEqual([30, 20])
    expect(feed.running).toBe(true)
    expect(feed.items[0]?.state).toBe('running')
    expect(feed.items[1]?.state).toBe('ok')
  })

  it('carries images and durations from settled results and flags a run in flight', () => {
    const frame = imageRef('frame-1')
    const feed = deriveComputerActivity([
      settledCall('cua_driver_native__get_desktop_state', '{}', 20, { images: [frame] }),
      runningCall('cua_driver_native__click', '{"element_index":1}', 30),
    ], t)
    expect(feed.running).toBe(true)
    expect(feed.latestImage).toBe(frame)
    expect(feed.items[0]?.state).toBe('running')
    expect(feed.items[1]?.durationMs).toBe(150)
  })

  it('skips settled calls whose head left the loaded window and counts the cap', () => {
    const unattributed = toolNode(40, {
      kind: 'tool-result',
      seq: 40,
      time: 100,
      callId: 'lost',
      name: '',
      args: PartialArguments.fromText('{}'),
      call: null,
      callTime: null,
      content: [{ type: 'image', attachment: imageRef('frame-2') }],
      isError: false,
      subCalls: [],
    })
    const many = Array.from({ length: MAX_ACTIONS + 5 }, (_, index) =>
      settledCall('cua_driver_native__list_apps', '{}', index + 100))
    const feed = deriveComputerActivity([unattributed, ...many], t)
    expect(feed.items).toHaveLength(MAX_ACTIONS)
    expect(feed.hiddenCount).toBe(5)
  })

  it('marks settled errors, including one whose head is present', () => {
    const failed = toolNode(50, {
      kind: 'tool-result',
      seq: 50,
      time: 100,
      callId: 'f',
      name: 'cua_driver_native__click',
      args: PartialArguments.fromText('{}'),
      call: { name: 'cua_driver_native__click', argsRaw: '{}' },
      callTime: 90,
      content: [],
      isError: true,
      subCalls: [],
    })
    const feed = deriveComputerActivity([failed], t)
    expect(feed.items[0]?.state).toBe('error')
    expect(feed.items[0]?.label).toBe(t('verb.click', { detail: '' }))
  })

  it('parses malformed arguments into a bare row instead of throwing', () => {
    const feed = deriveComputerActivity([runningCall('cua_driver_native__hotkey', '{broken', 30)], t)
    expect(feed.items[0]?.label).toBe(t('verb.hotkey', { keys: '' }))
  })
})
