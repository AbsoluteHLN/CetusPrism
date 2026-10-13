/**
 * Parse interactive headless TUI input and provide command-name completions.
 * @module @deepseek-ai/dsh-headless/tui-commands
 */

/** One parsed prompt or built-in TUI command. */
export type TuiCommand =
  | { kind: 'prompt'; text: string }
  | { kind: 'help' }
  | { kind: 'exit' }
  | { kind: 'sessions' }
  | { kind: 'new' }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'models'; provider?: string }
  | { kind: 'model'; provider?: string; model?: string }
  | { kind: 'status' }
  | { kind: 'team' }
  | { kind: 'invalid'; message: string }

const COMPLETIONS = [
  '/help', '/?', '/exit', '/quit', '/sessions', '/ls', '/new',
  '/resume', '/models', '/model', '/status', '/team',
]

/**
 * Parse one readline input line as a prompt, built-in command, or usage error.
 * Prompt text keeps its whitespace; a leading `//` escapes one slash so the
 * resulting prompt begins with `/`.
 * @param line - the complete input line, without readline's line ending.
 * @returns the parsed command or prompt.
 */
export function parseTuiCommand(line: string): TuiCommand {
  const trimmed = line.trimStart()
  if (!trimmed.startsWith('/')) return { kind: 'prompt', text: line }
  if (trimmed.startsWith('//')) return { kind: 'prompt', text: line.replace('//', '/') }

  const [token, ...args] = line.trim().split(/\s+/u)
  const command = token ?? '/'
  const name = command.slice(1).toLowerCase()
  const noArgs = (): boolean => args.length === 0
  const invalid = (message: string): TuiCommand => ({ kind: 'invalid', message })

  switch (name) {
    case 'help':
    case '?':
      return noArgs() ? { kind: 'help' } : invalid(`Usage: ${command}`)
    case 'exit':
    case 'quit':
      return noArgs() ? { kind: 'exit' } : invalid(`Usage: ${command}`)
    case 'sessions':
    case 'ls':
      return noArgs() ? { kind: 'sessions' } : invalid(`Usage: ${command}`)
    case 'new':
      return noArgs() ? { kind: 'new' } : invalid(`Usage: ${command}`)
    case 'resume':
      return args.length === 1
        ? { kind: 'resume', sessionId: args[0]! }
        : invalid(`Usage: ${command} <sessionId>`)
    case 'models':
      if (args.length > 1) return invalid(`Usage: ${command} [provider]`)
      return args.length === 0 ? { kind: 'models' } : { kind: 'models', provider: args[0]! }
    case 'model':
      if (args.length === 0) return { kind: 'model' }
      return args.length === 2
        ? { kind: 'model', provider: args[0]!, model: args[1]! }
        : invalid(`Usage: ${command} [provider model]`)
    case 'status':
      return noArgs() ? { kind: 'status' } : invalid(`Usage: ${command}`)
    case 'team':
      return noArgs() ? { kind: 'team' } : invalid(`Usage: ${command}`)
    default:
      return invalid(`Unknown command: ${command}`)
  }
}

/**
 * Return command-name matches in Node's readline completer format.
 * Arguments are not suggested, so provider and model catalogs remain owned by
 * the live application.
 * @param line - the current readline buffer.
 * @returns matching user commands and the unchanged readline buffer.
 */
export function tuiCommandCompletions(line: string): [string[], string] {
  if (!line.startsWith('/') || line.startsWith('//')) return [[], line]
  return [COMPLETIONS.filter(command => command.startsWith(line)), line]
}
