/**
 * The Agent driver behind one external execution backend.
 *
 * A backend owns the Agent lifecycle, and an external backend owns it by
 * running its own runtime as a child process. The driver factory produced
 * here is what the session factory binds: it hands the Agent's whole
 * lifecycle to the runtime's own loop, and every turn the runtime runs is
 * translated into the same durable Session vocabulary the native loop writes.
 *
 * The runtime process belongs to the driver: the driver's scope stops it when
 * the session ends, so one session never shares a runtime with another.
 * @module @deepseek-ai/dsh-agent-preset-registry/backend-driver
 */

import type { AgentDriverFactory } from '@deepseek-ai/dsh-agent'
import { EXTERNAL_RUNTIME_UPSTREAMS, type ExternalRuntimeId } from './external-runtime.ts'
import { PiRuntimeAdapter } from './external-runtime-pi.ts'
import { ZCodeRuntimeAdapter } from './external-runtime-zcode.ts'
import { createPiLoopDriver } from './pi-loop-agent.ts'
import { createZCodeLoopDriver } from './zcode-loop-agent.ts'

/** Construction options for one external backend's driver. */
export interface ExternalBackendDriverOptions {
  /** An explicit executable, overriding the upstream's own command. */
  readonly command?: string
  /** The runtime version the probe reported. */
  readonly version?: string
  /** Extra environment for the runtime process. */
  readonly env?: Record<string, string>
}

/**
 * Build the Agent driver factory for one external execution backend.
 *
 * The native backend has no driver factory of its own: omitting the driver
 * builds the factory's default React loop, which is exactly the DSH backend.
 * @param id - the external upstream identity.
 * @param options - an explicit executable, the probed version and the environment.
 * @returns the driver factory the session factory binds.
 */
export function externalBackendDriver(
  id: ExternalRuntimeId,
  options: ExternalBackendDriverOptions = {},
): AgentDriverFactory {
  const upstream = EXTERNAL_RUNTIME_UPSTREAMS[id]
  const shared = {
    ...(options.command === undefined ? {} : { command: options.command }),
    ...(options.version === undefined ? {} : { version: options.version }),
    ...(options.env === undefined ? {} : { env: options.env }),
  }
  if (id === 'pi') {
    return createPiLoopDriver(new PiRuntimeAdapter({ ...shared, args: [...upstream.args] }))
  }
  return createZCodeLoopDriver(new ZCodeRuntimeAdapter({ ...shared, args: [...upstream.args] }))
}
