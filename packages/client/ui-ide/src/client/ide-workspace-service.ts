/**
 * The IDE workspace service: the face the surface renders from, and the
 * verbs that drive the Host's file source.
 *
 * The surface owns no data source. The workspace reads its tree and its file
 * contents through the {@link IdeFilesPort} it is handed, so the same surface
 * serves the web client, the desktop shell and the tests — and the durable
 * log stays the only place a Session's content lives.
 *
 * One listing or read is in force per path: asking again retires the request
 * still in flight for it, whose settlement then writes nothing.
 *
 * Each listed level is also OBSERVED, when the file source supports it: one
 * watch per listed directory turns the Host's filesystem observations into a
 * re-listing of that level and a re-read of the clean open files it holds, so
 * the tree follows the Agent's writes without a hand-driven refresh. A dirty
 * editor keeps its edits — the observation never rereads over them.
 *
 * @module @deepseek-ai/dsh-client-ui-ide/ide-workspace-service
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  activateFile,
  bindSession,
  closeFile,
  collapseDirectory,
  editFile,
  expandDirectory,
  INITIAL_IDE_STATE,
  markConflict,
  markSaved,
  markSaving,
  openFile,
  setError,
  setLevel,
  setListing,
  setQuery,
  unbindSession,
  type IdeWorkspaceState,
} from './ide-model.ts'
import { ideLanguage, ideViewKind, ideViewUsesTextRead, type IdeFileContent, type IdeFilesPort } from './ide-files.ts'
import type { IdeFile } from './ide-model.ts'

/** The IDE workspace service the client talks to. */
export interface IIdeWorkspace {
  /** The store the surface subscribes to. */
  readonly store: SnapshotStore<IdeWorkspaceState>
  /**
   * Bind the workspace to a Session and load its project root.
   * @param sessionId - the Session to bind.
   * @param root - the Session's project root.
   * @param reference - the retained Session reference the assistant column shows.
   * @param sessionTitle - the Session's display title, for the pane headers.
   */
  bind: (sessionId: SessionId, root: string | undefined, reference: SessionReference, sessionTitle?: string) => void
  /** Release the workspace: the tree and the tab strip go with the Session. */
  unbind: () => void
  /** Expand or collapse one directory, listing it the first time it opens. */
  toggleDirectory: (path: string) => void
  /** Open a file on the tab strip. */
  openFile: (path: string, name: string) => void
  /** Close a tab. */
  closeFile: (path: string) => void
  /** Bring an open file to the front. */
  activateFile: (path: string) => void
  /** Replace one open file's text with the editor's own edit. */
  editFile: (path: string, content: string) => void
  /** Write one open file's text back to disk. */
  saveFile: (path: string) => void
  /** Set the tree's filter text. */
  setQuery: (query: string) => void
  /** Reload the listed levels and the open files. */
  refresh: () => void
}

/**
 * The failure message of one rejected request.
 * @param error - the rejection.
 * @returns the message to show.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Drop one file's blob URL when the tab no longer needs it.
 * @param file - the file being closed or replaced.
 */
