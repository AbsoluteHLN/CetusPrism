/** Native built-in agent lifecycle over the existing Agent factory and preset binding. */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentCancelCause } from '@deepseek-ai/dsh-agent'
import type {
  Session,
  SessionEvent,
  SessionId,
  SessionSeq,
  TurnEndReason,
  UserMessage,
} from '@deepseek-ai/dsh-session'
import {
  BUILTIN_AGENT_PROTOCOL_VERSION,
  BuiltinAgentConfigError,
  type BuiltinAgentDeclaration,
} from './builtin-agent.ts'

/** Structured `LlmFailure` facts carried by a durable turn-end error. */
export type BuiltinAgentFailure = Extract<TurnEndReason, { kind: 'error' }>['error']

/** One durable turn boundary observed inside an execution interval. */
export interface BuiltinAgentTurnEnd {
  /** Log position of the `turn/end` event. */
  readonly seq: SessionSeq
  /** Turn number recorded by the Agent loop. */
  readonly turn: number
  /** Durable end reason; merge-extensible for plugin-owned variants. */
  readonly reason: TurnEndReason
}

/** Durable failure recorded by one turn end in the observation interval. */
export interface BuiltinAgentIntervalFailure {
  /** Log position of the failing `turn/end`. */
  readonly seq: SessionSeq
  /** Turn number recorded by the Agent loop. */
  readonly turn: number
  /** Structured provider-neutral failure facts. */
  readonly error: BuiltinAgentFailure
}

/** Live `agent/error` observation made during one execution interval. */
export interface BuiltinAgentLiveError {
  /** Turn at which the Agent loop reported the failure. */
  readonly turn: number
  /** Step at which the Agent loop reported the failure. */
  readonly step: number
  /** Failure facts supplied by the Agent loop, without durable attribution. */
  readonly error: unknown
}

/** Interval-wide Session and live error observation after Agent quiescence. */
export interface BuiltinAgentExecutionResult {
  /** Every durable event appended at or after the execute enqueue position. */
  readonly events: readonly SessionEvent[]
  /** Every `turn/end` in the interval, including cancellations. */
  readonly turnEnds: readonly BuiltinAgentTurnEnd[]
  /** Durable `turn/end` errors in the interval; other failures are in `liveErrors`. */
  readonly failures: readonly BuiltinAgentIntervalFailure[]
  /** `agent/error` observations during the interval; the loop owns their structure. */
  readonly liveErrors: readonly BuiltinAgentLiveError[]
}

/** Capability facts a caller can check before creating a native Agent. */
export interface BuiltinAgentCapabilities {
  readonly driver: 'native'
  readonly protocolVersion: typeof BUILTIN_AGENT_PROTOCOL_VERSION
  /** Each prepared adapter owns one newly published Agent and Session. */
  readonly execution: 'fresh-agent'
  /** The caller supplies a registered provider/model route; no declaration route is derived. */
  readonly modelRouting: 'explicit-caller-route'
  /** This adapter does not seed or inherit an existing conversation. */
  readonly contextInheritance: false
  /** Cancellation is whole-agent cancellation, not per-message settlement. */
  readonly cancellation: 'whole-agent'
}

/** Explicit request for one fresh native built-in Agent. */
export interface BuiltinAgentRequest {
  /** Live Agent and Session identity. */
  readonly sessionId: SessionId
  /** Registered model-provider route. */
  readonly provider: string
  /** Model id interpreted by the selected provider adapter. */
  readonly model: string
  /** Optional preset id, copied unchanged to durable metadata and Agent binding. */
  readonly agentPreset?: string
  /** Optional validated workspace directory for the fresh Session. */
  readonly cwd?: string
  /** Optional creation-only cancellation signal. */
  readonly signal?: AbortSignal
}

/** One owned native execution. `execute` may drive exactly one prompt interval. */
export interface PreparedBuiltinAgent {
  readonly capabilities: BuiltinAgentCapabilities
  /** Durable transcript for the Agent and all of its turns. */
  readonly session: Session
  /**
   * Submit the one identified prompt, await whole-agent quiescence, and return
   * the durable Session observation for that interval. The result does not
   * attribute events or endings to that message.
   * @param prompt - complete user message and source.
   * @returns the interval-wide Session observation.
   */
  execute(prompt: UserMessage): Promise<BuiltinAgentExecutionResult>
  /**
   * Cancel active and queued whole-agent work.
   * @param cause - the caller's cancellation intent.
   */
  cancel(cause: AgentCancelCause): void
  /** Resolve after the Agent reaches quiescence, including replacement work. */
  whenIdle(): Promise<void>
  /** Stop, drain, unregister, close the Session, and unwind the Agent scope. */
  dispose(): Promise<void>
}

/**
 * Resolve the driver-specific capabilities of a validated declaration.
 * @param declaration - public declaration already accepted by `defineBuiltinAgent`.
 * @returns the supported native capabilities.
 */
