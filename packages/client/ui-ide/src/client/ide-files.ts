/**
 * The IDE's file source: the project tree and the file contents, read through
 * the Host's `workspaceFiles` Remote namespace.
 *
 * The namespace is Session-scoped — the same path means different directories
 * in different Sessions — so every call carries the Session the workspace is
 * bound to. Directory listings speak workspace paths and are confined to the
 * Session's workspace root; file reads follow the composed filesystem's read
 * authority and are paged, because a whole file may be larger than one page.
 *
 * @module @deepseek-ai/dsh-client-ui-ide/ide-files
 */

import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: merges the `workspaceFiles.changes` stream into the Remote face.
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { WorkspaceFileWatchFrame } from '@deepseek-ai/dsh-api-workspace-files/types'
import { languageForPath } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { IdeTreeNode } from './ide-model.ts'
import { ideMimeType, ideViewKind, ideViewUsesTextRead } from './ide-view-kind.ts'

/** Lines one read page asks for; the Host caps a page at its configured maximum. */
const PAGE_LINES = 5000

/** Pages one file read walks before it gives up and reports a cut file. */
const MAX_PAGES = 4

/** One file's text, as the IDE reads it. */
export interface IdeFileContent {
  /** The file's text. */
  readonly content: string
  /** Whether the read stopped before the file's last line. */
  readonly truncated: boolean
  /**
   * The file's version token at the read.
   *
   * A write names the version it saw, so a file the Agent rewrote under the
   * editor is never silently overwritten.
   */
  readonly version?: string | undefined
}

/** One file's bytes after a binary read. */
export interface IdeFileBytes {
  /** The complete file bytes for preview. */
  readonly data: Uint8Array
  /** MIME type for a blob URL. */
  readonly mime: string
  /** The file's version token at the read. */
  readonly version?: string | undefined
}

/** One file's text after a write, as the Host stored it. */
export interface IdeFileSave {
  /** The stored text, LF-normalized. */
  readonly content: string
  /** The file's version after the write. */
  readonly version: string
}

/** One notification of a watched directory's observation stream. */
export type IdeFileWatchEvent = 'ready' | 'change'

/**
 * One observation of a watched directory.
 *
 * The Host names the target it observed in its own spelling of the path
 * (`E:\Projects\App\packages`), while the tree spells the same directory
 * with the separators it joined (`E:\Projects\App/packages`). The Host's
 * spelling is what the workspace compares against, so the event carries it.
 */
export interface IdeFileWatchNotice {
  /** What the observation reports. */
  readonly kind: IdeFileWatchEvent
  /**
   * The observed target's absolute path, as the Host spelled it.
   *
   * Absent for `ready`: readiness says the watcher is active, not that
   * something changed.
   */
  readonly absolutePath?: string | undefined
}

/** Where the IDE reads its tree and its files from. */
export interface IdeFilesPort {
  /**
   * List one directory.
   * @param sessionId - the Session whose workspace the directory belongs to.
   * @param path - the directory's absolute path.
   * @param signal - the caller's cancellation.
   * @returns the directory's children.
   */
  readonly list: (
    sessionId: SessionId,
    path: string,
    signal: AbortSignal,
  ) => Promise<readonly IdeTreeNode[]>
  /**
   * Read one file's text.
   * @param sessionId - the Session whose workspace the file belongs to.
   * @param path - the file's absolute path.
   * @param signal - the caller's cancellation.
   * @returns the file's text, whether the read was cut short, and its version.
   */
  readonly read: (
    sessionId: SessionId,
    path: string,
    signal: AbortSignal,
  ) => Promise<IdeFileContent>
  /**
   * Read one file's bytes for preview.
   * @param sessionId - the Session whose workspace the file belongs to.
   * @param path - the file's absolute path.
   * @param signal - the caller's cancellation.
   * @returns the file bytes and MIME type.
   */
  readonly readBytes?: (
    sessionId: SessionId,
    path: string,
    signal: AbortSignal,
  ) => Promise<IdeFileBytes>
  /**
   * Write one file's text back to disk.
   * @param sessionId - the Session whose workspace the file belongs to.
   * @param path - the file's absolute path.
   * @param content - the complete new file content.
   * @param expectedVersion - the version the caller read; the write is refused when the file moved on.
   * @param signal - the caller's cancellation.
   * @returns the stored text and the file's new version.
   */
  readonly write: (
    sessionId: SessionId,
    path: string,
    content: string,
    expectedVersion: string | undefined,
    signal: AbortSignal,
  ) => Promise<IdeFileSave>
  /**
   * Observe one directory, without watching its descendants, until the signal
   * ends the watch.
   *
   * The watch is what keeps the tree honest while the Agent works in the same
   * workspace: every observation means the directory's children may have moved
   * on, and the workspace re-lists the level they were read at. The stream is
   * supervised, so a dropped connection is reconnected underneath; the verb is
   * optional because a file source without observation support still serves
   * the tree, just refreshed by hand.
   * @param sessionId - the Session whose workspace the directory belongs to.
   * @param path - the directory's absolute path.
   * @param signal - the watcher's lifetime; ending it disposes the stream.
   * @returns `ready` once the Host initialized the watcher, then one notice per observation.
   */
  readonly watch?: (
    sessionId: SessionId,
    path: string,
    signal: AbortSignal,
  ) => AsyncIterable<IdeFileWatchNotice>
}

