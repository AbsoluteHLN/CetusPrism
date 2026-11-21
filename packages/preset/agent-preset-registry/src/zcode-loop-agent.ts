/**
 * Dedicated agent loop driver for the ZCode external runtime.
 *
 * ZCode executes as an app-server subprocess (`zcode app-server --stdio`)
 * driving its own turn execution over the NDJSON ZCode Protocol. The turn
 * bridging and ZCode attribution (`external:zcode`) both come from the base
 * — the base's `messageSource` derives the provider from the adapter's
 * runtime id, and ZCode's protocol has no per-round boundary signal, so the
 * generic one-step-per-run bridging is exact. This subclass exists to give
 * the runtime a named driver, mirroring {@link PiLoopAgent}.
 *
 * @module @deepseek-ai/dsh-agent-preset-registry/zcode-loop-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentDriverFactory, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { BaseExternalAgentDriver, type BaseExternalAgentDriverOptions } from './external-agent-driver.ts'
import type { ExternalRuntimeAdapter } from './external-runtime.ts'

/** Construction options for {@link ZCodeLoopAgent}. */
export interface ZCodeLoopAgentOptions extends BaseExternalAgentDriverOptions<ExternalRuntimeAdapter> {}

/** Alias for {@link ZCodeLoopAgentOptions}. */
export type ZCodeAgentDriverOptions = ZCodeLoopAgentOptions

/**
 * Agent driver dedicated to ZCode's independent loop.
 *
 * Manages the ZCode app-server lifecycle, executes turns via ZCode Protocol
 * sessions, and records streaming text, reasoning, and tool executions
 * into the durable DSH session event stream.
 */
export class ZCodeLoopAgent extends BaseExternalAgentDriver<ExternalRuntimeAdapter> {
  constructor(
    loopCtx: Context,
    id: SessionId,
    options: AgentOptions,
    session: Session,
    driverOptions: ZCodeLoopAgentOptions,
  ) {
    super(loopCtx, id, options, session, driverOptions)
  }
}

/** Alias for {@link ZCodeLoopAgent}. */
export { ZCodeLoopAgent as ZCodeAgentDriver }

/**
 * Create an {@link AgentDriverFactory} backed by the ZCode independent loop.
 *
 * @param adapter - the ZCode runtime adapter instance.
 * @param options - extra options such as notice handlers.
 * @returns driver factory function for `agentLoop.createAgent`.
 */
export function createZCodeLoopDriver(
  adapter: ExternalRuntimeAdapter,
  options?: Omit<ZCodeLoopAgentOptions, 'adapter'>,
): AgentDriverFactory {
  return (loopCtx, id, agentOptions, session) =>
    new ZCodeLoopAgent(loopCtx, id, agentOptions, session, { adapter, ...options })
}
