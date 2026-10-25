/**
 * The external-runtime execution backend: ONE mode for every upstream agent.
 *
 * Pi and ZCode are two independent upstreams that CetusPrism does not embed.
 * Each is installed from its own repository, outside this product, and each
 * exposes a line-delimited JSON protocol over stdio:
 *
 *   · Pi     — `pi --mode rpc --no-session` (github.com/earendil-works/pi)
 *   · ZCode  — `zcode app-server --stdio`    (github.com/zai-org/ZCode)
 *
 * Because both speak the same shape — one JSON object per line, requests
 * correlated by id, streaming events as notifications, capability probing
 * instead of a handshake, no auth token because the process boundary IS the
 * trust boundary — they are ONE mode with two adapters, not two modes with
 * two底座. The differences that remain (envelope shape, event vocabulary,
 * terminal signal) live inside the adapters, not in the product.
 *
 * What this module deliberately does NOT do:
 *   · it does not bundle, vendor or repackage either upstream;
 *   · it does not read their accounts, private configuration or storage;
 *   · it does not download them. The operator installs the upstream from its
 *     own repository; CetusPrism only locates it and speaks to it.
 */

import { spawnSync } from 'node:child_process'

/** The upstreams CetusPrism can drive as an external runtime. */
export type ExternalRuntimeId = 'pi' | 'zcode'

/** How an upstream is reached and what it speaks. */
export interface ExternalRuntimeUpstream {
  /** Stable upstream identity. */
  readonly id: ExternalRuntimeId
  /** Display name for the composer and the settings surface. */
  readonly name: string
  /** The upstream's own repository. The runtime comes from THERE. */
  readonly repo: string
  /** The executable that starts the runtime's stdio server. */
  readonly command: string
  /** Arguments that put the executable into its stdio protocol mode. */
  readonly args: readonly string[]
  /** The framing the protocol uses on stdout. */
  readonly framing: 'jsonl' | 'ndjson'
  /** Where the upstream documents its protocol. */
  readonly docs: string
  /**
   * The lowest upstream version this adapter understands.
   *
   * Upstream neither negotiates a version at runtime (both publish the
   * protocol version as a compile-time constant), so the floor is declared
   * here instead of discovered.
   */
  readonly minVersion: string
}

/**
 * The upstreams this build knows, keyed by their stable identity.
 *
 * The command and arguments are the upstream's OWN entry points — CetusPrism
 * does not wrap them in a shim of its own.
 */
export const EXTERNAL_RUNTIME_UPSTREAMS: Readonly<Record<ExternalRuntimeId, ExternalRuntimeUpstream>> = {
  pi: {
    id: 'pi',
    name: 'Pi',
    repo: 'https://github.com/earendil-works/pi',
    command: 'pi',
    args: ['--mode', 'rpc', '--no-session'],
    framing: 'jsonl',
    docs: 'https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md',
    minVersion: '0.74.0',
  },
  zcode: {
    id: 'zcode',
    name: 'ZCode',
    repo: 'https://github.com/zai-org/ZCode',
    command: 'zcode',
    args: ['app-server', '--stdio'],
    framing: 'ndjson',
    docs: 'https://github.com/zai-org/ZCode/blob/main/apps/zcode-cli/docs/design/v2/zcode-protocol-agent-server.md',
    minVersion: '0.1.0',
  },
}

/** A request identity: upstream protocols accept a string or an integer. */
export type RuntimeRequestId = string | number

/** One request the host sends to the runtime. */
export interface RuntimeRequestFrame {
  readonly kind: 'request'
  readonly id: RuntimeRequestId
  readonly method: string
  readonly params?: unknown
}

/** One unsolicited frame the runtime sends to the host. */
export interface RuntimeNotificationFrame {
  readonly kind: 'notification'
  readonly method: string
  readonly params?: unknown
}

/** The successful answer to one request. */
export interface RuntimeResponseFrame {
  readonly kind: 'response'
  readonly id: RuntimeRequestId
  readonly result: unknown
}

/** The failed answer to one request. */
export interface RuntimeErrorFrame {
  readonly kind: 'error'
  readonly id: RuntimeRequestId
  readonly error: { readonly code: number; readonly message: string; readonly data?: unknown }
}

