/**
 * The IDE's observed tree: the watches that keep the listed levels and the
 * clean open files honest while the Agent works in the same workspace.
 *
 * The service observes every level it has listed — the project root at bind,
 * a directory the first time it expands. One observation re-lists that level
 * and re-reads the clean open files under it; a dirty editor, a write in
 * flight and a failed read are never reread over. The watch itself is best
 * effort: a failed observation goes silently, because a tree refreshed by
 * hand is still a working tree.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { DirectoryWatches } from '../../ui-sidebar-files/tests/scripted-watch.client.ts'
import type { IdeFilesPort } from '../src/client/ide-files.ts'
import type { IdeTreeNode } from '../src/client/ide-model.ts'
import { createIdeWorkspace } from '../src/client/ide-workspace-service.ts'

const SID = 'session-one' as SessionId
const NEXT = 'session-two' as SessionId
const REFERENCE = { sessionId: SID } as unknown as SessionReference

const ROOT = '/project'
const FILE_A = '/project/a.ts'
const DIR = '/project/src'
const FILE_B = '/project/src/b.ts'

/** The tree the listing answers, mutable so a re-list can differ. */
const tree = new Map<string, readonly IdeTreeNode[]>([
  [ROOT, [
    { name: 'a.ts', path: FILE_A, kind: 'file' },
    { name: 'src', path: DIR, kind: 'directory' },
  ]],
  [DIR, [{ name: 'b.ts', path: FILE_B, kind: 'file' }]],
])

/** The text a read answers; a test mutates it to prove a re-read landed. */
let contents = new Map<string, string>([[FILE_A, 'a1\n'], [FILE_B, 'b1\n']])

/** The write the port performs; the write-in-flight test swaps it. */
let performWrite: IdeFilesPort['write'] = async (_sessionId, _path, content) => ({ content, version: 'v2' })

/** Settle pending microtasks and timers, so a watch that must NOT react gets its chance. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 20) })

/**
 * A file source over the mutable tree with the scripted watches, its `list`
 * and `read` spies so the tests count the calls a change provokes.
 * @param watches - the scripted directory watches the port hands out.
 * @returns the port with `list` and `read` spies attached.
 */
function port(watches: DirectoryWatches): IdeFilesPort & {
  list: ReturnType<typeof vi.fn>
  read: ReturnType<typeof vi.fn>
} {
  const list = vi.fn(async (_sessionId: SessionId, path: string) => tree.get(path) ?? [])
  const read = vi.fn(async (_sessionId: SessionId, path: string) => ({
    content: contents.get(path) ?? '',
    truncated: false,
    version: 'v1',
  }))
  return {
    list,
    read,
    write: async (sessionId: SessionId, path: string, content: string, expectedVersion: string | undefined, signal: AbortSignal) =>
      performWrite(sessionId, path, content, expectedVersion, signal),
    // The scripted watch reports the tree's own spelling of the target,
    // which is what the Host reports for the directory it observed.
    watch: async function* (sessionId: SessionId, path: string, signal: AbortSignal) {
      for await (const event of watches.watch(sessionId, path, signal)) {
        yield { kind: event, ...event === 'change' ? { absolutePath: path } : {} }
      }
    },
  }
}

/** Bind one workspace to the scripted project and acknowledge its root watch. */
async function bound(watches: DirectoryWatches): Promise<ReturnType<typeof createIdeWorkspace>> {
  const service = createIdeWorkspace(port(watches))
  service.bind(SID, ROOT, REFERENCE, 'title')
  const root = await watches.forPath(ROOT)
  await root.deliver('ready')
  return service
}

