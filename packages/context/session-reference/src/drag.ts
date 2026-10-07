/** Sidebar-to-composer session drag contract, shared by the workspace rows and the composer card. */

import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { formatSessionReferenceMention } from './uri.ts'

/**
 * MIME type marking a dragged session row. The payload is the JSON encoding
 * of {@link SessionDragPayload}; the sidebar writes it beside its plain-text
 * reorder payload and the composer card consumes it on drop.
 */
export const SESSION_DRAG_MIME = 'application/x-dsh-session-ref'

/** What one dragged sidebar session row carries to the composer. */
export interface SessionDragPayload {
  sessionId: SessionIdType
  /** Stored session title; empty for an untitled session. */
  title: string
}

/** Composer chip describing one dropped session (structurally the composer's `ReferenceInsert`). */
export interface SessionReferenceChip {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly appearance: 'session'
  readonly clipboardText: string
}

/**
 * Publish one session row's drag payload.
 * @param dataTransfer - the starting drag's transfer object.
 * @param payload - session identity and display title.
 */
export function writeSessionDrag(dataTransfer: DataTransfer, payload: SessionDragPayload): void {
  dataTransfer.setData(SESSION_DRAG_MIME, JSON.stringify({
    sessionId: payload.sessionId,
    title: payload.title,
  }))
}

/**
 * Read one session drag payload.
 * @param dataTransfer - a drag event's transfer object.
 * @returns the payload, or undefined when the drag carries no session
 * reference (file/OS drags, workspace reorder drags) or a malformed one.
 */
export function readSessionDrag(dataTransfer: DataTransfer): SessionDragPayload | undefined {
  if (!dataTransfer.types.includes(SESSION_DRAG_MIME)) return undefined
  try {
    const parsed: unknown = JSON.parse(dataTransfer.getData(SESSION_DRAG_MIME))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const { sessionId, title } = parsed as Record<string, unknown>
    if (typeof sessionId !== 'string' || sessionId === '' || typeof title !== 'string') return undefined
    return { sessionId: sessionId as SessionIdType, title }
  } catch {
    // JSON.parse of our own MIME payload: a malformed payload is no reference.
    return undefined
  }
}

/**
 * Build the composer chip for one dropped session.
 * @param payload - the dropped session identity and title.
 * @returns the chip; an untitled session mentions under its session id.
 */
export function sessionReferenceChip(payload: SessionDragPayload): SessionReferenceChip {
  const mention = formatSessionReferenceMention({
    sessionId: payload.sessionId,
    ...(payload.title === '' ? {} : { label: payload.title }),
  })
  const label = payload.title === '' ? payload.sessionId : payload.title
  return { source: 'reference', ref: mention, label, appearance: 'session', clipboardText: mention }
}
