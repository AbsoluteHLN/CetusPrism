/**
 * The headless app's command-line provider: it parses the task positional,
 * `--session-id`/`--resume`, `--interactive`, `--json`, `--tui`, `--plain`,
 * and `--help`, then publishes {@link HEADLESS_STARTUP_SERVICE}. The runner
 * is an ordinary consumer whose lazy config waits for that service.
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

/** Service provided by this plugin and injected by the one-shot runner. */
export const HEADLESS_STARTUP_SERVICE = 'headlessStartup'

/** What the runner row reads from {@link HEADLESS_STARTUP_SERVICE}. */
export interface HeadlessStartupValues {
  /** The task text this invocation asked for; absent when the runner reads stdin. */
  task: string | undefined
  /** Exact Session identity to adopt; absent for a fresh random identity. */
  sessionId: string | undefined
  /** Keep the terminal open for multiple prompts and allow session commands. */
  interactive: boolean
  /** Whether stdout carries the machine-readable event stream instead of final text. */
  json: boolean
  /** Whether the live terminal UI is forced on even for a non-TTY stdout. */
  tui: boolean
  /** Whether the classic plain output is forced even on a TTY stdout. */
  plain: boolean
}

/**
 * This app's command: the task positional, its options, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function headlessCommand(profileName = 'headless'): Command {
  return new Command()
    .name(`dsh --profile ${profileName}`)
    .description('Answer tasks; use interactive mode for a persistent terminal session.')
    .helpOption('-h, --help', 'show this help')
    .option('--json', 'write newline-delimited run events to stdout instead of the final message')
    .option('--tui', 'render the live terminal UI even when stdout is not a terminal')
    .option('--plain', 'print the classic plain output (reasoning on stderr, answer on stdout)')
    .option('--session-id <id>', 'adopt the persisted Session with this id; an unknown id is an error')
    .option('--resume <id>', 'alias for --session-id; resume this persisted Session in interactive mode')
    .option('--interactive', 'keep the terminal open and accept more prompts after each turn')
    .argument('[task...]', 'the task text; multiple words are joined by spaces, and `-` reads stdin')
    .addHelpText('after', `
Examples:
  dsh --profile headless "run the tests"          live terminal UI on a terminal
  dsh --profile headless --plain "run the tests"  classic output: reasoning on stderr
  echo "run the tests" | dsh --profile headless   read the task from stdin
  dsh --profile headless --json "run the tests"   emit machine-readable run events
  dsh --profile headless --interactive             persistent TUI prompt loop
  dsh --profile tui --resume session-…            resume a persistent TUI session
`)
}

/**
 * Whether the raw invocation asks for the machine-readable stream. The scan
 * stops at `--` and skips a session-id/resume value, so a literal `--json` used as
 * an option value or a positional never installs the JSON error override.
 * @param argv - the invocation's raw arguments.
 * @returns whether `--json` is a real flag of this invocation.
 */
function jsonRequested(argv: readonly string[]): boolean {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') return false
    if (argument === '--json') return true
    if (argument === '--session-id' || argument === '--resume') index += 1
  }
  return false
}

/**
 * Parse and provide task and TUI options as an ordinary Cordis service. The
 * command's action publishes the values; an absent task starts the persistent
 * profile prompt and remains a usage error for one-shot TTY invocations.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const profileContext = ctx.get('profileContext')
  const profileName = typeof profileContext === 'object'
    && profileContext !== null
    && 'name' in profileContext
    && typeof profileContext.name === 'string'
    ? profileContext.name
    : 'headless'
  const program = headlessCommand(profileName)
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
    if (program.args.length > 1 && program.args.includes('-')) {
      program.error('error: `-` must be the only task argument')
    }
    const joined = program.args.join(' ')
    if (program.args.length > 0 && joined.trim() === '') {
      program.error('error: a task is required, for example: dsh --profile headless "run the tests"')
    }
    const task = program.args.length === 0 ? undefined : joined
    const options = program.opts<{
      json?: boolean
      tui?: boolean
      plain?: boolean
      interactive?: boolean
      sessionId?: string
      resume?: string
    }>()
    // A SessionId is opaque, so whitespace is part of the identity: validate
    // emptiness on the trimmed value but hand the runner the exact string.
    if (options.sessionId !== undefined && options.resume !== undefined) {
      program.error('error: --session-id and --resume are aliases; use one')
    }
    const sessionId = options.resume ?? options.sessionId
    if (sessionId !== undefined && sessionId.trim() === '') {
      program.error(`error: ${options.resume === undefined ? '--session-id' : '--resume'} requires a non-empty session id`)
    }
    if (options.json === true && options.tui === true) {
      program.error('error: --json and --tui are mutually exclusive; pick one stdout contract')
    }
    const tuiProfile = typeof profileContext === 'object'
      && profileContext !== null
      && 'name' in profileContext
      && profileContext.name === 'tui'
    const interactive = options.interactive === true || tuiProfile
    if (task === undefined && !interactive && internals.stdinIsTty()) {
      program.error('error: a task is required, for example: dsh --profile headless "run the tests"')
    }
    ctx.provide(HEADLESS_STARTUP_SERVICE, {
      task,
      sessionId,
      interactive,
      json: options.json === true,
      tui: options.tui === true,
      plain: options.plain === true,
    } satisfies HeadlessStartupValues)
  })
  parseCmdline(ctx, program)
}
