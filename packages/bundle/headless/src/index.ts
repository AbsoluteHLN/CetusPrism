/**
 * @deepseek-ai/dsh-headless — direct Agent and persistent TUI driver. The
 * bundle patch rides over dsh-base without Host, HTTP, or browser plugins;
 * one-shot invocations create or adopt one Agent, while `--interactive` keeps
 * a single Agent and readline surface alive for multiple durable turns. Each
 * TUI turn renders a live header, status line, tool cards, streaming answer,
 * and summary footer, then flushes its Session before the next prompt.
 *
 * @module @deepseek-ai/dsh-headless
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
// Empty type imports carry the loader Context merge for the settlement await,
// the cmdline Context merge for the appExit host value, and the sessionQuery
// Context merge for exact Session adoption.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-session-query'
import { internals, type InteractiveInput } from './runner-internals.ts'
import { projectJsonRun, boundJsonLine } from './json-stream.ts'
import { projectTuiRun, type TuiProjection } from './tui.ts'

/** Stable Cordis plugin name. */
export const name = 'headless-runner'

/** Core services required before a one-shot turn or persistent loop can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: task and run options resolved from this app's startup provider. */
export interface Config {
  /** The initial prompt; absent when interactive mode should open at the prompt. */
  task?: string
  /** Exact Session identity to adopt; absent for a fresh random identity. An id with no stored Session fails. */
  sessionId?: string
  /** Keep the terminal open for more prompts and expose session commands. */
  interactive?: boolean
  /** Whether stdout carries the machine-readable event stream instead of final text. */
  json?: boolean
  /** Render the live terminal UI even when stdout is not a terminal. */
  tui?: boolean
  /** Print the classic plain output even when stdout is a terminal. */
  plain?: boolean
}

export const Config: z<Config> = z.object({
  task: z.string(),
  sessionId: z.string(),
  interactive: z.boolean(),
  json: z.boolean(),
  tui: z.boolean(),
  plain: z.boolean(),
})

/** Outcome of one owned run interval. */
interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
interface HeadlessIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(session: Session, firstSeq: SessionLogOffset): RunOutcome {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  const length = session.seq
  for (let seq = firstSeq; seq < length; seq++) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) {
      throw new Error(`headless summary cannot read seq ${String(seq)} below captured length ${String(length)}`)
    }
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/**
 * Project provider-reported reasoning from one owned run to stderr as it is
 * streamed, while keeping final outcome derivation on the durable log.
 * @param ctx - plugin context carrying the live Assistant frame feed.
 * @param agent - the exact Agent whose reasoning belongs to this invocation.
 * @param stderr - progress output sink.
 * @returns a disposer that also terminates an unterminated reasoning line.
 */
function streamReasoning(
  ctx: Context,
  agent: Agent,
  stderr: HeadlessIo['stderr'],
): () => void {
  let open = false
  let endsWithNewline = true
  const close = (): void => {
    if (!open) return
    if (!endsWithNewline) stderr.write('\n')
    open = false
    endsWithNewline = true
  }
  const dispose = ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
    if (subject !== agent) return
    if (frame.type === 'start') {
      close()
      return
    }
    if (frame.type === 'end') {
      close()
      return
    }
    const chunk = frame.chunk
    switch (chunk.type) {
      case 'reasoning-delta':
        if (chunk.text === '') return
        if (!open) {
          stderr.write('dsh: reasoning:\n')
          open = true
        }
        stderr.write(chunk.text)
        endsWithNewline = chunk.text.endsWith('\n')
        return
      case 'block-start':
        if (chunk.blockType !== 'reasoning') close()
        return
      case 'block-end':
        if (chunk.block.type !== 'reasoning') close()
        return
      case 'usage':
        return
      case 'text-delta':
      case 'tool-call-delta':
      case 'finish':
        close()
        return
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(chunk, 'headless reasoning stream')
    }
  })
  return () => {
    dispose()
    close()
  }
}

/** The Session facts that decide whether the runner may drive it directly. */
interface AdoptableHeader {
  cwd?: string | undefined
  origin?: 'subagent' | undefined
  parentSession?: SessionId | undefined
  agentPreset?: string | undefined
}

/** Iterate a live Session's durable events in order. */
function* liveEvents(session: Session): Generator<SessionEvent> {
  const length = session.seq
  for (let seq = 0; seq < length; seq++) {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    const event = session.eventAt(SessionSeq(seq))
    if (event === undefined) {
      throw new Error(`headless adoption cannot read seq ${String(seq)} below captured length ${String(length)}`)
    }
    yield event
  }
}