/** Every frame the normalized protocol carries. */
export type RuntimeFrame =
  | RuntimeRequestFrame
  | RuntimeNotificationFrame
  | RuntimeResponseFrame
  | RuntimeErrorFrame

/**
 * Parse one protocol line into a normalized frame.
 *
 * Both upstreams use JSON Lines: one complete JSON object per record,
 * terminated by LF. A record that is not JSON, or whose envelope does not
 * match, is reported as an error frame rather than thrown: a malformed line
 * from the runtime must not take the session down.
 * @param line - one record, without its terminator.
 * @returns the normalized frame, or undefined when the line carries no frame.
 */
export function parseRuntimeFrame(line: string): RuntimeFrame | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return { kind: 'error', id: 'parse-error', error: { code: -32700, message: 'Parse error' } }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { kind: 'error', id: 'invalid-message', error: { code: -32600, message: 'Invalid message' } }
  }
  const record = value as Record<string, unknown>
  const id = record.id
  if (typeof record.method === 'string' && record.method.length > 0) {
    if (id === undefined) return { kind: 'notification', method: record.method, ...(record.params === undefined ? {} : { params: record.params }) }
    return { kind: 'request', id: id as RuntimeRequestId, method: record.method, ...(record.params === undefined ? {} : { params: record.params }) }
  }
  if (id === undefined) return undefined
  if (record.error !== undefined && typeof record.error === 'object' && record.error !== null) {
    const failure = record.error as Record<string, unknown>
    return {
      kind: 'error',
      id: id as RuntimeRequestId,
      error: {
        code: Number(failure.code ?? -32603),
        message: String(failure.message ?? 'Internal error'),
        ...(failure.data === undefined ? {} : { data: failure.data }),
      },
    }
  }
  if (record.result !== undefined) return { kind: 'response', id: id as RuntimeRequestId, result: record.result }
  return { kind: 'error', id: id as RuntimeRequestId, error: { code: -32600, message: 'Invalid message' } }
}

/**
 * Serialize one normalized request into a protocol line.
 * @param frame - the request to write.
 * @returns the line, including its LF terminator.
 */
export function formatRuntimeRequest(frame: RuntimeRequestFrame): string {
  return `${JSON.stringify({ id: frame.id, method: frame.method, ...(frame.params === undefined ? {} : { params: frame.params }) })}\n`
}

/** What a probed upstream reported about itself. */
export interface ExternalRuntimeProbe {
  /** The upstream version, or `unknown` when it did not say. */
  readonly version: string
  /** Where the runtime came from: its repository, or the path it was found at. */
  readonly source: string
  /** Whether CetusPrism can speak to this runtime. */
  readonly compatible: boolean
  /** Why it cannot, when it cannot. */
  readonly reason?: string
}

/** How to find one upstream runtime. */
export interface ExternalRuntimeLocatorOptions {
  /** An explicit executable path; the PATH is searched when this is absent. */
  readonly command?: string
  /** The version that satisfies the upstream's floor. */
  readonly version?: string
  /** Extra environment for the probe process. */
  readonly env?: Record<string, string>
}

/**
 * Compare two dotted version strings.
 * @param left - the first version.
 * @param right - the second version.
 * @returns a negative number, zero or a positive number, like a comparator.
 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value
    .replace(/^v/, '')
    .split(/[.-]/)
    .map(part => Number.parseInt(part, 10))
    .map(part => (Number.isFinite(part) ? part : 0))
  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Ask one executable for its version.
 * @param command - the executable to run.
 * @param env - the environment for the probe.
 * @returns the reported version, or undefined when it did not report one.
 */
function readVersion(command: string, env: Record<string, string>): string | undefined {
  for (const flag of ['--version', 'version']) {
    const result = spawnSync(command, [flag], { encoding: 'utf8', env: { ...process.env, ...env } })
    if (result.error !== undefined || result.status !== 0) continue
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim()
    const match = output.match(/\d+\.\d+\.\d+[^\s]*/)
    if (match !== null) return match[0]
  }
  return undefined
}

/**
 * Locate one installed upstream runtime.
 *
 * The runtime is found, never fetched: the operator installs it from its own
 * repository. A runtime that is not installed stays visible in the catalog
 * with the reason it cannot start, so the composer can explain the gap
 * instead of hiding the option.
 * @param id - the upstream to locate.
 * @param options - an explicit command, and the environment to probe with.
 * @returns what the upstream reported about itself.
 */
