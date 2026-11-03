/**
 * Child-process transport shared by the external-runtime adapters.
 *
 * Framing follows both upstreams' contract: strict JSONL/NDJSON, one complete
 * JSON object per record terminated by LF, an optional preceding CR stripped.
 * Records are split on LF only — Unicode line and paragraph separators are
 * valid inside JSON strings, which is why `node:readline` is unsuitable here.
 */

import { spawn, type ChildProcess } from 'node:child_process'

/** The duplex child a runtime adapter drives. */
export interface RuntimeTransport {
  /** Send one serialized protocol record, LF-terminated. */
  write(record: string): void
  /** Stop the runtime: close stdin, wait for exit, kill past the grace. */
  stop(graceMs?: number): Promise<void>
  /** Whether the child has exited. */
  readonly exited: boolean
}

/** Options for opening one runtime transport. */
export interface RuntimeTransportOptions {
  /** The executable to spawn; defaults to the upstream command. */
  command: string
  /** Arguments putting the executable into its stdio protocol mode. */
  args: readonly string[]
  /** Extra environment for the runtime process. */
  env?: Record<string, string>
  /** Streaming sink for the runtime's stderr diagnostics. */
  onDiagnostics?: (chunk: string) => void
}

/**
 * Open one runtime child process.
 *
 * Windows resolves npm-distributed runtimes to .cmd shims, which Node refuses
 * to spawn without a shell (EINVAL); the shell fallback carries no new trust
 * level because the command is the operator-configured runtime either way.
 * @param options - the executable, its protocol arguments and environment.
 * @param onLine - one callback per complete protocol record, CR-stripped.
 * @param onExit - one callback when the child exits.
 * @param onError - one callback when the child or its stdin reports a failure
 * that prevents further protocol traffic (spawn ENOENT, EPIPE).
 * @returns the opened transport.
 */
export function openRuntimeTransport(
  options: RuntimeTransportOptions,
  onLine: (line: string) => void,
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void,
  onError?: (error: Error) => void,
): RuntimeTransport {
  const child = spawnRuntime(options)
  let buffer = ''
  let exited = false
  child.on('error', (error) => { onError?.(error) })
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (line.length > 0) onLine(line)
      index = buffer.indexOf('\n')
    }
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => { options.onDiagnostics?.(chunk) })
  child.stdin?.on('error', (error) => { onError?.(error) })
  child.on('exit', (code, signal) => {
    exited = true
    onExit(code, signal)
  })
  return {
    write(record: string): void {
      child.stdin?.write(record.endsWith('\n') ? record : `${record}\n`)
    },
    stop(graceMs = 1500): Promise<void> {
      if (exited) return Promise.resolve()
      return new Promise((resolve) => {
        const timer = setTimeout(() => { child.kill('SIGKILL') }, graceMs)
        timer.unref?.()
        child.once('exit', () => { clearTimeout(timer); resolve() })
        child.stdin?.end()
      })
    },
    get exited(): boolean { return exited },
  }
}

function spawnRuntime(options: RuntimeTransportOptions): ChildProcess {
  const env = { ...process.env, ...options.env }
  const stdio: ['pipe', 'pipe', 'pipe'] = ['pipe', 'pipe', 'pipe']
  const child = spawn(options.command, [...options.args], { env, stdio })
  if (child.pid !== undefined || process.platform !== 'win32') return child
  // Windows .cmd shim (EINVAL): the discarded child reports its launch error
  // asynchronously, so swallow it and route the same command through cmd.exe.
  child.on('error', () => {})
  return spawn('cmd.exe', ['/c', options.command, ...options.args], { env, stdio })
}

/**
 * Correlate outstanding protocol requests.
 * @typeParam T - the resolved result shape.
 */
export class RuntimeRequests<T = unknown> {
  private readonly pending = new Map<string, { resolve(value: T): void; reject(error: Error): void }>()
  private nextId = 1

  /**
   * Reserve the next correlation id for one outbound record.
   * @returns a fresh correlation id.
   */
  allocate(): string {
    return `dsh-${this.nextId++}`
  }

  /**
   * Register one outstanding request under its correlation id.
   * @param id - the correlation id the runtime repeats in its response.
   * @param resolve - settles the caller's promise with the response payload.
   * @param reject - rejects the caller's promise when the runtime fails it.
   */
  track(id: string, resolve: (value: T) => void, reject: (error: Error) => void): void {
    this.pending.set(id, { resolve, reject })
  }

  /**
   * Settle one request whose response arrived.
   * @param id - the correlation id.
   * @param settle - resolves or rejects the caller's promise.
   * @returns whether the id was outstanding.
   */
  settle(id: string, settle: (resolve: (value: T) => void, reject: (error: Error) => void) => void): boolean {
    const entry = this.pending.get(id)
    if (entry === undefined) return false
    this.pending.delete(id)
    settle(entry.resolve, entry.reject)
    return true
  }

  /**
   * Reject every outstanding request because the runtime went away.
   * @param error - the failure every waiting caller receives.
   */
  failAll(error: Error): void {
    for (const id of [...this.pending.keys()]) {
      const entry = this.pending.get(id)
      if (entry === undefined) continue
      this.pending.delete(id)
      entry.reject(error)
    }
  }

  /**
   * How many requests are still waiting for a response.
   * @returns the outstanding request count.
   */
  get size(): number { return this.pending.size }
}
