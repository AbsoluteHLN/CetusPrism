/**
 * The ZCode external-runtime adapter: `zcode app-server --stdio` over NDJSON.
 *
 * The wire contract is the ZCode Protocol (apps/zcode-cli/docs/design/v2,
 * schema in packages/shared/src/zcode-protocol): requests `{id, method,
 * params}`, notifications `{method, params}`, responses `{id, result}` and
 * errors `{id, error:{code, message}}` — the normalized envelope
 * `parseRuntimeFrame` already speaks. The adapter's work is the event
 * vocabulary: `model.streaming`, `tool.updated`, `state.updated` and the
 * session-event envelopes, normalized into the shared external-runtime face.
 */

import { EXTERNAL_RUNTIME_UPSTREAMS, parseRuntimeFrame, type ExternalRuntimeAdapter, type ExternalRuntimeCapabilities, type ExternalRuntimeEvent } from './external-runtime.ts'
import { openRuntimeTransport, RuntimeRequests, type RuntimeTransport } from './external-runtime-transport.ts'

/** Construction options for the ZCode adapter. */
export interface ZCodeRuntimeAdapterOptions {
  /** An explicit executable; defaults to the upstream command. */
  readonly command?: string
  /** Protocol-mode arguments; defaults to the upstream's own entry points. */
  readonly args?: readonly string[]
  /** An explicit version, from the probe that admitted this runtime. */
  readonly version?: string
  /** Extra environment for the runtime process. */
  readonly env?: Record<string, string>
  /** Streaming sink for ZCode's stderr diagnostics. */
  readonly onDiagnostics?: (chunk: string) => void
  /** Upper bound for one protocol response; defaults to 30 seconds. */
  readonly requestTimeoutMs?: number
}

/** Default response bound for one protocol request. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/** The capabilities the stdio agent server publishes. */
const ZCODE_CAPABILITIES: ExternalRuntimeCapabilities = {
  streaming: true,
  steering: true,
  followUp: true,
  hostPermission: true,
  hostUserInput: true,
  hostSideToolExecution: false,
}

/** The ONE adapter every ZCode stdio runtime is driven through. */
export class ZCodeRuntimeAdapter implements ExternalRuntimeAdapter {
  readonly runtimeId = 'zcode' as const
  readonly runtimeVersion: string
  private readonly options: ZCodeRuntimeAdapterOptions
  private transport: RuntimeTransport | undefined
  private readonly requests = new RuntimeRequests<unknown>()
  private readonly listeners = new Set<(event: ExternalRuntimeEvent) => void>()
  /** The protocol session this adapter created; undefined until the first turn. */
  private sessionId: string | undefined

  constructor(options: ZCodeRuntimeAdapterOptions = {}) {
    this.options = options
    this.runtimeVersion = options.version ?? EXTERNAL_RUNTIME_UPSTREAMS.zcode.minVersion
  }

  /** @inheritdoc */
  capabilities(): ExternalRuntimeCapabilities {
    return ZCODE_CAPABILITIES
  }

  /** @inheritdoc */
  start(): Promise<void> {
    if (this.transport !== undefined) return Promise.resolve()
    const upstream = EXTERNAL_RUNTIME_UPSTREAMS.zcode
    return new Promise((resolve, reject) => {
      let settled = false
      let guard: NodeJS.Timeout | undefined
      const transport = openRuntimeTransport(
        {
          command: this.options.command ?? upstream.command,
          args: this.options.args ?? upstream.args,
          ...(this.options.env === undefined ? {} : { env: this.options.env }),
          ...(this.options.onDiagnostics === undefined ? {} : { onDiagnostics: this.options.onDiagnostics }),
        },
        line => {
          this.onLine(line)
          // The protocol has no handshake record; the server publishes its
          // startup storage state (or any first protocol record) when ready.
          // The internal line handler runs regardless of subscriber timing.
          if (settled) return
          settled = true
          clearTimeout(guard)
          resolve()
        },
        () => this.onExit(),
        error => this.onTransportError(error),
      )
      this.transport = transport
      guard = setTimeout(() => {
        if (settled) return
        settled = true
        this.transport = undefined
        void transport.stop()
        reject(new Error('ZCode runtime sent no protocol record after start'))
      }, 10_000)
      guard.unref?.()
    })
  }