export function resolveBuiltinAgent(declaration: BuiltinAgentDeclaration): BuiltinAgentCapabilities {
  if (!declaration.enabled) throw new BuiltinAgentConfigError(`built-in agent ${declaration.id} is disabled`)
  if (declaration.driver !== 'native') {
    throw new BuiltinAgentConfigError(`built-in agent driver ${declaration.driver} is not available: ${declaration.id}`)
  }
  if (declaration.compatibility.protocolVersion !== BUILTIN_AGENT_PROTOCOL_VERSION) {
    throw new BuiltinAgentConfigError(
      `built-in agent protocol mismatch for ${declaration.id}: expected ${BUILTIN_AGENT_PROTOCOL_VERSION}, received ${declaration.compatibility.protocolVersion}`,
    )
  }
  if (declaration.compatibility.minCetusPrismVersion !== undefined || declaration.compatibility.maxCetusPrismVersion !== undefined) {
    throw new BuiltinAgentConfigError(
      `built-in agent ${declaration.id} declares a CetusPrism version range that this adapter cannot resolve`,
    )
  }
  return {
    driver: 'native',
    protocolVersion: BUILTIN_AGENT_PROTOCOL_VERSION,
    execution: 'fresh-agent',
    modelRouting: 'explicit-caller-route',
    contextInheritance: false,
    cancellation: 'whole-agent',
  }
}

/**
 * Validate a declaration, create one fresh native Agent through `ctx.agents`,
 * and return its single-use send handle. An `agentPreset` is passed unchanged;
 * the optional preset registry is required for that preset, and the fresh Agent
 * joins it during unpublished setup. Headless and SDK callers may instead supply
 * no preset and configure their own system-prompt rows.
 * @param ctx - the caller context that owns the created Agent lifecycle.
 * @param declaration - public built-in agent declaration.
 * @param request - explicit identity, route, and optional composition.
 * @returns the prepared Agent after factory publication settles.
 */
export async function prepareBuiltinAgent(
  ctx: Context,
  declaration: BuiltinAgentDeclaration,
  request: BuiltinAgentRequest,
): Promise<PreparedBuiltinAgent> {
  const capabilities = resolveBuiltinAgent(declaration)
  if (request.signal?.aborted) {
    throw new BuiltinAgentConfigError(`built-in agent ${declaration.id} request was aborted before creation`)
  }
  const agentPreset = request.agentPreset
  const presets = agentPreset === undefined ? undefined : ctx.get('agentPresets')
  if (agentPreset !== undefined && presets === undefined) {
    throw new BuiltinAgentConfigError(
      `built-in agent ${declaration.id} requested preset ${agentPreset}, but no preset registry is mounted`,
    )
  }

  const handle = await ctx.agents.create({
    sessionId: request.sessionId,
    meta: {
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(agentPreset === undefined ? {} : { agentPreset }),
    },
    agentOptions: {
      provider: request.provider,
      model: request.model,
    },
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    setup: async (agentCtx: Context) => {
      if (presets !== undefined) await presets.mount(agentCtx, agentPreset)
    },
  })

  let disposing: Promise<void> | undefined
  let executed = false
  return {
    capabilities,
    session: handle.agent.session,
    async execute(prompt: UserMessage): Promise<BuiltinAgentExecutionResult> {
      if (disposing !== undefined) throw new BuiltinAgentConfigError(`built-in agent ${declaration.id} was disposed before execute`)
      if (executed) throw new BuiltinAgentConfigError(`built-in agent ${declaration.id} already owns an execution`)
      if (ctx.agents.get(request.sessionId) !== handle.agent) {
        throw new BuiltinAgentConfigError(`built-in agent ${declaration.id} is no longer the live Agent`)
      }

      executed = true
      const intervalEvents: SessionEvent[] = []
      const liveErrors: BuiltinAgentLiveError[] = []
      const start = handle.agent.session.seq
      const removeSessionObserver = handle.agent.ctx.on('session/event', (session: Session, event: SessionEvent) => {
        if (session === handle.agent.session && event.seq >= start) intervalEvents.push(event)
      })
      const removeErrorObserver = handle.agent.ctx.on('agent/error', (payload) => {
        if (payload.agent === handle.agent) {
          liveErrors.push({ turn: payload.turn, step: payload.step, error: payload.error })
        }
      })

      try {
        handle.agent.followup(prompt)
        await handle.agent.whenIdle()
      } finally {
        removeSessionObserver()
        removeErrorObserver()
      }

      const turnEnds = intervalEvents.flatMap((event) => {
        if (event.type !== 'turn/end') return []
        return [{ seq: event.seq, turn: event.data.turn, reason: event.data.reason }]
      })
      return {
        events: intervalEvents,
        turnEnds,
        failures: turnEnds.flatMap((turnEnd) => {
          if (turnEnd.reason.kind !== 'error') return []
          return [{ seq: turnEnd.seq, turn: turnEnd.turn, error: turnEnd.reason.error }]
        }),
        liveErrors,
      }
    },
    cancel(cause: AgentCancelCause): void {
      if (disposing === undefined) handle.agent.cancel(cause)
    },
    whenIdle(): Promise<void> {
      if (disposing !== undefined) return disposing
      return handle.agent.whenIdle()
    },
    async dispose(): Promise<void> {
      disposing ??= handle.dispose()
      await disposing
    },
  }
}
