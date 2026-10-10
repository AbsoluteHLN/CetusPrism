/**
 * Persistent interactive REPL session driver for CetusPrism CLI.
 * Provides a persistent command-line interaction loop with live TUI streaming,
 * multi-turn conversation memory, slash commands, and signal handling.
 * @module @deepseek-ai/dsh-headless/interactive-repl
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { internals } from './runner-internals.ts'
import { summarize, type HeadlessIo } from './summary.ts'
import { printBanner, type TuiRunInfo } from './tui-renderer.ts'
import { projectTuiRun } from './tui.ts'

/** Parameters required to initialize and run the interactive REPL. */
export interface InteractiveReplParams {
  /** The live Agent to drive across interactive turns. */
  agent: Agent
  /** Header facts for display: session identity, model route, working directory. */
  info: TuiRunInfo
  /** Process IO interface. */
  io: HeadlessIo
  /** Optional initial task to execute before opening the interactive prompt. */
  initialTask?: string | undefined
  /** Formatting options: layout width, color, and animations. */
  options?: {
    width?: number | undefined
    color?: boolean | undefined
    animate?: boolean | undefined
  } | undefined
}

/** Paint text with ANSI color code if color is enabled. */
function paint(color: boolean, code: string, text: string): string {
  return color ? `${code}${text}\x1b[0m` : text
}

/**
 * Run the interactive REPL loop until exit or EOF.
 * @param ctx - plugin context.
 * @param params - agent and session runtime parameters.
 * @returns a promise that fulfills when the interactive session terminates.
 */