function revokeMediaUrl(file: IdeFile | undefined): void {
  const url = file?.mediaUrl
  if (url !== undefined && url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/**
 * Build an object URL for one binary preview.
 * @param data - the file bytes.
 * @param mime - the MIME type.
 * @returns the URL the viewer should load.
 */
function mediaUrlFromBytes(data: Uint8Array, mime: string): string {
  const copy = new Uint8Array(data)
  return URL.createObjectURL(new Blob([copy], { type: mime }))
}

/**
 * The comparison key of one path.
 *
 * The tree spells a level with the separators the Session header carried
 * (`E:\Projects\App`) and joins its children with `/`, while the Host spells
 * the same directory with its own separators (`E:\Projects\App\packages`).
 * A raw prefix test between those two spellings misses; a normalized key
 * compares the two paths as the same location, whatever separator or letter
 * case each side used.
 * @param path - the path to normalize.
 * @returns the key: `/`-separated and case-folded.
 */
function pathKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/**
 * Create the IDE workspace service.
 *
 * The service owns the state and the verbs; the file source is supplied
 * later, so the surface can mount before the workspace's files are known.
 * @param files - the file source the workspace reads through.
 * @returns the service.
 */
export function createIdeWorkspace(files?: IdeFilesPort): IIdeWorkspace {
  const store = createSnapshotStore<IdeWorkspaceState>(INITIAL_IDE_STATE)
  const listings = new Map<string, AbortController>()
  const reads = new Map<string, AbortController>()
  const saves = new Map<string, AbortController>()
  const watches = new Map<string, AbortController>()

  const abortAll = (): void => {
    for (const controller of listings.values()) controller.abort()
    for (const controller of reads.values()) controller.abort()
    for (const controller of saves.values()) controller.abort()
    listings.clear()
    reads.clear()
    saves.clear()
  }

  /** End every directory observation: the Session the watches belong to is going away. */
  const stopWatches = (): void => {
    for (const controller of watches.values()) controller.abort()
    watches.clear()
  }

  /**
   * React to one observation of a watched directory: its children may have moved on.
   *
   * @param path - the watched directory, in the tree's spelling.
   * @param observedPath - the target the Host observed, in the Host's spelling.
   */
  const observeChange = (path: string, observedPath?: string): void => {
    // A watch exists only for a listed level, and a level stays cached while
    // its directory is collapsed, so re-listing keeps it honest either way:
    // an expanded level redraws at once, a folded one is fresh at the next
    // expansion.
    loadLevel(path)
    // The Host names the target it observed. Its spelling is the authority:
    // the tree joined its own paths with `/` while the Host spells the same
    // directory with the platform's separators, so the two are compared
    // through a normalized key rather than as raw prefixes.
    const level = pathKey(observedPath ?? path)
    for (const file of store.getSnapshot().files) {
      // A dirty editor keeps its edits, a file being written is mid-flight,
      // and a failed read says why until the user asks for it again.
      if (file.dirty === true || file.saving === true || file.error !== undefined) continue
      // The file must live under the observed directory. The comparison is
      // normalized: the tree and the Host spell the same path with different
      // separators, and a Windows path is case-insensitive.
      if (!pathKey(file.path).startsWith(`${level}/`)) continue
      readFile(file.path, file.name)
    }
  }

  /** Observe one listed directory, once; a path already watched is left alone. */
  const startWatch = (watch: NonNullable<IdeFilesPort['watch']>, path: string, sessionId: SessionId): void => {
    if (watches.has(path)) return
    const controller = new AbortController()
    watches.set(path, controller)
    void (async () => {
      try {
        // The stream ends when the signal does, so the loop outlives the
        // watch exactly until the binding that owns it goes away.
        for await (const event of watch(sessionId, path, controller.signal)) {
          if (event.kind === 'ready') continue
          observeChange(path, event.absolutePath)
        }
      } catch {
        // A watch is best effort: a failed observation — a backend without
        // watch support, a dropped stream — stops this directory's auto
        // refresh without disturbing the tree or the open files.
      } finally {
        // THE WATCH IS ONE-SHOT, so it must be re-opened. A Host stream that
        // ends is terminal for the supervisor, and a watch that dies silently
        // leaves this level frozen at its last content forever: the tree
        // stops following the Agent's writes and no error says so. Releasing
        // the path and re-listing the level re-opens the watch and refreshes
        // what it missed, so a dropped connection costs one cycle instead of
        // the rest of the Session.
        if (watches.get(path) !== controller) return
        watches.delete(path)
        if (controller.signal.aborted) return
        const session = store.getSnapshot().sessionId
        if (session === undefined || session !== sessionId) return
        loadLevel(path)
      }
    })()
  }

  const loadLevel = (path: string): void => {
    const sessionId = store.getSnapshot().sessionId
    if (sessionId === undefined || files === undefined) return
    const watch = files.watch
    listings.get(path)?.abort()
    const controller = new AbortController()
    listings.set(path, controller)
    store.set(setListing(store.getSnapshot(), path, true))
    void files.list(sessionId, path, controller.signal).then((nodes) => {
      if (controller.signal.aborted) return
      listings.delete(path)
      store.set(setListing(store.getSnapshot(), path, false))
      store.set(setLevel(store.getSnapshot(), path, nodes))
      store.set(setError(store.getSnapshot(), undefined))
      if (watch !== undefined) startWatch(watch, path, sessionId)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      listings.delete(path)
      store.set(setListing(store.getSnapshot(), path, false))
      store.set(setError(store.getSnapshot(), messageOf(error)))
    })
  }

  const readFile = (path: string, name: string): void => {
    const sessionId = store.getSnapshot().sessionId
    if (sessionId === undefined || files === undefined) return
    const prior = store.getSnapshot().files.find(candidate => candidate.path === path)
    revokeMediaUrl(prior)
    reads.get(path)?.abort()
    const controller = new AbortController()
    reads.set(path, controller)
    const viewKind = ideViewKind(path)
    store.set(openFile(store.getSnapshot(), {
      path,
      name,
      language: ideLanguage(path),
      content: '',
      viewKind,
      loading: true,
      mediaUrl: undefined,
    }))
    const settleText = (result: IdeFileContent): void => {
      if (controller.signal.aborted) return
      reads.delete(path)
      store.set(openFile(store.getSnapshot(), {
        path,
        name,
        language: ideLanguage(path),
        content: result.content,
        truncated: result.truncated,
        ...(result.version !== undefined ? { version: result.version } : {}),
        viewKind,
      }))
    }
    const settleError = (error: unknown): void => {
      if (controller.signal.aborted) return
      reads.delete(path)
      store.set(openFile(store.getSnapshot(), {
        path,
        name,
        language: ideLanguage(path),
        content: '',
        viewKind,
        error: messageOf(error),
      }))
    }
    if (ideViewUsesTextRead(viewKind)) {
      void files.read(sessionId, path, controller.signal).then(settleText).catch(settleError)
      return
    }
    const readBytes = files.readBytes
    if (readBytes === undefined) {
      settleError(new Error('Binary preview is unavailable'))
      return
    }
    void readBytes(sessionId, path, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      reads.delete(path)
      store.set(openFile(store.getSnapshot(), {
        path,
        name,
        language: ideLanguage(path),
        content: '',
        version: result.version,
        viewKind,
        mediaUrl: mediaUrlFromBytes(result.data, result.mime),
      }))
    }).catch(settleError)
  }

  return {
    store,
    bind(sessionId, root, reference, sessionTitle) {
      abortAll()
      // Leaving the watch for a re-bound Session keeps the tree honest while
      // the workspace survives being left and re-entered; another Session's
      // observations mean nothing here, so they end with the old binding.
      if (store.getSnapshot().sessionId !== sessionId) stopWatches()
      const state = store.getSnapshot()
      const bound = bindSession(state, sessionId, root, reference, sessionTitle)
      // Binding the same Session again keeps the tree, but the reference is a
      // new object: the store must hear about it, or the assistant column
      // would keep the released one.
      store.set(bound === state ? { ...state, reference } : bound)
      if (root !== undefined) loadLevel(root)
    },
    unbind() {
      abortAll()
      stopWatches()
      for (const file of store.getSnapshot().files) revokeMediaUrl(file)
      store.set(unbindSession(store.getSnapshot()))
    },
    toggleDirectory(path) {
      const state = store.getSnapshot()
      if (state.expanded.includes(path)) {
        store.set(collapseDirectory(state, path))
        return
      }
      store.set(expandDirectory(state, path))
      if (!state.levels.has(path)) loadLevel(path)
    },
    openFile(path, name) {
      readFile(path, name)
    },
    closeFile(path) {
      const file = store.getSnapshot().files.find(candidate => candidate.path === path)
      revokeMediaUrl(file)
      store.set(closeFile(store.getSnapshot(), path))
    },
    activateFile(path) {
      store.set(activateFile(store.getSnapshot(), path))
    },
    editFile(path, content) {
      store.set(editFile(store.getSnapshot(), path, content))
    },
    saveFile(path) {
      const state = store.getSnapshot()
      const sessionId = state.sessionId
      const file = state.files.find(candidate => candidate.path === path)
      if (sessionId === undefined || files === undefined || file === undefined) return
      // Nothing to write, or a write already in flight for this file.
      if (file.dirty !== true || file.saving === true) return
      store.set(markSaving(state, path))
      saves.get(path)?.abort()
      const controller = new AbortController()
      saves.set(path, controller)
      void files.write(sessionId, path, file.content, file.version, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        saves.delete(path)
        store.set(markSaved(store.getSnapshot(), path, result.content, result.version))
      }).catch((error: unknown) => {
        if (controller.signal.aborted) return
        saves.delete(path)
        // A refused write keeps the edits in the editor and says why.
        store.set(markConflict(store.getSnapshot(), path, messageOf(error)))
      })
    },
    setQuery(query) {
      store.set(setQuery(store.getSnapshot(), query))
    },
    refresh() {
      const state = store.getSnapshot()
      const root = state.root
      if (root === undefined) return
      for (const path of state.levels.keys()) loadLevel(path)
      for (const file of state.files) {
        if (file.error !== undefined) continue
        readFile(file.path, file.name)
      }
    },
  }
}

