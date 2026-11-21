/**
 * Dedicated agent loop driver for the Pi external runtime.
 *
 * Pi executes as an external agent subprocess (`pi --mode rpc`) driving its
 * own model and tool turns. The turn bridging lives in
 * {@link BaseExternalAgentDriver}; this subclass contributes Pi's one
 * runtime-specific behavior: a running turn is steered live over Pi's RPC
 * channel (`steer` command) in addition to the scheduled inbox delivery.
 *
 * @module @deepseek-ai/dsh-agent-preset-registry/pi-loop-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentDriverFactory, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { BaseExternalAgentDriver, extractText, type BaseExternalAgentDriverOptions } from './external-agent-driver.ts'
import type { ExternalRuntimeAdapter } from './external-runtime.ts'

/** Construction options for {@link PiLoopAgent}. */
export interface PiLoopAgentOptions extends BaseExternalAgentDriverOptions<ExternalRuntimeAdapter> {}

/** Alias for {@link PiLoopAgentOptions}. */
export type PiAgentDriverOptions = PiLoopAgentOptions

/**
 * Agent driver dedicated to Pi's independent loop.
 *
 * Manages the Pi subprocess lifecycle, drives its JSONL RPC protocol, and
 * projects multi-round message sequences into durable DSH session events.
 */
export class PiLoopAgent extends BaseExternalAgentDriver<ExternalRuntimeAdapter> {
  constructor(
    loopCtx: Context,
    id: SessionId,
    options: AgentOptions,
    session: Session,
    driverOptions: PiLoopAgentOptions,
  ) {
    super(loopCtx, id, options, session, driverOptions)
  }

  /**
   * Steer a running or queued Pi turn.
   *
   * In addition to scheduling on the inbox, an active Pi process receives a
   * live `steer` command over its RPC channel so mid-flight execution can be
   * guided immediately.
   */
  override steer(input: UserMessage): void {
    // Sample before super.steer: its wake is synchronous, so a post-call
    // status would read "running" for a turn that has not started yet.
    const running = this.status === 'running'
    super.steer(input)
    if (running) {
      try {
        const text = extractText(input)
        void this.driverOptions.adapter.request('steer', { message: text }).catch(() => {})
      } catch {
        // Fall back to queued inbox execution if message extraction fails.
      }
    }
  }
}

/** Alias for {@link PiLoopAgent}. */
export { PiLoopAgent as PiAgentDriver }

/**
 * Create an {@link AgentDriverFactory} backed by the Pi independent loop.
 *
 * @param adapter - the Pi runtime adapter instance.
 * @param options - extra options such as notice handlers.
 * @returns driver factory function for `agentLoop.createAgent`.
 */
export function createPiLoopDriver(
  adapter: ExternalRuntimeAdapter,
  options?: Omit<PiLoopAgentOptions, 'adapter'>,
): AgentDriverFactory {
  return (loopCtx, id, agentOptions, session) =>
    new PiLoopAgent(loopCtx, id, agentOptions, session, { adapter, ...options })
}
