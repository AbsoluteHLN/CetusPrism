/**
 * The Pi external-runtime adapter: `pi --mode rpc --no-session` over JSONL.
 *
 * Envelope (upstream protocol: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md):
 * a command is one JSON object `{"id":"req-1","type":"<command>",...params}`;
 * its response repeats the id with `type:"response"`, `success`, and `data`
 * or `error`. Session events carry no id and use the upstream event
 * vocabulary (https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md).
 * The envelope difference from the normalized protocol lives entirely in
 * this adapter.
 */

import { awaitRuntimeIdle, EXTERNAL_RUNTIME_UPSTREAMS, raceAbortSignal, runtimeAbortError, type ExternalRuntimeAdapter, type ExternalRuntimeCapabilities, type ExternalRuntimeEvent } from './external-runtime.ts'
import { openRuntimeTransport, RuntimeRequests, type RuntimeTransport } from './external-runtime-transport.ts'

/** Construction options for the Pi adapter. */
export interface PiRuntimeAdapterOptions {
  /** An explicit executable; defaults to the upstream command. */
  readonly command?: string
  /** Protocol-mode arguments; defaults to the upstream's own entry points. */
  readonly args?: readonly string[]
  /** An explicit version, from the probe that admitted this runtime. */
  readonly version?: string
  /** Extra environment for the runtime process. */
  readonly env?: Record<string, string>
  /** Streaming sink for Pi's stderr diagnostics. */
  readonly onDiagnostics?: (chunk: string) => void
  /** Upper bound for one protocol response; defaults to 30 seconds. */
  readonly requestTimeoutMs?: number
}

/** Default response bound for one protocol request. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** One Pi RPC record as it arrives on stdout. */
type PiRecord = Record<string, unknown>

/** The events Pi emits that this adapter forwards; the rest stay Pi-internal. */
const NOTICE_EVENTS: Record<string, { level: 'info' | 'warn' | 'error'; describe: (record: Record<string, unknown>) => string }> = {
  auto_retry_start: { level: 'warn', describe: record => `Pi auto-retry ${String(record.attempt ?? '?')}/${String(record.maxAttempts ?? '?')} in ${String(record.delayMs ?? '?')}ms: ${String(record.errorMessage ?? '')}` },
  auto_retry_end: { level: 'info', describe: record => `Pi auto-retry finished (attempt ${String(record.attempt ?? '?')}, ${record.success === true ? 'succeeded' : 'failed'})` },
  compaction_start: { level: 'info', describe: record => `Pi compaction started (${String(record.reason ?? 'unknown')})` },
  extension_error: { level: 'error', describe: record => `Pi extension error in ${String(record.extensionPath ?? 'unknown')}: ${String(record.error ?? '')}` },
}

/** The ONE adapter every Pi stdio runtime is driven through. */
export class PiRuntimeAdapter implements ExternalRuntimeAdapter {
  readonly runtimeId = 'pi' as const
  readonly runtimeVersion: string
  private readonly options: PiRuntimeAdapterOptions
  private transport: RuntimeTransport | undefined
  private readonly requests = new RuntimeRequests<unknown>()
  private readonly listeners = new Set<(event: ExternalRuntimeEvent) => void>()

  constructor(options: PiRuntimeAdapterOptions = {}) {
    this.options = options
    this.runtimeVersion = options.version ?? EXTERNAL_RUNTIME_UPSTREAMS.pi.minVersion
  }

  /** @inheritdoc */
  capabilities(): ExternalRuntimeCapabilities {
    return { streaming: true, steering: true, followUp: true, hostPermission: false, hostUserInput: false, hostSideToolExecution: false }
  }

  /** @inheritdoc */
  start(): Promise<void> {
    if (this.transport !== undefined) return Promise.resolve()
    const upstream = EXTERNAL_RUNTIME_UPSTREAMS.pi
    return new Promise((resolve, reject) => {
      const transport = openRuntimeTransport(
        {
          command: this.options.command ?? upstream.command,
          args: this.options.args ?? upstream.args,
          ...(this.options.env === undefined ? {} : { env: this.options.env }),
          ...(this.options.onDiagnostics === undefined ? {} : { onDiagnostics: this.options.onDiagnostics }),
        },
        line => this.onRecord(line),
        () => this.onExit(),
        error => this.onTransportError(error),
      )
      this.transport = transport
      // No handshake exists: capability probing replaces it, so start resolves
      // once the process is up and answers its first get_state.
      transport.write(`${JSON.stringify({ id: 'dsh-start', type: 'get_state' })}\n`)
      const probeTimeout = setTimeout(() => {
        this.transport = undefined
        this.requests.settle('dsh-start', (_resolve, reject) => {
          reject(new Error('Pi runtime did not answer get_state after start'))
        })
        void transport.stop()
      }, 10_000)
      probeTimeout.unref?.()
      this.requests.track('dsh-start', () => { clearTimeout(probeTimeout); resolve() }, (error) => { clearTimeout(probeTimeout); reject(error) })
    })
  }

  /** @inheritdoc */
  stop(): Promise<void> {
    const transport = this.transport
    if (transport === undefined) return Promise.resolve()
    this.transport = undefined
    // Detaching first keeps onExit from reporting an unexpected crash; the
    // pending requests must still settle, or every caller awaits forever.
    this.requests.failAll(new Error('Pi runtime stopped'))
    return transport.stop()
  }