/** The surface's face: the store it reads and the verbs it calls. */
export interface IdeWorkspaceFace {
  /** The workspace state; the surface subscribes to it. */
  readonly store: SnapshotStore<IdeWorkspaceState>
  /** Expand or collapse one directory. */
  readonly toggleDirectory: (path: string) => void
  /** Open a file in the tab strip. */
  readonly open: (path: string, name: string) => void
  /** Close a tab. */
  readonly close: (path: string) => void
  /** Bring an open file to the front. */
  readonly activate: (path: string) => void
  /** Replace one open file's text with the editor's own edit. */
  readonly edit: (path: string, content: string) => void
  /** Write one open file's text back to disk. */
  readonly save: (path: string) => void
  /** Set the tree's filter text. */
  readonly setQuery: (query: string) => void
  /** Reload the listed levels and the open files. */
  readonly refresh: () => void
}

/**
 * The face the surface renders from, bound to one workspace service.
 * @param workspace - the workspace service.
 * @returns the surface's face.
 */
export function ideWorkspaceFace(workspace: IIdeWorkspace): IdeWorkspaceFace {
  return {
    store: workspace.store,
    toggleDirectory: (path) => { workspace.toggleDirectory(path) },
    open: (path, name) => { workspace.openFile(path, name) },
    close: (path) => { workspace.closeFile(path) },
    activate: (path) => { workspace.activateFile(path) },
    edit: (path, content) => { workspace.editFile(path, content) },
    save: (path) => { workspace.saveFile(path) },
    setQuery: (query) => { workspace.setQuery(query) },
    refresh: () => { workspace.refresh() },
  }
}