/**
 * The preset a Session currently runs under: its creation header advanced by
 * the last `agent-preset/selected` event. The header is only a creation fact;
 * the presets plugin reconstructs a session's composition from the projection.
 */
function currentPreset(header: AdoptableHeader, events: Iterable<SessionEvent>, sessionId: SessionId): string | undefined {
  let preset = header.agentPreset
  for (const event of events) {
    // Owned by dsh-agent-preset-registry, which this bundle does not compose, so the
    // event is read structurally rather than through its module augmentation.
    const candidate = event as unknown as { type: string; data?: { agentPreset?: unknown } }
    if (candidate.type !== 'agent-preset/selected') continue
    const selected = candidate.data?.agentPreset
    // A corrupt record must not read as "no preset": that would let the run
    // continue under this bundle's composition instead of the recorded one.
    if (typeof selected !== 'string' || selected === '') {
      throw new Error(`session "${sessionId}" records a malformed agent-preset/selected event and cannot be adopted`)
    }
    preset = selected
  }
  return preset
}

/** Reject a Session the one-shot runner must not adopt. */
function assertAdoptable(header: AdoptableHeader, events: Iterable<SessionEvent>, sessionId: SessionId, cwd: string): void {
  const preset = currentPreset(header, events, sessionId)
  if (preset !== undefined) {
    // This bundle composes no preset roster, so resuming the session here would
    // silently run it under the headless tools and prompts instead of the
    // composition its log records.
    throw new Error(
      `session "${sessionId}" runs under agent preset "${preset}", which the one-shot runner does not compose`,
    )
  }
  if (header.origin === 'subagent' || header.parentSession !== undefined) {
    throw new Error(`session "${sessionId}" is a subagent or forked session and cannot be driven directly`)
  }
  if (header.cwd === undefined) {
    throw new Error(`session "${sessionId}" recorded no working directory, so it cannot be adopted`)
  }
  if (header.cwd !== cwd) {
    throw new Error(`session "${sessionId}" was recorded in "${header.cwd}", not "${cwd}"`)
  }
}

/**
 * Resolve the Agent for one run: adopt the persisted Session with the requested
 * id. The identity must already exist, and no Agent may be live under it; a
 * first round omits the option instead, so a typo cannot pass as a brand-new
 * conversation.
 * @param ctx - plugin context carrying the Session query service.
 * @param agents - the core Agent registry.
 * @param sessionId - exact Session identity to adopt.
 * @param agentOptions - provider/model pair for this run.
 * @param setup - per-Agent scope setup installing the model selection.
 * @param cwd - working directory resolved in the mounted filesystem.
 * @returns the resumed Agent handle owned by this runner.
 */
async function resolveAgent(
  ctx: Context,
  agents: Context['agents'],
  sessionId: SessionId,
  agentOptions: { provider: string; model: string },
  setup: (agentCtx: Context) => void,
  cwd: string,
): Promise<AgentHandle> {
  // Resuming promises the caller a log a later process can continue. Without a
  // durable log the run would succeed, print the id, and still lose the whole
  // history at exit, so a miscomposed profile fails loud before the resume.
  if (ctx.get('sessionPersistence') === undefined) {
    throw new Error('headless --session-id requires the sessionPersistence service; the Session would not survive this process')
  }
  // A later process holds no live Agent and has to find the id through the
  // query service, so every --session-id run requires it.
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new Error('headless --session-id requires the sessionQuery service; dsh-base provides it')
  }
  const live = agents.get(sessionId)
  if (live !== undefined) {
    // A live Agent already has an owner that may still drive it, and `whenIdle`
    // is not a single-message signal: folding its next interval into this run
    // would mix that owner's events — even its final answer — into the stream.
    // The runner cannot claim an exclusive interval over an Agent it did not
    // create, so it refuses the identity; the adoptability rules run first so a
    // real mismatch is named instead of the generic refusal.
    assertAdoptable(live.session.header, liveEvents(live.session), sessionId, cwd)
    throw new Error(`session "${sessionId}" is live in this process, so the one-shot runner cannot own an exclusive run interval`)
  }
  try {
    using observation = await query.observeSession(sessionId)
    assertAdoptable(observation.header, observation.events, sessionId, cwd)
    const handle = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    // The observation is a snapshot: another writer may have appended a preset
    // selection before this process took the write lease. Re-check the log
    // resume actually attached, now that no other process can append.
    assertAdoptable(handle.agent.session.header, liveEvents(handle.agent.session), sessionId, cwd)
    return handle
  } catch (error: unknown) {
    if (!(error instanceof SessionQueryError) || error.code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
    // --session-id resumes a conversation that already exists; starting a new
    // one is the no-id path, which generates its own identity and reports it in
    // the `session` event. Creating the requested id here would turn a typo
    // into a brand-new empty history the caller believes it is continuing.
    throw new Error(`session "${sessionId}" does not exist; omit --session-id to start a new Session`)
  }
}

