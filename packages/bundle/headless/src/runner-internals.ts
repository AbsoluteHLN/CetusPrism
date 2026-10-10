/**
 * Process streams and terminal facts the runner reads and writes, kept out of
 * the package entry so substituting them in tests adds no public package API.
 * The stream shape matches the runner's own IO carrier structurally.
 * @module @deepseek-ai/dsh-headless/runner-internals
 */

import * as readline from 'node:readline'

/** The process streams and terminal facts the runner reads; tests substitute them. */
export const internals: {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  stdin: NodeJS.ReadableStream
  readStdin: () => Promise<string>
  /** Whether stdout is attached to a terminal: the TUI default-mode switch. */
  stdoutIsTty: () => boolean
  /** Whether stdin is attached to a terminal. */
  stdinIsTty: () => boolean
  /** stdout's current column count, or `undefined` when the terminal reports none. */
  stdoutColumns: () => number | undefined
  /** Whether the `NO_COLOR` environment variable disables ANSI color. */
  noColor: () => boolean
  /** Create a readline interface; tests substitute it for scripted interactive tests. */
  createInterface: (options: readline.ReadLineOptions) => readline.Interface
} = {
  stdout: process.stdout,
  stderr: process.stderr,
  stdin: process.stdin,
  readStdin: async () => {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin as AsyncIterable<Buffer>) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8')
  },
  stdoutIsTty: () => process.stdout.isTTY === true,
  stdinIsTty: () => process.stdin.isTTY === true,
  stdoutColumns: () => process.stdout.columns,
  noColor: () => process.env.NO_COLOR !== undefined,
  createInterface: (options: readline.ReadLineOptions) => readline.createInterface(options),
}