export function locateExternalRuntime(
  id: ExternalRuntimeId,
  options: ExternalRuntimeLocatorOptions = {},
): ExternalRuntimeProbe {
  const upstream = EXTERNAL_RUNTIME_UPSTREAMS[id]
  const command = options.command ?? upstream.command
  const env = options.env ?? {}
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8', env: { ...process.env, ...env } })
  if (probe.error !== undefined) {
    const code = (probe.error as NodeJS.ErrnoException).code
    const reason = code === 'ENOENT'
      ? `${upstream.name} runtime is not installed (${command} not found); install it from ${upstream.repo}`
      : `${upstream.name} runtime could not be probed: ${String(probe.error.message || probe.error)}`
    return { version: 'unknown', source: upstream.repo, compatible: false, reason }
  }
  const version = options.version ?? readVersion(command, env)
  if (version === undefined) {
    return {
      version: 'unknown',
      source: upstream.repo,
      compatible: false,
      reason: `${upstream.name} runtime did not report a version`,
    }
  }
  if (compareVersions(version, upstream.minVersion) < 0) {
    return {
      version,
      source: upstream.repo,
      compatible: false,
      reason: `${upstream.name} runtime ${version} is older than the supported floor ${upstream.minVersion}`,
    }
  }
  return { version, source: upstream.repo, compatible: true }
}

/** The capabilities a runtime reported, normalized. */
export interface ExternalRuntimeCapabilities {
  /** Whether the runtime streams assistant text incrementally. */
  readonly streaming: boolean
  /** Whether the host may interrupt a running turn. */
  readonly steering: boolean
  /** Whether the host may queue a follow-up for a running turn. */
  readonly followUp: boolean
  /** Whether the runtime asks the host to confirm a tool call. */
  readonly hostPermission: boolean
  /** Whether the runtime asks the host for user input. */
  readonly hostUserInput: boolean
  /**
   * Whether tools execute in the HOST.
   *
   * False means the runtime executes its own tools — the honest answer for
   * both upstreams in their stdio mode, and the reason CetusPrism cannot
   * promise its own permission chain for an external runtime.
   */
  readonly hostSideToolExecution: boolean
}

/** The normalized events the host consumes from an external runtime. */
export type ExternalRuntimeEvent =
  | { readonly type: 'run_started' }
  | { readonly type: 'run_ended' }
  | { readonly type: 'idle'; readonly aborted: boolean }
  | { readonly type: 'message_started'; readonly message: unknown }
  | { readonly type: 'message_delta'; readonly delta: string; readonly kind: 'text' | 'thinking' }
  | { readonly type: 'message_finished'; readonly message: unknown }
  | { readonly type: 'tool_started'; readonly toolCallId: string; readonly toolName: string; readonly args: unknown }
  | { readonly type: 'tool_finished'; readonly toolCallId: string; readonly toolName: string; readonly result: unknown; readonly isError: boolean }
  | { readonly type: 'state_changed'; readonly model?: { readonly provider: string; readonly modelId: string } }
  | { readonly type: 'notice'; readonly level: 'info' | 'warn' | 'error'; readonly message: string }

/**
 * The ONE adapter contract every external runtime implements.
 *
 * Both upstreams differ in envelope shape and event vocabulary; the adapters
 * absorb that difference and present this surface. Nothing outside the
 * adapter knows which upstream it is talking to.
 */
export interface ExternalRuntimeAdapter {
  /** Which upstream this adapter drives. */
  readonly runtimeId: ExternalRuntimeId
  /** The upstream version the adapter was built against. */
  readonly runtimeVersion: string
  /** What the runtime reported it can do. */
  capabilities(): ExternalRuntimeCapabilities
  /** Start the runtime process and its stdio protocol. */
  start(): Promise<void>
  /** Stop the runtime process. */
  stop(): Promise<void>
  /** Send one request and await its answer. */
  request(method: string, params?: unknown): Promise<unknown>
  /** Subscribe to the normalized event stream. */
  subscribe(listener: (event: ExternalRuntimeEvent) => void): () => void
}
