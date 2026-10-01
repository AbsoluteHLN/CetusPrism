/**
 * Suppression: a toast leaves only for a user-started session's completed or
 * failed turn end while the document is unfocused, and only through the
 * desktop bridge's notify member — everything else stays silent.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, turnEndedToast } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

/** The zh dictionary itself stands in for a runtime lookup. */
const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replaceAll('{title}', typeof params?.title === 'string' ? params.title : '')) as never

const NOTIFY = (title: string, body: string): { title: string; body: string } => ({ title, body })

function toastInput(overrides: Partial<Parameters<typeof turnEndedToast>[0]> = {}): Parameters<typeof turnEndedToast>[0] {
  return {
    kind: 'completed',
    sessionId: 's1',
    summary: { displayTitle: '重构登录' },
    hasFocus: false,
    toast: () => {},
    t,
    ...overrides,
  }
}

describe('turnEndedToast', () => {
  it.each([
    { label: 'a focused document', overrides: { hasFocus: true } },
    { label: 'an unknown session row', overrides: { summary: undefined } },
    { label: 'a subagent session', overrides: { summary: { displayTitle: 'worker', origin: 'subagent' as const } } },
    { label: 'a browser without the desktop bridge', overrides: { toast: undefined } },
    { label: 'a user-aborted turn', overrides: { kind: 'aborted' } },
    { label: 'an interrupted turn', overrides: { kind: 'interrupted' } },
    { label: 'a blocked turn', overrides: { kind: 'blocked' } },
    { label: 'a max-tokens turn end', overrides: { kind: 'max-tokens' } },
    { label: 'a forked turn', overrides: { kind: 'forked' } },
  ])('stays silent for $label', ({ overrides }) => {
    expect(turnEndedToast(toastInput(overrides))).toBeUndefined()
  })

  it('labels a completed turn with the completion copy', () => {
    expect(turnEndedToast(toastInput({ kind: 'completed' }))).toEqual(
      NOTIFY('任务完成', '「重构登录」的任务已完成'),
    )
  })

  it('labels a failed turn with the failure copy', () => {
    expect(turnEndedToast(toastInput({ kind: 'error' }))).toEqual(
      NOTIFY('任务失败', '「重构登录」的任务未能完成'),
    )
  })
})

describe('ui-desktop-notify apply', () => {
  const notifications: { title: string; body: string }[] = []

  /** The lane has no DOM; stage a minimal document the decision reads. */
  const stubDocument = (hasFocus: boolean): void => {
    ;(globalThis as { document?: { hasFocus: () => boolean } }).document = { hasFocus: () => hasFocus }
  }

  async function bench() {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    const remote = new TestRemote(ctx, {})
    ctx.provide('sessions', {
      list: { getSnapshot: () => ({ byId: { 'task-1': { displayTitle: '重构登录' } } }) },
    } as never)
    ;(globalThis as { dshDesktop?: unknown }).dshDesktop
      = { notify: (toast: { title: string; body: string }) => { notifications.push(toast) } }
    await ctx.plugin({ inject: [...inject], apply }).await()
    return { ctx, remote }
  }

  afterEach(() => {
    delete (globalThis as { dshDesktop?: unknown }).dshDesktop
    delete (globalThis as { document?: unknown }).document
    notifications.length = 0
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares the services it uses', () => {
    expect(inject).toEqual(['locale', 'remote', 'sessions'])
  })

  it('registers the desktop.notify dictionaries', async () => {
    const { ctx } = await bench()
    expect(ctx.locale.bind('desktop.notify')('completeTitle')).toBe('任务完成')
    await ctx.fiber.dispose()
  })

  it('toasts a background task completion through the desktop bridge', async () => {
    stubDocument(false)
    const { ctx, remote } = await bench()
    try {
      remote.emit('api-session/turn-ended', ['task-1', 'completed'])
      await Promise.resolve()
      expect(notifications).toEqual([NOTIFY('任务完成', '「重构登录」的任务已完成')])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('toasts a background task failure with the failure copy', async () => {
    stubDocument(false)
    const { ctx, remote } = await bench()
    try {
      remote.emit('api-session/turn-ended', ['task-1', 'error'])
      await Promise.resolve()
      expect(notifications).toEqual([NOTIFY('任务失败', '「重构登录」的任务未能完成')])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('stays silent while the document holds focus', async () => {
    stubDocument(true)
    const { ctx, remote } = await bench()
    try {
      remote.emit('api-session/turn-ended', ['task-1', 'completed'])
      await Promise.resolve()
      expect(notifications).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('stops listening when the plugin disposes', async () => {
    stubDocument(false)
    const { ctx, remote } = await bench()
    await ctx.fiber.dispose()
    remote.emit('api-session/turn-ended', ['task-1', 'completed'])
    await Promise.resolve()
    expect(notifications).toEqual([])
  })
})