export async function runInteractiveRepl(ctx: Context, params: InteractiveReplParams): Promise<void> {
  const { agent, info, io, initialTask, options = {} } = params
  const color = options.color ?? (internals.stdoutIsTty() && !internals.noColor())
  const width = options.width ?? internals.stdoutColumns()
  const animate = options.animate ?? internals.stdoutIsTty()

  printBanner(io.stdout, info, { width, color })
  io.stdout.write(paint(color, '\x1b[2m', '\nType a message or /help for commands. Press Ctrl+C to abort a turn, Ctrl+D to exit.\n\n'))

  const promptText = color ? '\x1b[36m\x1b[1mcetus\x1b[0m \x1b[32m❯\x1b[0m ' : 'cetus > '

  let runningTurn = false
  let sigintCount = 0
  let sigintResetTimer: ReturnType<typeof setTimeout> | undefined

  const executeTurn = async (taskText: string): Promise<void> => {
    const firstSeq = agent.session.seq
    const projection = projectTuiRun(
      ctx,
      agent,
      io.stdout,
      info,
      {
        width,
        color,
        animate,
        skipHeader: true,
      },
    )

    try {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: taskText }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
    } finally {
      const sessions = ctx.get('sessions')
      if (sessions !== undefined) {
        await sessions.flush(agent.session)
      }
    }

    const outcome = summarize(agent.session, firstSeq)
    projection.finish(outcome.reason)
    io.stdout.write('\n')
  }

  const handleSlashCommand = async (commandLine: string): Promise<boolean> => {
    const [rawCmd, ...args] = commandLine.trim().split(/\s+/)
    const cmd = rawCmd?.toLowerCase()

    switch (cmd) {
      case '/help': {
        io.stdout.write('\n' + paint(color, '\x1b[1m', 'Available Commands:') + '\n'
          + '  /help             Show this help message\n'
          + '  /clear            Clear screen and reprint header banner\n'
          + '  /session          Show session identity, status, and stats\n'
          + '  /model [name]     Show or switch current default model\n'
          + '  /compact          Request context compaction\n'
          + '  /exit, /quit      Exit interactive session\n\n')
        return false
      }
      case '/clear': {
        io.stdout.write('\x1b[2J\x1b[H')
        printBanner(io.stdout, info, { width, color })
        io.stdout.write('\n')
        return false
      }
      case '/session': {
        io.stdout.write('\n' + paint(color, '\x1b[1m', 'Session Information:') + '\n'
          + `  Session ID:  ${agent.id}\n`
          + `  Working Dir: ${info.cwd ?? 'unknown'}\n`
          + `  Model Route: ${info.provider}/${info.model}\n`
          + `  Log Events:  ${agent.session.seq}\n`
          + `  Lifecycle:   ${agent.status}\n\n`)
        return false
      }
      case '/model': {
        const newModel = args[0]
        const defaultModel = ctx.get('agentDefaultModel')
        if (newModel === undefined || newModel === '') {
          const current = defaultModel?.currentSelection()
          io.stdout.write(`Current model: ${current?.provider ?? info.provider}/${current?.model ?? info.model}\n\n`)
          return false
        }
        if (defaultModel !== undefined) {
          try {
            await defaultModel.saveSelection({ provider: info.provider, model: newModel })
            info.model = newModel
            io.stdout.write(paint(color, '\x1b[32m', `✓ Switched model to ${info.provider}/${newModel}\n\n`))
          } catch (err) {
            io.stderr.write(`Failed to switch model: ${err instanceof Error ? err.message : String(err)}\n\n`)
          }
        } else {
          io.stderr.write('agentDefaultModel service is not available\n\n')
        }
        return false
      }
      case '/compact': {
        io.stdout.write(paint(color, '\x1b[33m', '• Context compaction requested.\n\n'))
        return false
      }
      case '/exit':
      case '/quit': {
        io.stdout.write('Goodbye!\n')
        return true
      }
      default: {
        io.stdout.write(paint(color, '\x1b[31m', `Unknown command "${rawCmd}". Type /help for available commands.\n\n`))
        return false
      }
    }
  }

  return new Promise<void>((resolve) => {
    const rl = internals.createInterface({
      input: internals.stdin,
      output: internals.stdout as unknown as NodeJS.WritableStream,
      terminal: internals.stdinIsTty(),
    })

    let closed = false
    const cleanupAndExit = (code = 0): void => {
      if (closed) return
      closed = true
      if (sigintResetTimer !== undefined) clearTimeout(sigintResetTimer)
      rl.close()
      io.exit(code)
      resolve()
    }

    rl.on('SIGINT', () => {
      if (runningTurn) {
        agent.cancel({ kind: 'user' })
        io.stdout.write(paint(color, '\x1b[33m', '\n(Turn interrupted by user)\n'))
        return
      }
      sigintCount += 1
      if (sigintCount >= 2) {
        io.stdout.write('\nGoodbye!\n')
        cleanupAndExit(0)
        return
      }
      io.stdout.write(paint(color, '\x1b[2m', '\n(Press Ctrl+C again or type /exit to quit)\n'))
      if (sigintResetTimer !== undefined) clearTimeout(sigintResetTimer)
      sigintResetTimer = setTimeout(() => {
        sigintCount = 0
      }, 2000)
      rl.prompt()
    })

    rl.on('close', () => {
      io.stdout.write('\nGoodbye!\n')
      cleanupAndExit(0)
    })

    const promptNext = (): void => {
      rl.setPrompt(promptText)
      rl.prompt()
    }

    const startRepl = async (): Promise<void> => {
      if (initialTask !== undefined && initialTask.trim() !== '') {
        runningTurn = true
        try {
          await executeTurn(initialTask)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          io.stderr.write(`dsh: ${message}\n`)
        } finally {
          runningTurn = false
        }
      }
      promptNext()
    }

    rl.on('line', (line: string) => {
      void (async () => {
        const trimmed = line.trim()
        if (trimmed === '') {
          promptNext()
          return
        }

        if (trimmed.startsWith('/')) {
          const shouldExit = await handleSlashCommand(trimmed)
          if (shouldExit) {
            cleanupAndExit(0)
            return
          }
          promptNext()
          return
        }

        rl.pause()
        runningTurn = true
        try {
          await executeTurn(trimmed)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          io.stderr.write(`dsh: ${message}\n`)
        } finally {
          runningTurn = false
          rl.resume()
          promptNext()
        }
      })()
    })

    void startRepl()
  })
}