describe('the IDE workspace watches', () => {
  it('observes the project root and every directory the tree opens, once each', async () => {
    const watches = new DirectoryWatches()
    const service = await bound(watches)
    try {
      service.toggleDirectory(DIR)
      const open = await watches.forPath(DIR)
      await open.deliver('ready')

      // Collapsing and reopening a cached level must not stack a second watch.
      service.toggleDirectory(DIR)
      service.toggleDirectory(DIR)
      await settle()

      expect(watches.opened.map(stream => stream.path)).toEqual([ROOT, DIR])
    } finally {
      await watches.dispose()
      service.unbind()
    }
  })

  it('re-lists the observed level and reloads the clean open file under it', async () => {
    const watches = new DirectoryWatches()
    const service = await bound(watches)
    try {
      service.openFile(FILE_A, 'a.ts')
      await vi.waitFor(() => {
        expect(service.store.getSnapshot().files[0]?.content).toBe('a1\n')
      })

      // The Agent rewrote the file and left a new sibling beside it.
      contents = new Map([[FILE_A, 'a2\n']])
      tree.set(ROOT, [...tree.get(ROOT) ?? [], { name: 'c.ts', path: '/project/c.ts', kind: 'file' }])
      const root = await watches.forPath(ROOT)
      await root.deliver('change')

      await vi.waitFor(() => {
        expect(service.store.getSnapshot().files[0]?.content).toBe('a2\n')
      })
      expect(service.store.getSnapshot().levels.get(ROOT)).toContainEqual({ name: 'c.ts', path: '/project/c.ts', kind: 'file' })
    } finally {
      await watches.dispose()
      service.unbind()
    }
  })

  it('never rereads over a dirty editor, a write in flight, or a failed read', async () => {
    const watches = new DirectoryWatches()
    const files = port(watches)
    const service = createIdeWorkspace(files)
    service.bind(SID, ROOT, REFERENCE, 'title')
    const root = await watches.forPath(ROOT)
    await root.deliver('ready')

    // The dirty editor: its edits stay, and no read asks for the disk again.
    service.openFile(FILE_A, 'a.ts')
    await vi.waitFor(() => { expect(files.read).toHaveBeenCalledTimes(1) })
    service.editFile(FILE_A, 'edited\n')
    await root.deliver('change')
    await settle()
    expect(files.read).toHaveBeenCalledTimes(1)
    expect(service.store.getSnapshot().files[0]?.content).toBe('edited\n')
    expect(service.store.getSnapshot().files[0]?.dirty).toBe(true)

    // The write in flight: mid-flight, the file is nobody's to reload.
    let releaseWrite: ((result: { content: string; version: string }) => void) | undefined
    performWrite = async (_sessionId: SessionId, _path: string, content: string) => await new Promise((resolve) => {
      releaseWrite = () => { resolve({ content, version: 'v2' }) }
    })
    service.saveFile(FILE_A)
    await vi.waitFor(() => {
      expect(service.store.getSnapshot().files[0]?.saving).toBe(true)
    })
    await root.deliver('change')
    await settle()
    expect(files.read).toHaveBeenCalledTimes(1)

    // The failed read: it says why until the user asks again; an observation
    // refreshes the clean file beside it but never rereads the failed one.
    releaseWrite?.({ content: 'edited\n', version: 'v2' })
    await vi.waitFor(() => {
      expect(service.store.getSnapshot().files[0]?.saving).toBe(false)
    })
    files.read.mockRejectedValueOnce(new Error('disk went away'))
    service.openFile(FILE_B, 'b.ts')
    await vi.waitFor(() => {
      expect(service.store.getSnapshot().files.find(file => file.path === FILE_B)?.error).toBe('disk went away')
    })
    await root.deliver('change')
    await settle()
    // `b.ts` was read exactly once — its failure; `a.ts` was refreshed.
    expect(files.read.mock.calls.filter(call => call[1] === FILE_B)).toHaveLength(1)
    expect(files.read.mock.calls.at(-1)?.[1]).toBe(FILE_A)
  }, 15000)

  it('leaves the files outside the observed directory alone', async () => {
    const OUTSIDE = '/elsewhere/z.ts'
    const watches = new DirectoryWatches()
    const files = port(watches)
    const service = createIdeWorkspace(files)
    service.bind(SID, ROOT, REFERENCE, 'title')
    const root = await watches.forPath(ROOT)
    await root.deliver('ready')
    try {
      // `z.ts` sits outside the observed project root; `a.ts` sits inside it.
      service.openFile(FILE_A, 'a.ts')
      service.openFile(OUTSIDE, 'z.ts')
      await vi.waitFor(() => {
        expect(service.store.getSnapshot().files).toHaveLength(2)
      })
      const before = files.read.mock.calls.length

      await root.deliver('change')

      await vi.waitFor(() => {
        expect(files.read.mock.calls.length).toBe(before + 1)
      })
      // Only the file under the observed directory was asked for again.
      expect(files.read.mock.calls.at(-1)?.[1]).toBe(FILE_A)
      expect(service.store.getSnapshot().files.find(file => file.path === OUTSIDE)?.loading).toBeUndefined()
    } finally {
      await watches.dispose()
      service.unbind()
    }
  })

  it('does nothing on a ready frame', async () => {
    const watches = new DirectoryWatches()
    const files = port(watches)
    const service = createIdeWorkspace(files)
    service.bind(SID, ROOT, REFERENCE, 'title')
    const root = await watches.forPath(ROOT)
    await root.deliver('ready')
    try {
      await root.deliver('ready')
      await settle()

      expect(files.list).toHaveBeenCalledTimes(1)
      expect(files.read).not.toHaveBeenCalled()
    } finally {
      await watches.dispose()
      service.unbind()
    }
  })

  it('ends silently when the watch fails, and observes afresh', async () => {
    const watches = new DirectoryWatches()
    const service = await bound(watches)
    try {
      const root = await watches.forPath(ROOT)
      root.fail(new Error('backend does not watch'))
      await root.released.promise

      // The tree stays exactly as it was; the failure never becomes an error.
      expect(service.store.getSnapshot().error).toBeUndefined()
      expect(service.store.getSnapshot().levels.get(ROOT)).toBeDefined()

      // A failed watch re-opens itself: the level keeps observing without
      // the user asking for a refresh, because a watch that died silently
      // would freeze the tree at its last content.
      const second = await watches.forPath(ROOT, 1)
      await second.deliver('ready')
      expect(watches.opened.map(stream => stream.path)).toEqual([ROOT, ROOT])
    } finally {
      await watches.dispose()
      service.unbind()
    }
  })

  it('ends the watches when the binding goes away', async () => {
    const watches = new DirectoryWatches()
    const service = await bound(watches)
    service.toggleDirectory(DIR)
    await watches.forPath(DIR)
    try {
      service.unbind()
      await Promise.all(watches.opened.map(stream => stream.released.promise))
      expect(watches.opened).toHaveLength(2)
    } finally {
      await watches.dispose()
    }
  })

  it('ends the old session\'s watches when another session is bound, and opens its own root', async () => {
    const watches = new DirectoryWatches()
    const service = await bound(watches)
    try {
      service.bind(NEXT, '/other', REFERENCE, 'next')
      await Promise.all(watches.opened.slice(0, 1).map(stream => stream.released.promise))

      const other = await watches.forPath('/other')
      await other.deliver('ready')
      expect(watches.opened.map(stream => stream.path)).toEqual([ROOT, '/other'])
      expect(service.store.getSnapshot().sessionId).toBe(NEXT)
    } finally {
      await watches.dispose()
      service.unbind()
    }
  })

  it('keeps the watches alive when the same session is bound again', async () => {
    const watches = new DirectoryWatches()
    const service = await bound(watches)
    try {
      service.bind(SID, ROOT, REFERENCE, 'title')
      await settle()

      expect(watches.opened).toHaveLength(1)
    } finally {
      await watches.dispose()
      service.unbind()
    }
  })

  it('serves the tree without a watch verb, observing nothing', async () => {
    const list = vi.fn(async (_sessionId: SessionId, path: string) => tree.get(path) ?? [])
    const service = createIdeWorkspace({
      list,
      read: async () => ({ content: '', truncated: false, version: 'v1' }),
      write: async (_sessionId: SessionId, _path: string, content: string) => ({ content, version: 'v2' }),
    })
    service.bind(SID, ROOT, REFERENCE, 'title')

    await vi.waitFor(() => {
      expect(service.store.getSnapshot().levels.get(ROOT)).toBeDefined()
    })
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('the IDE workspace watches a Windows workspace', () => {
  // The Session header carries a native Windows path (`E:\Projects\App`), the
  // tree joins its children with `/`, and the Host spells the same directory
  // with its own separators and casing. The comparison must survive all of
  // it, or the open file is never refreshed.
  const WIN_ROOT = 'E:\\Projects\\App'
  const WIN_DIR = 'E:\\Projects\\App/packages'
  const WIN_FILE = 'E:\\Projects\\App/packages/a.ts'
  /** The Host's own spelling of the watched directory. */
  const HOST_DIR = 'e:\\projects\\app\\packages'

  const winTree = new Map<string, readonly IdeTreeNode[]>([
    [WIN_ROOT, [{ name: 'packages', path: WIN_DIR, kind: 'directory' }]],
    [WIN_DIR, [{ name: 'a.ts', path: WIN_FILE, kind: 'file' }]],
  ])

  /**
   * A port over the Windows tree whose watch reports the Host's spelling of
   * the observed target.
   * @param watches - the scripted directory watches the port hands out.
   * @returns the port with its `list` and `read` calls counted.
   */
  function winPort(watches: DirectoryWatches): IdeFilesPort & {
    list: ReturnType<typeof vi.fn>
    read: ReturnType<typeof vi.fn>
  } {
    const list = vi.fn(async (_sessionId: SessionId, path: string) => winTree.get(path) ?? [])
    const read = vi.fn(async (_sessionId: SessionId, _path: string) => ({
      content: 'a1\n',
      truncated: false,
      version: 'v1',
    }))
    return {
      list,
      read,
      write: async (_sessionId: SessionId, _path: string, content: string) => ({ content, version: 'v2' }),
      watch: async function* (sessionId: SessionId, path: string, signal: AbortSignal) {
        for await (const event of watches.watch(sessionId, path, signal)) {
          yield {
            kind: event,
            ...event === 'change' ? { absolutePath: path === WIN_DIR ? HOST_DIR : path } : {},
          }
        }
      },
    }
  }

  it('re-reads a file under a Windows directory when that directory changes', async () => {
    const watches = new DirectoryWatches()
    const files = winPort(watches)
    const service = createIdeWorkspace(files)
    service.bind(SID, WIN_ROOT, REFERENCE, 'title')
    const root = await watches.forPath(WIN_ROOT)
    await root.deliver('ready')
    try {
      // Open the file inside the nested Windows directory.
      service.toggleDirectory(WIN_DIR)
      const dir = await watches.forPath(WIN_DIR)
      await dir.deliver('ready')
      service.openFile(WIN_FILE, 'a.ts')
      await vi.waitFor(() => {
        expect(files.read).toHaveBeenCalledTimes(1)
      })

      // The Agent rewrote it: the directory's observation must re-read it,
      // even though the Host spelled the directory with other separators and
      // a different casing.
      const before = files.read.mock.calls.length
      await dir.deliver('change')
      await vi.waitFor(() => {
        expect(files.read.mock.calls.length).toBe(before + 1)
      })
      expect(files.read.mock.calls.at(-1)?.[1]).toBe(WIN_FILE)
    } finally {
      await watches.dispose()
      service.unbind()
    }
  })

  it('re-opens the watch when the Host stream ends, so the level keeps observing', async () => {
    const watches = new DirectoryWatches()
    const service = createIdeWorkspace(winPort(watches))
    service.bind(SID, WIN_ROOT, REFERENCE, 'title')
    const root = await watches.forPath(WIN_ROOT)
    await root.deliver('ready')
    try {
      // The Host stream ends: the watch must be re-opened, not left dead.
      root.stop()
      await root.released.promise

      const reopened = await watches.forPath(WIN_ROOT, 1)
      await reopened.deliver('ready')
      expect(watches.opened.map(stream => stream.path)).toEqual([WIN_ROOT, WIN_ROOT])

      // The re-opened watch still drives the refresh.
      service.openFile(WIN_FILE, 'a.ts')
      await vi.waitFor(() => {
        expect(service.store.getSnapshot().files[0]?.content).toBe('a1\n')
      })
    } finally {
      await watches.dispose()
      service.unbind()
    }
  })
})
