/**
 * The IDE's write path: from the editor's own edit to the file on disk.
 *
 * The service owns the dirty state and the conflict: an edit makes the file
 * dirty, a write names the version the file was read at, and a refused write
 * keeps the edits in the editor and says why.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createIdeWorkspace } from '../src/client/ide-workspace-service.ts'
import type { IdeFilesPort } from '../src/client/ide-files.ts'

const SID = 'session-one' as SessionId
const REFERENCE = { sessionId: SID } as unknown as SessionReference
const PATH = '/project/a.ts'

/**
 * A file source over one file, with a write the test controls.
 * @param write - the write the source performs.
 * @param read - the read the source performs.
 * @returns the port and the write spy.
 */
function port(
  write: IdeFilesPort['write'],
  read: IdeFilesPort['read'] = async () => ({ content: 'original\n', truncated: false, version: 'v1' }),
): { port: IdeFilesPort; written: ReturnType<typeof vi.fn> } {
  const written = vi.fn(write)
  return {
    port: { list: async () => [], read, write: written },
    written,
  }
}

describe('the IDE write path', () => {
  it('writes the edited text back under the version it read', async () => {
    const { port: files, written } = port(async (_id, _path, content) => ({ content, version: 'v2' }))
    const service = createIdeWorkspace(files)
    service.bind(SID, '/project', REFERENCE, 'title')
    service.openFile(PATH, 'a.ts')
    await vi.waitFor(() => {
      expect(service.store.getSnapshot().files[0]?.content).toBe('original\n')
    })

    service.editFile(PATH, 'edited\n')
    expect(service.store.getSnapshot().files[0]?.dirty).toBe(true)

    service.saveFile(PATH)
    await vi.waitFor(() => { expect(written).toHaveBeenCalledTimes(1) })
    // The write names the version the editor read: the Agent's rewrite under
    // the editor is what the guard refuses.
    expect(written.mock.calls[0]?.[2]).toBe('edited\n')
    expect(written.mock.calls[0]?.[3]).toBe('v1')

    await vi.waitFor(() => {
      expect(service.store.getSnapshot().files[0]?.dirty).toBe(false)
    })
    expect(service.store.getSnapshot().files[0]?.version).toBe('v2')
  })

  it('keeps the edits and says why when the write is refused', async () => {
    const { port: files } = port(async () => {
      throw new Error('"a.ts" changed on disk since it was read')
    })
    const service = createIdeWorkspace(files)
    service.bind(SID, '/project', REFERENCE, 'title')
    service.openFile(PATH, 'a.ts')
    await vi.waitFor(() => {
      expect(service.store.getSnapshot().files[0]?.content).toBe('original\n')
    })

    service.editFile(PATH, 'edited\n')
    service.saveFile(PATH)

    await vi.waitFor(() => {
      expect(service.store.getSnapshot().files[0]?.conflict).toBeDefined()
    })
    const file = service.store.getSnapshot().files[0]
    expect(file?.conflict).toContain('changed on disk')
    // The user's text is still there: a refusal never throws the edit away.
    expect(file?.content).toBe('edited\n')
    expect(file?.dirty).toBe(true)
    expect(file?.saving).toBe(false)
  })

  it('does not write a file that was not changed', async () => {
    const { port: files, written } = port(async (_id, _path, content) => ({ content, version: 'v2' }))
    const service = createIdeWorkspace(files)
    service.bind(SID, '/project', REFERENCE, 'title')
    service.openFile(PATH, 'a.ts')
    await vi.waitFor(() => {
      expect(service.store.getSnapshot().files[0]?.content).toBe('original\n')
    })

    service.saveFile(PATH)

    expect(written).not.toHaveBeenCalled()
  })

  it('does not re-read over the edits of an open file', async () => {
    const read = vi.fn(async () => ({ content: 'original\n', truncated: false, version: 'v1' }))
    const { port: files } = port(async (_id, _path, content) => ({ content, version: 'v2' }), read)
    const service = createIdeWorkspace(files)
    service.bind(SID, '/project', REFERENCE, 'title')
    service.openFile(PATH, 'a.ts')
    await vi.waitFor(() => {
      expect(service.store.getSnapshot().files[0]?.content).toBe('original\n')
    })

    service.editFile(PATH, 'edited\n')
    service.openFile(PATH, 'a.ts')

    // The re-read landed; the edits are still the ones on screen.
    await vi.waitFor(() => { expect(read).toHaveBeenCalledTimes(2) })
    expect(service.store.getSnapshot().files[0]?.content).toBe('edited\n')
    expect(service.store.getSnapshot().files[0]?.dirty).toBe(true)
  })
})
