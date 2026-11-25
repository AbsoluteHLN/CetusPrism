/**
 * The IDE workspace's model: the Session it belongs to, the project tree it
 * shows, and the files open in its tab strip.
 *
 * The model carries no I/O. The tree levels and the file contents arrive
 * through the injected face, so the same model serves the web client, the
 * desktop shell and the tests without a Remote in between — and the durable
 * log stays the only place a Session's content lives.
 *
 * The tree is stored as LEVELS, not as one nested tree: a directory is listed
 * only when it is expanded, so the workspace holds what the user has actually
 * opened rather than the whole project.
 *
 * @module @deepseek-ai/dsh-client-ui-ide/ide-model
 */

import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { IdeViewKind } from './ide-view-kind.ts'

/** One child of a listed directory. */
export interface IdeTreeNode {
  /** The child's own name. */
  readonly name: string
  /** The child's absolute path. */
  readonly path: string
  /** Whether the child is a directory. */
  readonly kind: 'file' | 'directory'
}

/** One file the workspace can show. */
export interface IdeFile {
  /** Absolute path; the tab strip and the tree both key on it. */
  readonly path: string
  /** The file's name, as a tab shows it. */
  readonly name: string
  /** The syntax language, for the code surface. */
  readonly language: string
  /** The file's text. */
  readonly content: string
  /** Whether the file is still being read. */
  readonly loading?: boolean | undefined
  /** The failure that kept the file from being read. */
  readonly error?: string | undefined
  /** Whether the read stopped before the file's last line. */
  readonly truncated?: boolean | undefined
  /** The file's version token at the last read; the write guard names it. */
  readonly version?: string | undefined
  /** Whether the text carries edits that are not on disk yet. */
  readonly dirty?: boolean | undefined
  /** Whether a write of this file is in flight. */
  readonly saving?: boolean | undefined
  /** The refusal of the last write; the edits stay in the editor. */
  readonly conflict?: string | undefined
  /** How the center column presents this file. */
  readonly viewKind?: IdeViewKind | undefined
  /**
   * Object URL for a binary preview; revoked when the tab closes.
   *
   * Callers must treat the URL as owned by the workspace service.
   */
  readonly mediaUrl?: string | undefined
}

/** The workspace's current state. */
export interface IdeWorkspaceState {
  /** The Session the workspace belongs to; undefined while none is bound. */
  readonly sessionId: SessionId | undefined
  /** The retained Session reference the assistant column shows. */
  readonly reference: SessionReference | undefined
  /** The bound Session's project root; undefined while none is bound. */
  readonly root: string | undefined
  /** The bound Session's display title; undefined while none is bound. */
  readonly sessionTitle: string | undefined
  /** One level of the tree per listed directory, keyed by its absolute path. */
  readonly levels: ReadonlyMap<string, readonly IdeTreeNode[]>
  /** The directories the user has expanded. */
  readonly expanded: readonly string[]
  /** The directories whose listing is in flight. */
  readonly listing: readonly string[]
  /** The open files, in tab order. */
  readonly files: readonly IdeFile[]
  /** The file the code surface shows, or null while nothing is open. */
  readonly activePath: string | null
  /** The tree's filter text. */
  readonly query: string
  /** The failure that kept the tree from being listed. */
  readonly error: string | undefined
}

/** The state a workspace starts in. */
export const INITIAL_IDE_STATE: IdeWorkspaceState = {
  sessionId: undefined,
  reference: undefined,
  root: undefined,
  sessionTitle: undefined,
  levels: new Map(),
  expanded: [],
  listing: [],
  files: [],
  activePath: null,
  query: '',
  error: undefined,
}

/**
 * Bind the workspace to a Session: the tree and the tab strip are that
 * Session's project, so a different Session starts from scratch.
 *
 * Binding the same Session again keeps the tree and the open files — the
 * workspace survives being left and re-entered.
 * @param state - the workspace before the binding.
 * @param sessionId - the Session to bind.
 * @param root - the Session's project root.
 * @param reference - the retained Session reference the assistant column shows.
 * @param sessionTitle - the Session's display title, for the pane headers.
 * @returns the workspace after the binding.
 */