/** Commands understood by the persistent terminal prompt. */
type InteractiveCommand =
  | { kind: 'prompt'; text: string }
  | { kind: 'help' }
  | { kind: 'exit' }
  | { kind: 'sessions' }
  | { kind: 'new' }
  | { kind: 'resume'; sessionId: string }

/** Parse one line without changing ordinary prompts that begin with a slash. */
function parseInteractiveCommand(line: string): InteractiveCommand {
  const trimmed = line.trim()
  if (!trimmed.startsWith('/')) return { kind: 'prompt', text: line }
  const parts = trimmed.slice(1).split(/\s+/u)
  const command = parts[0]?.toLowerCase() ?? ''
  switch (command) {
    case 'help':
    case '?':
      return { kind: 'help' }
    case 'exit':
    case 'quit':
      return { kind: 'exit' }
    case 'sessions':
    case 'ls':
      return { kind: 'sessions' }
    case 'new':
      return { kind: 'new' }
    case 'resume':
      return parts[1] === undefined || parts[1] === ''
        ? { kind: 'help' }
        : { kind: 'resume', sessionId: parts[1] }
    default:
      return { kind: 'prompt', text: line }
  }
}

/** Print the persistent prompt's command reference. */
function printInteractiveHelp(io: HeadlessIo): void {
  io.stdout.write([
    'Commands:',
    '  /help             show this help',
    '  /sessions         list persisted sessions',
    '  /resume <id>      switch to an existing session',
    '  /new              start a new session',
    '  /exit             flush and leave the TUI',
    '  Ctrl+C            stop the current process safely',
    '',
  ].join('\n'))
}

/** Read a line and treat readline closure (EOF or shutdown) as normal exit. */
async function readInteractiveLine(
  input: InteractiveInput,
  prompt: string,
): Promise<string | undefined> {
  try {
    return await input.question(prompt)
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('closed')) return undefined
    if (typeof error === 'object' && error !== null && 'code' in error
      && error.code === 'ERR_USE_AFTER_CLOSE') return undefined
    throw error
  }
}

/** Print persisted sessions in the same order as the query service. */
async function printInteractiveSessions(ctx: Context, io: HeadlessIo, currentId: SessionId): Promise<void> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    io.stdout.write('Session listing is unavailable: dsh-base did not mount sessionQuery.\n')
    return
  }
  const records = await query.listSessions()
  if (records.length === 0) {
    io.stdout.write('No persisted sessions.\n')
    return
  }
  const titles = await query.readTitleSnapshots(records.map(record => record.header.id))
  const titleById = new Map<SessionId, string>()
  for (const result of titles) {
    if (result.status === 'fulfilled' && result.value.title !== undefined) {
      titleById.set(result.sessionId, result.value.title.title)
    }
  }
  for (const record of records) {
    const marker = record.header.id === currentId ? '*' : ' '
    const title = titleById.get(record.header.id)
    const label = title === undefined ? '' : ` — ${title}`
    io.stdout.write(`${marker} ${record.header.id}${label}${record.live ? ' [live]' : ''}\n`)
  }
}

/** Build one fresh or resumed Agent under the current runner's owner. */
async function createAgentHandle(
  ctx: Context,
  agents: Context['agents'],
  requestedId: string | undefined,
  agentOptions: { provider: string; model: string },
  setup: (agentCtx: Context) => void,
  cwd: string,
): Promise<AgentHandle> {
  const sessionId = brandString<SessionId>(requestedId ?? `session-${randomUUID()}`)
  return requestedId === undefined
    ? agents.create({ sessionId, meta: { cwd }, agentOptions, setup })
    : resolveAgent(ctx, agents, sessionId, agentOptions, setup, cwd)
}

