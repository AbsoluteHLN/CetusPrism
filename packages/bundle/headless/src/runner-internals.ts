/**
 * Process streams and terminal facts the runner reads and writes, kept out of
 * the package entry so substituting them in tests adds no public package API.
 * The stream shape matches the runner's own IO carrier structurally.
 * @module @deepseek-ai/dsh-headless/runner-internals
 */

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
}