export function bindSession(
  state: IdeWorkspaceState,
  sessionId: SessionId,
  root: string | undefined,
  reference: SessionReference | undefined,
  sessionTitle?: string,
): IdeWorkspaceState {
  if (state.sessionId === sessionId) {
    // The same Session again: the tree and the open files stay, but a title
    // that arrived late must still reach the surface.
    if (sessionTitle === undefined || sessionTitle === state.sessionTitle) return state
    return { ...state, sessionTitle }
  }
  return {
    ...INITIAL_IDE_STATE,
    sessionId,
    reference,
    root,
    sessionTitle,
    levels: new Map(),
  }
}

/**
 * Unbind the workspace: the tree and the tab strip go with the Session.
 * @param state - the workspace before the unbinding.
 * @returns the workspace after the unbinding.
 */
export function unbindSession(state: IdeWorkspaceState): IdeWorkspaceState {
  if (state.sessionId === undefined) return state
  return { ...INITIAL_IDE_STATE }
}

/**
 * Record one listed directory level.
 * @param state - the workspace before the listing.
 * @param path - the listed directory's absolute path.
 * @param nodes - the directory's children.
 * @returns the workspace after the listing.
 */
export function setLevel(
  state: IdeWorkspaceState,
  path: string,
  nodes: readonly IdeTreeNode[],
): IdeWorkspaceState {
  const levels = new Map(state.levels)
  levels.set(path, nodes)
  return { ...state, levels }
}

/**
 * Mark a directory's listing as running or settled.
 * @param state - the workspace before the change.
 * @param path - the listed directory's absolute path.
 * @param running - whether the listing is in flight.
 * @returns the workspace after the change.
 */
export function setListing(
  state: IdeWorkspaceState,
  path: string,
  running: boolean,
): IdeWorkspaceState {
  const has = state.listing.includes(path)
  if (running === has) return state
  return {
    ...state,
    listing: running ? [...state.listing, path] : state.listing.filter(entry => entry !== path),
  }
}

/**
 * Expand a directory.
 * @param state - the workspace before the expansion.
 * @param path - the directory's absolute path.
 * @returns the workspace after the expansion.
 */
export function expandDirectory(state: IdeWorkspaceState, path: string): IdeWorkspaceState {
  if (state.expanded.includes(path)) return state
  return { ...state, expanded: [...state.expanded, path] }
}

/**
 * Collapse a directory.
 * @param state - the workspace before the collapse.
 * @param path - the directory's absolute path.
 * @returns the workspace after the collapse.
 */
export function collapseDirectory(state: IdeWorkspaceState, path: string): IdeWorkspaceState {
  if (!state.expanded.includes(path)) return state
  return { ...state, expanded: state.expanded.filter(entry => entry !== path) }
}

/**
 * Record the tree's failure.
 * @param state - the workspace before the change.
 * @param error - the failure's message; undefined clears it.
 * @returns the workspace after the change.
 */
export function setError(state: IdeWorkspaceState, error: string | undefined): IdeWorkspaceState {
  if (state.error === error) return state
  return { ...state, error }
}

/**
 * Set the tree's filter text.
 * @param state - the workspace before the change.
 * @param query - the filter text.
 * @returns the workspace after the change.
 */
export function setQuery(state: IdeWorkspaceState, query: string): IdeWorkspaceState {
  if (state.query === query) return state
  return { ...state, query }
}

/**
 * Open a file: it joins the tab strip and becomes the active one.
 *
 * Opening a file that is already open re-opens it rather than duplicating the
 * tab: the tab strip is a set of documents, not a history of clicks.
 * @param state - the workspace before the open.
 * @param file - the file to show.
 * @returns the workspace after the open.
 */