  /** @inheritdoc */
  stop(): Promise<void> {
    const transport = this.transport
    if (transport === undefined) return Promise.resolve()
    this.transport = undefined
    // Detaching first keeps onExit from reporting an unexpected crash; the
    // pending requests must still settle, or every caller awaits forever.
    this.requests.failAll(new Error('ZCode runtime stopped'))
    return transport.stop()
  }

  /** @inheritdoc */
  request(method: string, params?: unknown): Promise<unknown> {
    const transport = this.transport
    if (transport === undefined) return Promise.reject(new Error('ZCode runtime is not running'))
    const id = this.requests.allocate()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.requests.settle(id, (_resolve, fail) => {
          fail(new Error(`ZCode command "${method}" did not answer within ${this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS}ms`))
        })
      }, this.options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
      timeout.unref?.()
      this.requests.track(id, (value) => { clearTimeout(timeout); resolve(value) }, (error) => { clearTimeout(timeout); reject(error) })
      transport.write(`${JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) })}\n`)
    })
  }

  /** @inheritdoc */
  subscribe(listener: (event: ExternalRuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * One user message runs as one protocol turn: lazily create the agent
   * server's session, send the message, and wait for the turn lifecycle
   * notification (`turn.completed` / `turn.failed`) to reach idle. Both the
   * requests and the settle wait are raced against the turn signal.
   */
  async runTurn(input: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError(signal)
    if (this.sessionId === undefined) {
      const created = await raceAbort(
        this.request('session/create', {}),
        signal,
      ) as unknown
      const sessionId = (created as Record<string, unknown> | null)?.sessionId
      if (typeof sessionId !== 'string' || sessionId === '') {
        throw new Error('ZCode session/create returned no sessionId')
      }
      this.sessionId = sessionId
    }
    const settled = this.awaitIdle(signal)
    // Observed up front: when the abort race below wins, `settled` rejects
    // later with the same reason and must never surface as unhandled.
    settled.catch(() => {})
    const sent = this.request('session/send', { sessionId: this.sessionId, content: input })
      .catch((error: unknown) => { if (!signal.aborted) throw error })
    await raceAbort(sent, signal)
    await settled
  }

  /** @inheritdoc */
  async abortTurn(): Promise<void> {
    if (this.sessionId === undefined) return
    await this.request('session/stop', { sessionId: this.sessionId })
  }

  /**
   * Resolve on the next `idle` event; reject on signal abort or when the
   * runtime reports an aborted settle the host did not ask for.
   */
  private awaitIdle(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribe((event) => {
        if (event.type !== 'idle') return
        unsubscribe()
        signal.removeEventListener('abort', onAbort)
        if (event.aborted && !signal.aborted) {
          reject(new Error('ZCode runtime aborted the turn unexpectedly'))
          return
        }
        resolve()
      })
      const onAbort = (): void => {
        unsubscribe()
        reject(abortError(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private emit(event: ExternalRuntimeEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  private onLine(line: string): void {
    const frame = parseRuntimeFrame(line)
    if (frame === undefined) return
    if (frame.kind === 'error' && frame.id === 'parse-error') {
      this.emit({ type: 'notice', level: 'error', message: `ZCode runtime sent a malformed record: ${line.slice(0, 200)}` })
      return
    }
    if (frame.kind === 'response') {
      this.requests.settle(String(frame.id), resolve => { resolve(frame.result) })
      return
    }
    if (frame.kind === 'error') {
      this.requests.settle(String(frame.id), (_resolve, reject) => {
        reject(new Error(`ZCode request failed (${frame.error.code}): ${frame.error.message}`))
      })
      return
    }
    if (frame.kind === 'request') {
      // Server-to-client requests (interaction/requestPermission,
      // interaction/requestUserInput) have no host consumer yet: answer with a
      // structured refusal rather than leaving the server waiting forever.
      this.transport?.write(`${JSON.stringify({ id: frame.id, error: { code: -32601, message: `host does not implement ${frame.method}` } })}\n`)
      this.emit({ type: 'notice', level: 'warn', message: `ZCode requested ${frame.method}; the host has no interaction surface yet and declined` })
      return
    }
    this.onNotification(frame.method, frame.params)
  }

  private onNotification(method: string, params: unknown): void {
    const payload = (params ?? {}) as Record<string, unknown>
    switch (method) {
      case 'model.streaming':
        this.onModelStreaming(payload)
        return
      case 'tool.updated':
        this.onToolUpdated(payload)
        return
      case 'state.updated': {
        const model = extractModel(payload.patch)
        this.emit({ type: 'state_changed', ...(model === undefined ? {} : { model }) })
        return
      }
      case 'startup/storageState':
        return
      default:
        this.onSessionEvent(method, payload)
    }
  }

  /** `model.streaming` payloads carry the kind vocabulary of the protocol schema. */
  private onModelStreaming(payload: Record<string, unknown>): void {
    switch (payload.kind) {
      case 'text_delta':
        this.emit({ type: 'message_delta', delta: String(payload.delta ?? ''), kind: 'text' })
        return
      case 'reasoning_delta':
        this.emit({ type: 'message_delta', delta: String(payload.delta ?? ''), kind: 'thinking' })
        return
      default:
        return
    }
  }

  /** `tool.updated` kinds: scheduled → started → progress → result | error. */
  private onToolUpdated(payload: Record<string, unknown>): void {
    const toolCallId = String(payload.toolCallId ?? '')
    const toolName = payload.toolName === undefined ? '' : String(payload.toolName)
    switch (payload.kind) {
      case 'started':
        this.emit({ type: 'tool_started', toolCallId, toolName, args: payload.input })
        return
      case 'result':
        this.emit({ type: 'tool_finished', toolCallId, toolName, result: payload.result, isError: false })
        return
      case 'error':
        this.emit({ type: 'tool_finished', toolCallId, toolName, result: payload, isError: true })
        return
      default:
        return
    }
  }

  /** Session-event envelopes arrive as notifications; map the lifecycle ones. */
  private onSessionEvent(type: string, payload: Record<string, unknown>): void {
    switch (type) {
      case 'turn.started':
        this.emit({ type: 'run_started' })
        return
      case 'turn.completed':
        this.emit({ type: 'idle', aborted: payload.resultType === 'cancelled' })
        return
      case 'turn.failed':
        this.emit({ type: 'notice', level: 'error', message: `ZCode turn failed: ${String(payload.resultType ?? 'unknown')}` })
        this.emit({ type: 'idle', aborted: false })
        return
      default:
        return
    }
  }

  /** A transport failure prevents further protocol traffic; settle callers. */
  private onTransportError(error: Error): void {
    if (this.transport === undefined) return
    this.transport = undefined
    this.requests.failAll(error)
    this.emit({ type: 'notice', level: 'error', message: `ZCode runtime transport failed: ${error.message}` })
  }

  private onExit(): void {
    if (this.transport === undefined) return
    this.transport = undefined
    this.requests.failAll(new Error('ZCode runtime exited with outstanding requests'))
    this.emit({ type: 'idle', aborted: true })
  }
}

/** Normalize a signal reason into the Error runTurn rejects with. */
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('turn aborted', { cause: signal.reason })
}

/**
 * Race one promise against turn-signal abort. The promise keeps settling in
 * the background; callers that swallow its late rejection attach their own
 * catch, so an abort never surfaces as an unhandled error.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

/** Pull the model identity out of a state patch, when the patch carries one. */
function extractModel(patch: unknown): { provider: string; modelId: string } | undefined {
  if (typeof patch !== 'object' || patch === null) return undefined
  const model = (patch as Record<string, unknown>).model
  if (typeof model !== 'object' || model === null) return undefined
  const record = model as Record<string, unknown>
  if (typeof record.provider !== 'string' || typeof record.modelId !== 'string') return undefined
  return { provider: record.provider, modelId: record.modelId }
}
