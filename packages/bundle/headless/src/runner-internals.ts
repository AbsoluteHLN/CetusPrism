/**
 * Process streams and terminal facts the runner reads and writes, kept out of
 * the package entry so substituting them in tests adds no public package API.
 * The stream shape matches the runner's own IO carrier structurally.
 * @module @deepseek-ai/dsh-headless/runner-internals
 */

import { createInterface } from 'node:readline/promises'

/** Input contract used by the persistent terminal loop. */
export interface InteractiveInput {
  /** Read one user line, including an empty line. */
  question(prompt: string): Promise<string>
  /** Stop reading and restore the terminal prompt owner. */
  close(): void
}

/** The process streams and terminal facts the runner reads; tests substitute them. */
export const internals: {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  readStdin: () => Promise<string>
  /** Whether stdout is attached to a terminal: the TUI default-mode switch. */
  stdoutIsTty: () => boolean
  /** stdout's current column count, or `undefined` when the terminal reports none. */
  stdoutColumns: () => number | undefined
  /** Whether the `NO_COLOR` environment variable disables ANSI color. */
  noColor: () => boolean
  /** Create the buffered readline surface; tests replace this without opening a terminal. */
  createInteractiveInput: () => InteractiveInput
} = {
  stdout: process.stdout,
  stderr: process.stderr,
  readStdin: async () => {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin as AsyncIterable<Buffer>) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8')
  },
  stdoutIsTty: () => process.stdout.isTTY === true,
  stdoutColumns: () => process.stdout.columns,
  noColor: () => process.env.NO_COLOR !== undefined,
  createInteractiveInput: () => {
    const line = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY === true && process.stdout.isTTY === true,
      crlfDelay: Infinity,
    })
    const pending: string[] = []
    const waiters: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }> = []
    let closed = false
    line.on('line', (value: string) => {
      const waiter = waiters.shift()
      if (waiter === undefined) pending.push(value)
      else waiter.resolve(value)
    })
    line.once('close', () => {
      closed = true
      const error = Object.assign(new Error('readline closed'), { code: 'ERR_USE_AFTER_CLOSE' })
      waiters.splice(0).forEach(waiter => waiter.reject(error))
    })
    return {
      question: (prompt: string): Promise<string> => {
        if (pending.length > 0) {
          process.stdout.write(prompt)
          const value = pending.shift()
          if (value === undefined) throw new Error('interactive input queue changed unexpectedly')
          return Promise.resolve(value)
        }
        if (closed) {
          return Promise.reject(Object.assign(new Error('readline closed'), { code: 'ERR_USE_AFTER_CLOSE' }))
        }
        line.setPrompt(prompt)
        line.prompt()
        return new Promise((resolve, reject) => { waiters.push({ resolve, reject }) })
      },
      close: (): void => { line.close() },
    }
  },
}