/** Execute one prompt and leave the persistent loop ready for the next line. */
async function runInteractiveTurn(
  ctx: Context,
  agent: Agent,
  sessions: Context['sessions'],
  selection: { provider: string; model: string },
  cwd: string,
  task: string,
  io: HeadlessIo,
): Promise<void> {
  const firstSeq = agent.session.seq
  const projection = projectTuiRun(ctx, agent, io.stdout, {
    sessionId: agent.id,
    provider: selection.provider,
    model: selection.model,
    cwd,
  }, {
    width: internals.stdoutColumns(),
    color: internals.stdoutIsTty() && !internals.noColor(),
    animate: internals.stdoutIsTty(),
  })
  try {
    let failure: string | undefined
    try {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: task }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
    } catch (error: unknown) {
      failure = error instanceof Error ? error.message : String(error)
    }
    try {
      await sessions.flush(agent.session)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      failure = failure === undefined ? `cannot flush Session: ${message}` : `${failure}; cannot flush Session: ${message}`
    }
    if (failure !== undefined) {
      projection.fail(failure)
      io.stderr.write(`dsh: ${failure}\n`)
    } else {
      const outcome = summarize(agent.session, firstSeq)
      projection.finish(outcome.reason)
      if (outcome.reason?.kind === 'error') {
        io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
      }
    }
  } finally {
    projection.dispose()
  }
}

/** Keep one Agent and one readline surface alive until the user exits. */
async function runInteractive(
  ctx: Context,
  config: Config,
  io: HeadlessIo,
  agents: Context['agents'],
  sessions: Context['sessions'],
  selection: { provider: string; model: string },
  setup: (agentCtx: Context) => void,
  cwd: string,
  input: InteractiveInput,
): Promise<void> {
  if (config.json === true) throw new Error('headless interactive mode cannot share stdout with --json')
  if (config.plain === true) throw new Error('headless interactive mode requires the TUI; remove --plain')
  const releaseInput = ctx.effect(() => () => { input.close() }, 'headless.interactiveInput()')
  let handle: AgentHandle | undefined
  let exitCode = 0
  try {
    handle = await createAgentHandle(ctx, agents, config.sessionId, selection, setup, cwd)
    io.stdout.write(`CetusPrism persistent TUI — session ${handle.agent.id}\n`)
    printInteractiveHelp(io)
    let initialTask = config.task === '-' ? await internals.readStdin() : config.task
    while (true) {
      const line = initialTask ?? await readInteractiveLine(input, `${handle.agent.id}> `)
      initialTask = undefined
      if (line === undefined) break
      const command = parseInteractiveCommand(line)
      if (command.kind === 'exit') break
      if (command.kind === 'help') {
        printInteractiveHelp(io)
        continue
      }
      if (command.kind === 'sessions') {
        try {
          await printInteractiveSessions(ctx, io, handle.agent.id)
        } catch (error: unknown) {
          io.stderr.write(`dsh: cannot list sessions: ${error instanceof Error ? error.message : String(error)}\n`)
        }
        continue
      }
      if (command.kind === 'new' || command.kind === 'resume') {
        let next: AgentHandle | undefined
        try {
          next = await createAgentHandle(
            ctx,
            agents,
            command.kind === 'new' ? undefined : command.sessionId,
            selection,
            setup,
            cwd,
          )
          await sessions.flush(handle.agent.session)
          await handle.dispose()
          handle = next
          next = undefined
          io.stdout.write(`Switched to session ${handle.agent.id}.\n`)
        } catch (error: unknown) {
          await next?.dispose().catch(() => {})
          io.stderr.write(`dsh: cannot switch session: ${error instanceof Error ? error.message : String(error)}\n`)
        }
        continue
      }
      if (command.text.trim() === '') continue
      await runInteractiveTurn(ctx, handle.agent, sessions, selection, cwd, command.text, io)
    }
    await sessions.flush(handle.agent.session)
  } catch (error: unknown) {
    exitCode = 1
    const message = error instanceof Error ? error.message : String(error)
    io.stderr.write(`dsh: ${message}\n`)
  } finally {
    input.close()
    releaseInput()
    await handle?.dispose().catch((error: unknown) => {
      exitCode = 1
      io.stderr.write(`dsh: cannot close session: ${error instanceof Error ? error.message : String(error)}\n`)
    })
  }
  io.exit(exitCode)
}

