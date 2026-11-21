/**
 * The `write` endpoint: the guarded write an editor performs.
 *
 * A write is the exception to the read authority. It stays inside the
 * Session's workspace root, runs under that Session's own sandbox mode, and
 * is guarded by the version the caller read — so an editor never overwrites a
 * file the Agent rewrote under it, and never writes outside the project.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-write-')
})

afterEach(async () => {
  await harness.dispose()
})

describe('workspaceFiles.write', () => {
  it('writes the file and reports the version it produced', async () => {
    const path = join(harness.workspace, 'notes.txt')
    await writeFile(path, 'old\n', 'utf8')
    const endpoint = harness.endpoint()
    const before = await endpoint.stat(harness.scope, 'notes.txt', signal())

    const result = await endpoint.write(
      harness.scope, 'notes.txt', 'new\n', { expectedVersion: before.version }, signal(),
    )

    expect(await readFile(path, 'utf8')).toBe('new\n')
    expect(result.version).not.toBe(before.version)
    expect(result.after).toBe('new\n')
    expect(result.operation).toBe('update')
  })

  it('refuses a write whose version moved on, and leaves the file as it is', async () => {
    const path = join(harness.workspace, 'notes.txt')
    await writeFile(path, 'old\n', 'utf8')
    const endpoint = harness.endpoint()
    const before = await endpoint.stat(harness.scope, 'notes.txt', signal())
    // The Agent rewrote the file under the editor.
    await writeFile(path, "agent's\n", 'utf8')

    expect(await failureOf(endpoint.write(
      harness.scope, 'notes.txt', 'mine\n', { expectedVersion: before.version }, signal(),
    ))).toMatchObject({ code: 'workspace-file/stale-version' })
    expect(await readFile(path, 'utf8')).toBe("agent's\n")
  })

  it('refuses the write under a read-only sandbox', async () => {
    await writeFile(join(harness.workspace, 'notes.txt'), 'old\n', 'utf8')
    harness.setMode('read-only')

    expect(await failureOf(harness.endpoint().write(
      harness.scope, 'notes.txt', 'new\n', {}, signal(),
    ))).toMatchObject({ code: 'workspace-file/read-only' })
    expect(await readFile(join(harness.workspace, 'notes.txt'), 'utf8')).toBe('old\n')
  })

  it('refuses a write outside the workspace, even where the file may be read', async () => {
    const path = join(harness.outside, 'secret.txt')
    await writeFile(path, 'no\n', 'utf8')

    expect(await failureOf(harness.endpoint().write(
      harness.scope, path, 'mine\n', {}, signal(),
    ))).toMatchObject({ code: 'workspace-file/outside-workspace' })
    expect(await readFile(path, 'utf8')).toBe('no\n')
  })

  it('refuses a directory, a missing file and an empty path', async () => {
    const endpoint = harness.endpoint()
    expect((await failureOf(endpoint.write(harness.scope, '', 'x', {}, signal()))).code).toBe('gateway/bad-request')
    expect((await failureOf(endpoint.write(harness.scope, 'nope.txt', 'x', {}, signal()))).code)
      .toBe('workspace-file/not-found')
    expect((await failureOf(endpoint.write(harness.scope, '.', 'x', {}, signal()))).code)
      .toBe('workspace-file/not-regular-file')
  })
})
