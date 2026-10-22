/** Client-safe payloads and event declarations owned by the agent-preset domain. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'


/**
 * One declared preset as a client reads it.
 */
export interface AgentPresetRow {
  /** Stable identifier; also the label's fallback. */
  readonly id: string
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** Why this preset cannot compose a session; absent when it can. */
  readonly broken?: string
}

/** The roster one deployment currently supplies. */
export interface AgentPresetRoster {
  /** Every current declaration, including activation failures. */
  readonly presets: readonly AgentPresetRow[]
}

/**
 * How an execution backend routes models.
 *
 * `cetus` means CetusPrism assembles the provider, model and effort itself.
 * `external-runtime` means the backend owns that choice, so CetusPrism's model
 * catalog does not describe it.
 */
export type AgentBackendModelRouting = 'cetus' | 'external-runtime'

/** What an execution backend can do, as a client reads it. */
export interface AgentBackendCapabilities {
  /** Whether a running turn can be cancelled. */
  readonly cancel: boolean
  /** Whether a finished session can be resumed. */
  readonly resume: boolean
  /** Whether the backend runs its own tools. */
  readonly tools: boolean
  /** Which side owns the provider, model and effort routing. */
  readonly modelRouting: AgentBackendModelRouting
}

/**
 * Whether an execution backend can start a session.
 *
 * `ready` means it can. `unconfigured` means the deployment installed no
 * runtime for it. `incompatible` means a runtime answered but does not match
 * the protocol version CetusPrism speaks.
 */
export type AgentBackendAvailability = 'ready' | 'unconfigured' | 'incompatible'

/**
 * One execution backend as a client reads it.
 *
 * A backend owns the Agent lifecycle, the request scheduling and the tool
 * execution. It is a separate dimension from the preset, which owns the
 * prompt, the tool set and the runtime constraints, and from the model, which
 * owns the provider, model and effort routing.
 */
export interface AgentBackendRow {
  /** Stable backend identity. */
  readonly id: 'dsh' | 'pi' | 'zcode'
  /** Display name of the backend. */
  readonly name: string
  /** Installed runtime version, or `unconfigured` when no runtime answered. */
  readonly version: string
  /** Where the backend runs: CetusPrism itself, or an installed external runtime. */
  readonly source: string
  /** Whether this backend can start a session. */
  readonly availability: AgentBackendAvailability
  /** Why this backend cannot start a session; absent when it can. */
  readonly reason?: string
  /** What this backend can do. */
  readonly capabilities: AgentBackendCapabilities
}

/** The execution backends one deployment offers. */
export interface AgentBackendCatalog {
  /** Every backend, DSH first. */
  readonly backends: readonly AgentBackendRow[]
}

/** One preset's declared composition, rendered for reading. */
export interface AgentPresetDocument {
  /** The preset the composition belongs to. */
  readonly agentPreset: string
  /** The declared child plugin list as entry-list YAML, `!!js` expressions included. */
  readonly content: string
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No declaration supplies the requested identity. */
    'agent-preset/not-found': { readonly agentPreset: string; readonly available: readonly string[] }
    /** The id is unusable, already taken, or its composition cannot be installed. */
    'agent-preset/invalid': { readonly agentPreset: string; readonly reason: string }
    /** The session's conversation has started, so its composition is fixed. */
    'agent-preset/locked': { readonly sessionId: SessionId; readonly agentPreset: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentPreset: string | null
  }
  interface SessionProjectionMap {
    /** Preset the Session runs, or null when the deployment composes none. */
    agentPreset: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One session committed a different agent preset to its durable log.
     * Consumers invalidate only state derived from that session's composition.
     * @mode emit
     * @param sessionId - the session whose composition changed.
     * @param agentPreset - the preset recorded by the committed selection.
     */
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}

export {}
