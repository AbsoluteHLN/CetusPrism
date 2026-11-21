/**
 * The IDE workspace model: the Session binding, the listed tree levels and
 * the files on the tab strip.
 */

import { describe, expect, it } from 'vitest'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  activateFile,
  activeFile,
  bindSession,
  closeFile,
  collapseDirectory,
  expandDirectory,
  INITIAL_IDE_STATE,
  openFile,
  setError,
  setLevel,
  setListing,
  setQuery,
  unbindSession,
  type IdeFile,
  type IdeWorkspaceState,
} from '../src/client/ide-model.ts'

const SID = 'session-one' as SessionId
const OTHER = 'session-two' as SessionId
const REFERENCE = { sessionId: SID } as unknown as SessionReference

function file(path: string, over: Partial<IdeFile> = {}): IdeFile {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, language: 'typescript', content: `// ${name}\n`, ...over }
}

function workspace(...files: IdeFile[]): IdeWorkspaceState {
  return files.reduce((state, current) => openFile(state, current), INITIAL_IDE_STATE)
}

describe('the IDE workspace model', () => {
  it('binds a session with its project root and starts from an empty tree', () => {
    const bound = bindSession(INITIAL_IDE_STATE, SID, '/project', REFERENCE)

    expect(bound.sessionId).toBe(SID)
    expect(bound.reference).toBe(REFERENCE)
    expect(bound.root).toBe('/project')
    expect(bound.levels.size).toBe(0)
    expect(bound.files).toEqual([])
  })

  it('starts over when another session is bound', () => {
    const bound = bindSession(INITIAL_IDE_STATE, SID, '/project', REFERENCE)
    const withFile = openFile(bound, file('/project/a.ts'))
    const withLevel = setLevel(withFile, '/project', [])

    const rebound = bindSession(withLevel, OTHER, '/other', REFERENCE)

    expect(rebound.sessionId).toBe(OTHER)
    expect(rebound.root).toBe('/other')
    expect(rebound.levels.size).toBe(0)
    expect(rebound.files).toEqual([])
  })

  it('keeps the tree and the tabs when the same session is bound again', () => {
    const bound = bindSession(INITIAL_IDE_STATE, SID, '/project', REFERENCE)
    const withLevel = setLevel(bound, '/project', [{ name: 'a.ts', path: '/project/a.ts', kind: 'file' }])

    const again = bindSession(withLevel, SID, '/project', REFERENCE)

    expect(again).toBe(withLevel)
  })

  it('carries the session title for the pane headers', () => {
    const bound = bindSession(INITIAL_IDE_STATE, SID, '/project', REFERENCE, '体素村庄任务')

    expect(bound.sessionTitle).toBe('体素村庄任务')
  })

  it('takes a late session title without losing the tree', () => {
    const bound = bindSession(INITIAL_IDE_STATE, SID, '/project', REFERENCE)
    const withLevel = setLevel(bound, '/project', [{ name: 'a.ts', path: '/project/a.ts', kind: 'file' }])

    const titled = bindSession(withLevel, SID, '/project', REFERENCE, '体素村庄任务')

    expect(titled.sessionTitle).toBe('体素村庄任务')
    expect(titled.levels.size).toBe(1)
    expect(titled.files).toEqual([])
  })

  it('releases the session binding on unbind', () => {
    const bound = bindSession(INITIAL_IDE_STATE, SID, '/project', REFERENCE)

    const unbound = unbindSession(bound)

    expect(unbound.sessionId).toBeUndefined()
    expect(unbound.reference).toBeUndefined()
    expect(unbound.root).toBeUndefined()
  })

  it('records one listed directory level', () => {
    const nodes = [{ name: 'a.ts', path: '/project/a.ts', kind: 'file' }] as const

    const listed = setLevel(INITIAL_IDE_STATE, '/project', nodes)

    expect(listed.levels.get('/project')).toEqual(nodes)
  })

  it('expands and collapses a directory', () => {
    const expanded = expandDirectory(INITIAL_IDE_STATE, '/project/src')

    expect(expanded.expanded).toEqual(['/project/src'])
    expect(expandDirectory(expanded, '/project/src')).toBe(expanded)

    const collapsed = collapseDirectory(expanded, '/project/src')

    expect(collapsed.expanded).toEqual([])
  })

  it('marks a listing as running and settled', () => {
    const running = setListing(INITIAL_IDE_STATE, '/project', true)

    expect(running.listing).toEqual(['/project'])
    expect(setListing(running, '/project', false).listing).toEqual([])
  })

  it('keeps the tree failure until it is cleared', () => {
    const failed = setError(INITIAL_IDE_STATE, 'boom')

    expect(failed.error).toBe('boom')
    expect(setError(failed, undefined).error).toBeUndefined()
  })

  it('sets the tree filter', () => {
    const filtered = setQuery(INITIAL_IDE_STATE, 'main')

    expect(filtered.query).toBe('main')
    expect(setQuery(filtered, 'main')).toBe(filtered)
  })

  it('opens a file onto the tab strip and makes it the active one', () => {
    const state = openFile(INITIAL_IDE_STATE, file('src/a.ts'))

    expect(state.files.map(tab => tab.path)).toEqual(['src/a.ts'])
    expect(state.activePath).toBe('src/a.ts')
    expect(activeFile(state)?.name).toBe('a.ts')
  })

  it('does not open the same file twice', () => {
    const state = workspace(file('src/a.ts'))
    const again = openFile(state, file('src/a.ts', { content: '// changed\n' }))

    expect(again.files).toHaveLength(1)
    expect(again.files[0]?.content).toBe('// changed\n')
  })

  it('hands the code surface to the neighbour when the active tab closes', () => {
    const state = workspace(file('src/a.ts'), file('src/b.ts'), file('src/c.ts'))
    const closed = closeFile(state, 'src/c.ts')

    expect(closed.files.map(tab => tab.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(closed.activePath).toBe('src/b.ts')
  })

  it('leaves the surface empty when the last tab closes', () => {
    const state = workspace(file('src/a.ts'))
    const closed = closeFile(state, 'src/a.ts')

    expect(closed.files).toEqual([])
    expect(closed.activePath).toBeNull()
    expect(activeFile(closed)).toBeUndefined()
  })

  it('keeps the active file when another tab closes', () => {
    const state = workspace(file('src/a.ts'), file('src/b.ts'))
    const closed = closeFile(state, 'src/a.ts')

    expect(closed.activePath).toBe('src/b.ts')
  })

  it('activates a file that is already open and ignores one that is not', () => {
    const state = workspace(file('src/a.ts'), file('src/b.ts'))

    expect(activateFile(state, 'src/a.ts').activePath).toBe('src/a.ts')
    expect(activateFile(state, 'src/missing.ts')).toBe(state)
  })
})
