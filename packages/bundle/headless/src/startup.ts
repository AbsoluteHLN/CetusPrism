/**
 * The command-line provider for headless and interactive CetusPrism CLI:
 * it parses the task positional, `-i/--interactive`, `--one-shot`,
 * `--session-id`, `--json`, `--tui`, `--plain`, and `--help`, then publishes
 * {@link HEADLESS_STARTUP_SERVICE}. The runner is an ordinary consumer whose
 * lazy config waits for that service.
 * @module @deepseek-ai/dsh-headless/startup
 */

import { Command, CommanderError } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { boundJsonLine } from './json-stream.ts'
import { internals } from './startup-internals.ts'

/** Stable Cordis plugin name. */
export const name = 'headless-startup'

/** Services required before the task can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the runner. */
export const HEADLESS_STARTUP_SERVICE = 'headlessStartup'

/** What the runner row reads from {@link HEADLESS_STARTUP_SERVICE}. */
export interface HeadlessStartupValues {
  /** The task text this invocation asked for; absent when the runner reads stdin or runs empty interactive REPL. */
  task: string | undefined
  /** Exact Session identity to adopt; absent for a fresh random identity. */
  sessionId: string | undefined
  /** Whether stdout carries the machine-readable event stream instead of final text. */
  json: boolean
  /** Whether the live terminal UI is forced on even for a non-TTY stdout. */
  tui: boolean
  /** Whether the classic plain output is forced even on a TTY stdout. */
  plain: boolean
  /** Whether to run an interactive persistent CLI session. */
  interactive: boolean
  /** Whether one-shot mode is forced. */
  oneShot: boolean
}

/**
 * This app's command: the task positional, its options, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function headlessCommand(): Command {
  return new Command()
    .name('dsh --profile headless')
    .description('Answer one task and exit; on a terminal the run renders as a live UI.')
    .helpOption('-h, --help', 'show this help')
    .option('-i, --interactive', 'run interactive persistent CLI session')
    .option('--one-shot', 'run a single task and exit')
    .option('--json', 'write newline-delimited run events to stdout instead of the final message')
    .option('--tui', 'render the live terminal UI even when stdout is not a terminal')
    .option('--plain', 'print the classic plain output (reasoning on stderr, answer on stdout)')
    .option('--session-id <id>', 'adopt the persisted Session with this id; an unknown id is an error')
    .argument('[task...]', 'the task text; multiple words are joined by spaces, and `-` reads stdin')
    .addHelpText('after', `
Examples:
  dsh tui                                         launch persistent interactive CLI
  dsh tui -i "run the tests"                      execute initial task and continue in interactive CLI
  dsh --profile headless "run the tests"          answer one task and exit
  dsh --profile headless --plain "run the tests"  classic output: reasoning on stderr
  echo "run the tests" | dsh --profile headless   read the task from stdin (one-shot)
  dsh --profile headless --json "run the tests"   emit machine-readable run events
  dsh --profile headless --session-id session-…   resume an existing Session
`)
}

/**
 * Whether the raw invocation asks for the machine-readable stream. The scan
 * stops at `--` and skips a `--session-id` value, so a literal `--json` used as
 * an option value or a positional never installs the JSON error override.
 * @param argv - the invocation's raw arguments.
 * @returns whether `--json` is a real flag of this invocation.
 */
function jsonRequested(argv: readonly string[]): boolean {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') return false
    if (argument === '--json') return true
    if (argument === '--session-id') index += 1
  }
  return false
}

/**
 * Parse and provide the task and mode options as an ordinary Cordis service.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = headlessCommand()
  // The raw snapshot decides the JSON contract: Commander rejects a grammar
  // error (an unknown option, a missing option value) before the action runs,
  // and such a rejection still owes a --json caller the error event.
  if (jsonRequested(ctx.get('cmdlineArgs')?.get() ?? [])) {
    program.error = (message: string, errorOptions?: Parameters<Command['error']>[1]): never => {
      // The event message matches the runner's runtime errors, which carry no
      // commander `error: ` prefix.
      const payload = boundJsonLine({ type: 'error', message: message.replace(/^error: /, '') })
      internals.stdout.write(`${payload}\n`)
      // The JSON contract keeps stderr to `dsh:` diagnostics, so commander's
      // own print of this message must not run; throwing the same control-flow
      // error still leaves through the launcher's exit path.
      throw new CommanderError(1, errorOptions?.code ?? 'commander.error', message)
    }
  }
  program.action(() => {
    const options = program.opts<{
      json?: boolean
      tui?: boolean
      plain?: boolean
      sessionId?: string
      interactive?: boolean
      oneShot?: boolean
    }>()

    if (options.json === true && options.interactive === true) {
      program.error('error: --json and --interactive are mutually exclusive')
    }
    if (options.oneShot === true && options.interactive === true) {
      program.error('error: --one-shot and --interactive are mutually exclusive')
    }
    if (options.json === true && options.tui === true) {
      program.error('error: --json and --tui are mutually exclusive; pick one stdout contract')
    }

    if (program.args.length > 1 && program.args.includes('-')) {
      program.error('error: `-` must be the only task argument')
    }
    const joined = program.args.join(' ')
    if (program.args.length > 0 && joined.trim() === '') {
      program.error('error: a task is required, for example: dsh --profile headless "run the tests"')
    }
    const task = program.args.length === 0 ? undefined : joined

    const oneShot = options.oneShot === true
    const isTty = internals.stdinIsTty()
    const interactive = options.interactive === true || (!oneShot && options.json !== true && isTty && task === undefined)

    if (task === undefined && !interactive && isTty) {
      program.error('error: a task is required, for example: dsh --profile headless "run the tests"')
    }

    // A SessionId is opaque, so whitespace is part of the identity: validate
    // emptiness on the trimmed value but hand the runner the exact string.
    const sessionId = options.sessionId
    if (sessionId !== undefined && sessionId.trim() === '') {
      program.error('error: --session-id requires a non-empty session id')
    }

    ctx.provide(HEADLESS_STARTUP_SERVICE, {
      task,
      sessionId,
      json: options.json === true,
      tui: options.tui === true,
      plain: options.plain === true,
      interactive,
      oneShot,
    } satisfies HeadlessStartupValues)
  })
  parseCmdline(ctx, program)
}