  /** @inheritdoc */
  request(method: string, params?: unknown): Promise<unknown> {
    const transport = this.transport
    if (transport === undefined) return Promise.reject(new Error('Pi runtime is not running'))
    const id = this.requests.allocate()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requests.settle(id, (_resolve, fail) => {
          fail(new Error(`Pi command "${method}" did not answer within ${this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS}ms`))
        })
      }, this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
      timeout.unref?.()
      this.requests.track(id, (value) => { clearTimeout(timeout); resolve(value) }, (error) => { clearTimeout(timeout); reject(error) })
      const record: Record<string, unknown> = { id, type: method }
      if (params !== undefined && typeof params === 'object' && params !== null) {
        Object.assign(record, params as Record<string, unknown>)
      }
      transport.write(`${JSON.stringify(record)}\n`)
    })
  }

  /** @inheritdoc */
  subscribe(listener: (event: ExternalRuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * One user message runs until Pi settles the agent (`agent_settled`).
   * The prompt command itself only acknowledges; completion is an event, so
   * the send and the settle are both raced against the turn signal.
   */
  async runTurn(input: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw runtimeAbortError(signal)
    const settled = this.awaitIdle(signal)
    // Observed up front: when the abort race below wins, `settled` rejects
    // later with the same reason and must never surface as unhandled.
    settled.catch(() => {})
    const sent = this.request('prompt', { message: { role: 'user', content: [{ type: 'text', text: input }], display: true } })
      .catch((error: unknown) => { if (!signal.aborted) throw error })
    await raceAbortSignal(sent, signal)
    await settled
  }

  /** @inheritdoc */
  async abortTurn(): Promise<void> {
    await this.request('interrupt')
  }

  /**
   * Resolve on the next `idle` event; reject on signal abort, on a turn the
   * runtime failed, or when the runtime reports an aborted settle the host did
   * not ask for (a crash or transport loss surfaced as an unexpected settle).
   */
  private awaitIdle(signal: AbortSignal): Promise<void> {
    return awaitRuntimeIdle({ subscribe: listener => this.subscribe(listener), signal, runtimeName: 'Pi' })
  }

  private emit(event: ExternalRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private onRecord(line: string): void {
    let record: PiRecord
    try {
      record = JSON.parse(line) as PiRecord
    } catch {
      this.emit({ type: 'notice', level: 'error', message: `Pi runtime sent a malformed record: ${line.slice(0, 200)}` })
      return
    }
    if (typeof record.id === 'string' && record.type === 'response') {
      const id = record.id
      this.requests.settle(id, (resolve, reject) => {
        if (record.success === true) resolve(record.data)
        else reject(new Error(`Pi command failed: ${String(record.error ?? 'unknown error')}`))
      })
      return
    }
    this.onEvent(record)
  }

  private onEvent(record: Record<string, unknown>): void {
    const type = String(record.type ?? '')
    switch (type) {
      case 'agent_start':
        this.emit({ type: 'run_started' })
        return
      case 'agent_settled': {
        // A settled turn is not a successful one: Pi reports the failure on the
        // settling record, and the driver must be able to tell them apart.
        const failure = record.error === undefined || record.error === null
          ? undefined
          : String(record.error)
        this.emit({ type: 'idle', aborted: record.aborted === true, ...(failure === undefined ? {} : { failure }) })
        return
      }
      case 'message_start':
        this.emit({ type: 'message_started', message: record.message })
        return
      case 'message_end':
        this.emit({ type: 'message_finished', message: record.message })
        return
      case 'message_update': {
        const update = record.assistantMessageEvent as Record<string, unknown> | undefined
        const kind = String(update?.type ?? '')
        if (kind === 'text_delta') {
          this.emit({ type: 'message_delta', delta: String(update?.delta ?? ''), kind: 'text' })
        } else if (kind === 'thinking_delta') {
          this.emit({ type: 'message_delta', delta: String(update?.delta ?? ''), kind: 'thinking' })
        }
        return
      }
      case 'tool_execution_start':
        this.emit({ type: 'tool_started', toolCallId: String(record.toolCallId ?? ''), toolName: String(record.toolName ?? ''), args: record.args })
        return
      case 'tool_execution_end':
        this.emit({ type: 'tool_finished', toolCallId: String(record.toolCallId ?? ''), toolName: String(record.toolName ?? ''), result: record.result, isError: record.isError === true })
        return
      default: {
        const notice = NOTICE_EVENTS[type]
        if (notice === undefined) return
        this.emit({ type: 'notice', level: notice.level, message: notice.describe(record) })
      }
    }
  }

  /** A transport failure prevents further protocol traffic; settle callers. */
  private onTransportError(error: Error): void {
    if (this.transport === undefined) return
    this.transport = undefined
    this.requests.failAll(error)
    this.emit({ type: 'notice', level: 'error', message: `Pi runtime transport failed: ${error.message}` })
  }

  private onExit(): void {
    // A deliberate stop() already detached the transport; only an unexpected
    // exit still reaches this handler with the transport attached.
    if (this.transport === undefined) return
    this.transport = undefined
    this.requests.failAll(new Error('Pi runtime exited with outstanding requests'))
    this.emit({ type: 'idle', aborted: true })
  }
}
