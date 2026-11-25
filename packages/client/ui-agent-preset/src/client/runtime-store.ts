/**
 * The external runtimes this deployment may point at an executable.
 *
 * Pi and ZCode run the agent on their own runtime. CetusPrism finds that
 * runtime on the PATH by default; an operator who installed it elsewhere
 * names the executable here, and the deployment then probes that one.
 *
 * The catalog is the deployment's own answer: it carries the executable that
 * was probed, whether the deployment named it, and — when the runtime cannot
 * start a session — the reason it cannot. A runtime the deployment pointed
 * at but that is not installed therefore reads as a gap to close, not as a
 * choice to hide.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AgentBackendRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import { readBackendCatalog } from './backend-store.ts'
import { AGENT_PRESET_SETTINGS_NS } from './settings-store.ts'

/** The external runtimes an execution backend can run on. */
export type AgentRuntimeId = 'pi' | 'zcode'

/** One external runtime as the settings section renders it. */
export interface AgentRuntimeOption {
  /** Stable runtime identity. */
  readonly id: AgentRuntimeId
  /** Display name of the runtime. */
  readonly name: string
  /** The executable the deployment probes. */
  readonly command: string
  /** Whether the deployment named that executable itself. */
  readonly configured: boolean
  /** Installed runtime version, or `unconfigured` when no runtime answered. */
  readonly version: string
  /** Whether this runtime can start a session. */
  readonly availability: 'ready' | 'unconfigured' | 'incompatible'
  /** Why it cannot start a session; absent when it can. */
  readonly reason?: string
}

/** The external-runtime settings page state. */
export interface AgentRuntimeState {
  /** The read state; `unavailable` means the host offers no external backend. */
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  /** The read failure, when the host answered with one. */
  error: string | null
  /** The external runtimes, in host order. */
  options: readonly AgentRuntimeOption[]
  /** The runtime a write is in flight for. */
  saving: AgentRuntimeId | null
}

const INITIAL: AgentRuntimeState = {
  status: 'idle', error: null, options: [], saving: null,
}

/**
 * The external runtimes the catalog lists.
 *
 * The native backend is not one of them: it runs inside CetusPrism and has
 * no executable to name.
 * @param backends - the catalog the host answered with.
 * @returns one option per external runtime, in host order.
 */
export function runtimeOptions(backends: readonly AgentBackendRow[]): AgentRuntimeOption[] {
  return backends.flatMap((row) => {
    if (row.id !== 'pi' && row.id !== 'zcode') return []
    return [{
      id: row.id,
      name: row.name,
      command: row.command ?? row.id,
      configured: row.configured === true,
      version: row.version,
      availability: row.availability,
      ...row.reason === undefined ? {} : { reason: row.reason },
    }]
  })
}

/**
 * The controller behind the execution-backend settings section.
 *
 * It reads the catalog the host publishes and writes one runtime's
 * executable back into the deployment's own configuration.
 */
export class AgentRuntimeController {
  /** Page snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentRuntimeState> = createSnapshotStore(INITIAL)

  /** Only the newest catalog read may publish after overlapping refreshes. */
  private loadGeneration = 0

  /**
   * @param ctx - the browser plugin context (the catalog read and the write).
   */
  constructor(private readonly ctx: ClientContext) {}

  private set(patch: Partial<AgentRuntimeState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Read the catalog the host publishes.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    this.set({ status: 'loading', error: null })
    const catalog = await readBackendCatalog(this.ctx)
    if (generation !== this.loadGeneration) return
    if (!catalog.ok) {
      this.set({ status: 'error', error: catalog.error })
      return
    }
    const options = runtimeOptions(catalog.value.backends)
    if (options.length === 0) {
      this.set({ status: 'unavailable', options: [] })
      return
    }
    this.set({ status: 'ready', error: null, options })
  }

  /**
   * Point one runtime at an executable.
   *
   * An empty command clears the deployment's own choice and puts the
   * upstream's command back on the PATH. The write lands in the deployment's
   * own configuration, so the host re-probes the runtime that names it.
   * @param id - the runtime to point.
   * @param command - the executable, or an empty string to clear the choice.
   * @returns the failure message, or undefined once the write landed.
   */
  async save(id: AgentRuntimeId, command: string): Promise<string | undefined> {
    this.set({ saving: id, error: null })
    const runtimes: Partial<Record<AgentRuntimeId, string>> = {}
    runtimes[id] = command.trim()
    try {
      const response = await this.ctx.remote.settings.update(AGENT_PRESET_SETTINGS_NS, {
        externalRuntimes: runtimes,
      }, undefined)
      if (!response.ok) {
        const message = response.error.message
        this.set({ saving: null, error: message })
        return message
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.set({ saving: null, error: message })
      return message
    }
    this.set({ saving: null, error: null })
    return undefined
  }
}