/**
 * Run one task through one Agent and request process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param config - task, optional exact Session identity, and output mode.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: HeadlessIo): Promise<void> {
  const useJson = config.json === true
  let jsonProjection: ReturnType<typeof projectJsonRun> | undefined
  let tuiProjection: TuiProjection | undefined
  const earlyInput = config.interactive === true ? internals.createInteractiveInput() : undefined
  let interactiveInputConsumed = false
  try {
    // Loader siblings mount concurrently. Await the complete application before
    // creating an Agent so its scoped tools and adapters are not half-composed.
    await ctx.get('loader')?.await()
    const agents = ctx.get('agents')
    const defaultModel = ctx.get('agentDefaultModel')
    const sessions = ctx.get('sessions')
    // Early process shutdown can dispose the tree while settlement is pending.
    if (agents === undefined || defaultModel === undefined || sessions === undefined) return

    // A Cordis overlay sets the row directly and bypasses the CLI trim check, so
    // the same public setting must fail here rather than become a blank identity.
    if (config.sessionId !== undefined && config.sessionId.trim() === '') {
      throw new Error('headless-runner: sessionId must not be blank')
    }

    const selection = defaultModel.currentSelection()
    const agentOptions = { provider: selection.provider, model: selection.model }
    // This bundle composes no preset roster, so the model-facing rows sit in the
    // host plane and the agent reads them from the global layer. A deployment
    // that DOES configure one has to join it here first
    // (@deepseek-ai/dsh-agent-preset-registry README, "Composing a child agent").
    const setup = (agentCtx: Context): void => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    }
    const fs = ctx.get('fs')
    const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
    if (config.interactive === true) {
      if (earlyInput === undefined) throw new Error('headless-runner: interactive input was not initialized')
      interactiveInputConsumed = true
      await runInteractive(ctx, config, io, agents, sessions, selection, setup, cwd, earlyInput)
      return
    }

    const task = config.task === undefined || config.task === '-'
      ? await internals.readStdin()
      : config.task
    if (task.trim() === '') {
      throw new Error('a task is required, for example: dsh --profile headless "run the tests"')
    }

    const handle = await createAgentHandle(ctx, agents, config.sessionId, agentOptions, setup, cwd)
    const agent = handle.agent
    await agent.whenIdle()
    if (config.sessionId !== undefined) {
      // The resume-time check read a snapshot; an overlay can still append a
      // preset selection between it and the interval this run now owns, so
      // re-read the log the runner holds before submitting the task.
      const sessionId = brandString<SessionId>(config.sessionId)
      assertAdoptable(agent.session.header, liveEvents(agent.session), sessionId, cwd)
    }
    const firstSeq = agent.session.seq
    // Output mode: --json owns stdout first; --plain forces the classic mode;
    // otherwise the live UI is the default on a TTY stdout, and --tui extends
    // it to a piped stdout, where it renders as a static, uncolored transcript.
    const useTui = !useJson && config.plain !== true && (config.tui === true || internals.stdoutIsTty())
    jsonProjection = useJson ? projectJsonRun(ctx, agent, io.stdout, { cwd }) : undefined
    tuiProjection = useTui
      ? projectTuiRun(ctx, agent, io.stdout, {
        sessionId: agent.id,
        provider: selection.provider,
        model: selection.model,
        cwd,
      }, {
        width: internals.stdoutColumns(),
        color: internals.stdoutIsTty() && !internals.noColor(),
        animate: internals.stdoutIsTty(),
      })
      : undefined
    const stopReasoning = jsonProjection === undefined && tuiProjection === undefined
      ? streamReasoning(ctx, agent, io.stderr)
      : undefined
    try {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: task }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
    } finally {
      stopReasoning?.()
    }
    await sessions.flush(agent.session)
    const outcome = summarize(agent.session, firstSeq)
    if (jsonProjection !== undefined) jsonProjection.finish(outcome.text)
    else if (tuiProjection !== undefined) tuiProjection.finish(outcome.reason)
    else io.stdout.write(outcome.text + '\n')
    if (outcome.reason?.kind === 'error') {
      io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
    }
    io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    tuiProjection?.fail(message)
    if (useJson) io.stdout.write(`${boundJsonLine({ type: 'error', message })}\n`)
    io.stderr.write(`dsh: ${message}\n`)
    io.exit(1)
  } finally {
    jsonProjection?.dispose()
    tuiProjection?.dispose()
    if (!interactiveInputConsumed) earlyInput?.close()
  }
}

/**
 * Mount the one-shot direct driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task and run options.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: HeadlessIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  // run owns every failure path — the TUI footer, the JSON error event, and
  // the stderr diagnostic — so no rejection escapes this mount.
  void run(ctx, config, io)
}