/**
 * The slice of the Client Remote face this package calls: the `workspaceFiles`
 * namespace's `list`, `read`, `write` and `changes`, exactly as the Host's
 * generated client declares them, and the stream supervisor the watch rides.
 */
export interface IdeFilesRemote {
  /**
   * Create one reconnecting stream, exactly as the Client Remote declares it.
   * @param options - opener and end classification.
   * @returns the supervised stream, unstarted until iterated.
   */
  readonly $stream: ClientRemote['$stream']
  /** The `workspaceFiles` namespace. */
  readonly workspaceFiles: Pick<ClientRemote['workspaceFiles'], 'list' | 'read' | 'readBytes' | 'write' | 'changes'>
}

/** Re-export for workspace routing. */
export { ideViewKind, ideViewUsesTextRead }

/**
 * The absolute path of one child entry.
 *
 * Joined with `/` whatever the parent's separators: the Host resolves mixed
 * separators, and the tree only needs a stable key.
 * @param parent - absolute path of the listed directory.
 * @param name - the entry's basename.
 * @returns the child's absolute path.
 */
export function childPath(parent: string, name: string): string {
  return `${parent.replace(/[/\\]+$/, '')}/${name}`
}

/**
 * The syntax language of one file, for the code surface.
 * @param path - the file's absolute path.
 * @returns the language id, or an empty string for an unrecognized suffix.
 */
export function ideLanguage(path: string): string {
  return languageForPath(path) ?? ''
}

/**
 * Bind the IDE's file source to one Remote face.
 * @param remote - the Client Remote face carrying the `workspaceFiles` namespace.
 * @returns the port the workspace reads through.
 */
export function createFilesPort(remote: IdeFilesRemote): IdeFilesPort {
  return {
    async list(sessionId, path, signal) {
      const result = await remote.workspaceFiles.list(sessionId, path, signal)
      if (!result.ok) throw new Error(result.error.message)
      return result.value.entries.map(entry => ({
        name: entry.name,
        path: childPath(path, entry.name),
        kind: entry.type === 'directory' ? 'directory' : 'file',
      }))
    },
    async readBytes(sessionId, path, signal) {
      const result = await remote.workspaceFiles.readBytes(sessionId, path, {}, signal)
      if (!result.ok) throw new Error(result.error.message)
      return {
        data: result.value.data,
        mime: ideMimeType(path),
        version: result.value.version,
      }
    },
    async read(sessionId, path, signal) {
      const pages: string[] = []
      let offset = 1
      let version: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await remote.workspaceFiles.read(
          sessionId,
          path,
          { offset, limit: PAGE_LINES },
          signal,
        )
        if (!result.ok) throw new Error(result.error.message)
        version ??= result.value.version
        pages.push(result.value.text)
        if (result.value.eof) return { content: pages.join('\n'), truncated: false, version }
        if (result.value.lines === 0) break
        offset += result.value.lines
      }
      return { content: pages.join('\n'), truncated: true, version }
    },
    async write(sessionId, path, content, expectedVersion, signal) {
      const result = await remote.workspaceFiles.write(
        sessionId,
        path,
        content,
        expectedVersion === undefined ? {} : { expectedVersion },
        signal,
      )
      if (!result.ok) throw new Error(result.error.message)
      return { content: result.value.after, version: result.value.version }
    },
    watch(sessionId, path, signal) {
      return (async function* () {
        /* jscpd:ignore-start -- the stream binding deliberately mirrors the
           sidebar Files panel's watch: both ride the same supervised Host
           feed, and a shared helper would couple two client plugins. */
        // A cancelled watch owns no stream: there is nothing to observe with.
        if (signal.aborted) return
        const stream = remote.$stream<WorkspaceFileWatchFrame>({
          name: `directory ${path}`,
          open: lifetime => remote.workspaceFiles.changes(sessionId, path, lifetime),
          ended: () => new Error(`Directory watch ended: ${path}`),
        })
        const abort = (): void => { void stream.dispose() }
        signal.addEventListener('abort', abort, { once: true })
        try {
          for await (const item of stream) {
            if (signal.aborted) return
            if (item.value.kind === 'ready') item.accept()
            // The Host names the target it observed; the workspace compares
            // the open files against that spelling, so it travels with the
            // notice instead of being dropped here.
            yield {
              kind: item.value.kind,
              ...item.value.kind === 'change' ? { absolutePath: item.value.change.absolutePath } : {},
            }
          }
        } finally {
          signal.removeEventListener('abort', abort)
          await stream.dispose()
        }
        /* jscpd:ignore-end */
      })()
    },
  }
}
