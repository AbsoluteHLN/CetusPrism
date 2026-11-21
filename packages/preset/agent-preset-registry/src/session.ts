/**
 * The session-log record of which preset a session actually runs.
 *
 * The creation header names the preset a session STARTED with, and it is
 * deep-frozen because that is a creation fact. A session may still change
 * preset while it is blank, and the effect of that change outlives the blank
 * window: the first turn — and every turn after it — runs under the newly
 * mounted composition. Recording the change is what keeps the log honest, and
 * it is required outright by the repo's model-visible ⟺ logged rule, since the
 * preset decides the tool schemas and prompt sections the model sees.
 *
 * Reconstruction reads the `agentPreset` Session projection, never the header
 * alone.
 * @module @deepseek-ai/dsh-agent-preset-registry/session
 */

import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's agent preset was chosen after creation, while the session
     * was still blank. Log-only: it records the composition later turns ran
     * under, so a resumed or forked session rebuilds the same one instead of
     * the header's creation-time value.
     */
    'agent-preset/selected': { agentPreset: string }
    /**
     * The session's execution backend was chosen. Log-only: the backend owns
     * the Agent lifecycle and the turn vocabulary, so a resume that restored a
     * different backend would let another driver claim a foreign history. The
     * record is what lets the resume rebuild the very same driver.
     */
    'agent-backend/selected': { agentBackend: string }
  }
}

const agentPresetSchema = z.union([z.string(), z.null()])

/** Current Session preset, initialized from its header and advanced by selection events. */
export const agentPresetProjectionDefinition = {
  key: 'agentPreset',
  stateSchema: agentPresetSchema,
  init: header => header.agentPreset ?? null,
  apply: (state, event) => event.type === 'agent-preset/selected'
    ? event.data.agentPreset
    : state,
  wire: { viewSchema: agentPresetSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'agentPreset', string | null>

const agentBackendSchema = z.union([z.string(), z.null()])

/**
 * Current Session execution backend.
 *
 * The backend is NOT a header field: the header records what a session was
 * born as, while the binding is chosen with the composer and can only be
 * honoured by the driver that was already bound at creation. The log record
 * is therefore the single place the binding lives, and the resume path reads
 * it back through this projection.
 */
export const agentBackendProjectionDefinition = {
  key: 'agentBackend',
  stateSchema: agentBackendSchema,
  init: () => null,
  apply: (state, event) => event.type === 'agent-backend/selected'
    ? event.data.agentBackend
    : state,
  wire: { viewSchema: agentBackendSchema, view: state => state },
  stateVersion: 1,
} satisfies ProjectionDefinition<'agentBackend', string | null>
