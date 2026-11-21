/**
 * The IDE file port's directory watch: the supervised `workspaceFiles.changes`
 * stream bound to the IDE's own vocabulary of `ready` and `change`.
 *
 * The watch is one consumer over the Remote's stream supervisor: the Host
 * subscription opens once per watch, `ready` is accepted so the supervisor
 * keeps the generation, changes flow through untouched, and ending the watch
 * — by signal or by return — disposes the supervised stream.
 */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SupervisedStreamOptions } from '@deepseek-ai/dsh-api-workspace-files/src/client/remote.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { FakeRemote } from '../../../api/workspace-files/tests/fake-remote.client.ts'
import { createFilesPort, type IdeFilesRemote } from '../src/client/ide-files.ts'

const SESSION = 'ide-watch-session' as SessionId
const ROOT = '/work/app'

/**
 * Mount one port watch over the scripted Remote.
 * @returns the remote, the watch's lifetime and its iterator.
 */
function mount() {
  const remote = new FakeRemote()
  remote.autoReady = false
  const controller = new AbortController()
  const port = createFilesPort(remote as unknown as IdeFilesRemote)
  const watch = port.watch
  if (watch === undefined) throw new Error('the port must observe directories')
  const iterator = watch(SESSION, ROOT, controller.signal)[Symbol.asyncIterator]()
  const supervise = vi.spyOn(remote, '$stream')
  onTestFinished(async () => {
    controller.abort()
    const returned = iterator.return?.()
    await remote.dispose()
    await returned
  })
  return { remote, controller, iterator, supervise }
}

describe('the IDE file port watch', () => {
  it('opens the requested directory, accepts ready, and forwards changes without accepting them', async () => {
    const h = mount()
    const first = h.iterator.next()
    const watch = await h.remote.waitForChanges(0)
    expect(watch).toMatchObject({ sessionId: SESSION, path: ROOT })
    expect(h.supervise.mock.calls[0]?.[0].name).toBe(`directory ${ROOT}`)
    watch.source.push({ kind: 'ready' })
    await expect(first).resolves.toEqual({ done: false, value: { kind: 'ready' } })
    expect(h.remote.calls).toEqual(['changes', 'accept'])
    const next = h.iterator.next()
    watch.source.push({ kind: 'change', change: { absolutePath: ROOT, version: 'changed' } })
    // The Host's own spelling of the observed target travels with the notice,
    // so the workspace can tell which files the observation concerns.
    await expect(next).resolves.toEqual({ done: false, value: { kind: 'change', absolutePath: ROOT } })
    expect(h.remote.calls).toEqual(['changes', 'accept'])
    await h.iterator.return?.()
    expect(watch.source.aborted).toBe(true)
  })

  it('does not create a stream for an already-cancelled watch', async () => {
    const h = mount()
    h.controller.abort()
    await expect(h.iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(h.supervise).not.toHaveBeenCalled()
    expect(h.remote.opened).toEqual([])
  })

  it('classifies a normal stream end and disposes it', async () => {
    const h = mount()
    const first = h.iterator.next()
    const watch = await h.remote.waitForChanges(0)
    const options = h.supervise.mock.calls[0]![0]
    const ended = vi.spyOn(options, 'ended')
    watch.source.push({ kind: 'ready' })
    await expect(first).resolves.toEqual({ done: false, value: { kind: 'ready' } })
    const rejected = expect(h.iterator.next()).rejects.toThrow(`Directory watch ended: ${ROOT}`)
    watch.source.end()
    await rejected
    expect(ended).toHaveBeenCalledExactlyOnceWith(true)
    expect(h.remote.disposed).toEqual([`directory ${ROOT}`])
  })

  it('does not yield a frame delivered after the watch cancels', async () => {
    const h = mount()
    const supervise = FakeRemote.prototype.$stream.bind(h.remote)
    const pulled = Promise.withResolvers<undefined>()
    const deliver = Promise.withResolvers<undefined>()
    h.supervise.mockImplementation(function<Item>(options: SupervisedStreamOptions<Item>) {
      const stream = supervise(options)
      return {
        dispose: () => stream.dispose(),
        async *[Symbol.asyncIterator]() {
          for await (const item of stream) {
            pulled.resolve(undefined)
            await deliver.promise
            yield item
          }
        },
      }
    })
    const pending = h.iterator.next()
    try {
      const watch = await h.remote.waitForChanges(0)
      watch.source.push({ kind: 'ready' })
      await pulled.promise
      h.controller.abort()
      await h.remote.waitForDispose(0)
      deliver.resolve(undefined)
      await expect(pending).resolves.toEqual({ done: true, value: undefined })
      expect(h.remote.calls).toEqual(['changes'])
      expect(watch.source.aborted).toBe(true)
    } finally {
      deliver.resolve(undefined)
    }
  })
})