export function openFile(state: IdeWorkspaceState, file: IdeFile): IdeWorkspaceState {
  const existing = state.files.find(candidate => candidate.path === file.path)
  // A file that is already open keeps its EDITS: re-reading it must not throw
  // away what the user typed while the tab stayed open.
  const merged: IdeFile = existing?.dirty === true
    ? {
      ...existing,
      name: file.name,
      language: file.language,
      loading: file.loading,
      viewKind: file.viewKind ?? existing.viewKind,
    }
    : file
  const known = existing !== undefined
  const files = known
    ? state.files.map(candidate => (candidate.path === file.path ? merged : candidate))
    : [...state.files, merged]
  return { ...state, files, activePath: file.path }
}

/**
 * Replace one open file's text: the editor's own edit.
 *
 * The text is the editor's own now — the file is dirty until a write lands.
 * @param state - the workspace before the edit.
 * @param path - the edited file's absolute path.
 * @param content - the file's new text.
 * @returns the workspace after the edit.
 */
export function editFile(state: IdeWorkspaceState, path: string, content: string): IdeWorkspaceState {
  let changed = false
  const files = state.files.map(file => {
    if (file.path !== path) return file
    if (file.content === content && file.dirty !== true) return file
    changed = true
    return { ...file, content, dirty: true, conflict: undefined }
  })
  return changed ? { ...state, files } : state
}

/**
 * Mark one file's write as running.
 * @param state - the workspace before the change.
 * @param path - the written file's absolute path.
 * @returns the workspace after the change.
 */
export function markSaving(state: IdeWorkspaceState, path: string): IdeWorkspaceState {
  const files = state.files.map(file => (file.path === path ? { ...file, saving: true } : file))
  return { ...state, files }
}

/**
 * Mark one file's write as landed: the text is on disk and the version moved on.
 * @param state - the workspace before the change.
 * @param path - the written file's absolute path.
 * @param content - the text as the Host stored it.
 * @param version - the file's new version token.
 * @returns the workspace after the change.
 */
export function markSaved(state: IdeWorkspaceState, path: string, content: string, version: string): IdeWorkspaceState {
  const files = state.files.map(file => (file.path === path
    ? { ...file, content, version, dirty: false, saving: false, conflict: undefined }
    : file))
  return { ...state, files }
}

/**
 * Record a refused write: the edits stay in the editor, and the reason is shown.
 * @param state - the workspace before the change.
 * @param path - the written file's absolute path.
 * @param conflict - the refusal's message.
 * @returns the workspace after the change.
 */
export function markConflict(state: IdeWorkspaceState, path: string, conflict: string): IdeWorkspaceState {
  const files = state.files.map(file => (file.path === path
    ? { ...file, saving: false, conflict }
    : file))
  return { ...state, files }
}

/**
 * Close a file.
 *
 * The tab to its left takes over, so closing the active tab leaves the
 * surface showing a neighbour instead of an empty pane while other tabs
 * remain open.
 * @param state - the workspace before the close.
 * @param path - the file to close.
 * @returns the workspace after the close.
 */
export function closeFile(state: IdeWorkspaceState, path: string): IdeWorkspaceState {
  const index = state.files.findIndex(candidate => candidate.path === path)
  if (index < 0) return state
  const files = state.files.filter(candidate => candidate.path !== path)
  if (state.activePath !== path) return { ...state, files }
  const neighbour = files[Math.min(index, files.length - 1)]
  return { ...state, files, activePath: neighbour?.path ?? null }
}

/**
 * Bring an open file to the front.
 * @param state - the workspace before the activation.
 * @param path - the file to activate.
 * @returns the workspace after the activation.
 */
export function activateFile(state: IdeWorkspaceState, path: string): IdeWorkspaceState {
  if (!state.files.some(candidate => candidate.path === path)) return state
  return state.activePath === path ? state : { ...state, activePath: path }
}

/**
 * The file the code surface shows.
 * @param state - the workspace to read.
 * @returns the active file, or undefined while nothing is open.
 */
export function activeFile(state: IdeWorkspaceState): IdeFile | undefined {
  return state.files.find(candidate => candidate.path === state.activePath)
}
