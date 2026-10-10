/**
 * @deepseek-ai/dsh-headless — one-shot direct Agent driver. The bundle patch
 * rides over dsh-base without Host, HTTP, or browser plugins; this runner
 * creates one Agent through the core registry (or adopts the exact Session a
 * `--session-id` names), drives the task to quiescence, flushes its Session,
 * and exits. On a TTY stdout the run renders as a live terminal UI — header,
 * animated status line, tool cards, streaming answer, and summary footer —
 * unless `plain` selects the classic mode, which streams provider reasoning to
 * stderr and prints the final assistant text to stdout. With `json`, stdout
 * carries newline-delimited run events instead of either.
 *
 * @module @deepseek-ai/dsh-headless
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { assertNever } from '@deepseek-ai/dsh-util-values'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
// Empty type imports carry the loader Context merge for the settlement await,
// the cmdline Context merge for the appExit host value, and the sessionQuery
// Context merge for exact Session adoption.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-session-query'
import { internals } from './runner-internals.ts'
import { projectJsonRun, boundJsonLine } from './json-stream.ts'
import { projectTuiRun, type TuiProjection } from './tui.ts'
import { summarize, type HeadlessIo, type RunOutcome } from './summary.ts'
import { runInteractiveRepl } from './interactive-repl.ts'

export { summarize, type HeadlessIo, type RunOutcome }

/** Stable Cordis plugin name. */
export const name = 'headless-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the task and run options resolved from this app's injected provider service. */
export interface Config {
  /** The prompt text for the single run; absent when the task arrives on stdin. */
  task?: string
  /** Exact Session identity to adopt; absent for a fresh random identity. An id with no stored Session fails. */
  sessionId?: string
  /** Whether stdout carries the machine-readable event stream instead of final text. */
  json?: boolean
  /** Render the live terminal UI even when stdout is not a terminal. */
  tui?: boolean
  /** Print the classic plain output even when stdout is a terminal. */
  plain?: boolean
  /** Whether to run an interactive persistent CLI session. */
  interactive?: boolean
  /** Whether one-shot mode is forced. */
  oneShot?: boolean
}

export const Config: z<Config> = z.object({
  task: z.string(),
  sessionId: z.string(),
  json: z.boolean(),
  tui: z.boolean(),
  plain: z.boolean(),
  interactive: z.boolean(),
  oneShot: z.boolean(),
})


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
 * @returns the resumed Agent.
 */
async function resolveAgent(
  ctx: Context,
  agents: Context['agents'],
  sessionId: SessionId,
  agentOptions: { provider: string; model: string },
  setup: (agentCtx: Context) => void,
  cwd: string,
): Promise<Agent> {
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
    const { agent } = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
    // The observation is a snapshot: another writer may have appended a preset
    // selection before this process took the write lease. Re-check the log
    // resume actually attached, now that no other process can append.
    assertAdoptable(agent.session.header, liveEvents(agent.session), sessionId, cwd)
    return agent
  } catch (error: unknown) {
    if (!(error instanceof SessionQueryError) || error.code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
    // --session-id resumes a conversation that already exists; starting a new
    // one is the no-id path, which generates its own identity and reports it in
    // the `session` event. Creating the requested id here would turn a typo
    // into a brand-new empty history the caller believes it is continuing.
    throw new Error(`session "${sessionId}" does not exist; omit --session-id to start a new Session`)
  }
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
    const sessionId = brandString<SessionId>(config.sessionId ?? `session-${randomUUID()}`)
    const fs = ctx.get('fs')
    const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
    const agent = config.sessionId === undefined
      ? (await agents.create({
        sessionId,
        meta: { cwd },
        agentOptions,
        setup,
      })).agent
      : await resolveAgent(ctx, agents, sessionId, agentOptions, setup, cwd)
    await agent.whenIdle()
    if (config.sessionId !== undefined) {
      // The resume-time check read a snapshot; an overlay can still append a
      // preset selection between it and the interval this run now owns, so
      // re-read the log the runner holds before submitting the task.
      assertAdoptable(agent.session.header, liveEvents(agent.session), sessionId, cwd)
    }

    if (config.interactive === true) {
      const initialTask = config.task === undefined || config.task === '' || config.task === '-'
        ? undefined
        : config.task
      await runInteractiveRepl(ctx, {
        agent,
        io,
        info: {
          sessionId: agent.id,
          provider: selection.provider,
          model: selection.model,
          cwd,
        },
        initialTask,
        options: {
          width: internals.stdoutColumns(),
          color: internals.stdoutIsTty() && !internals.noColor(),
          animate: internals.stdoutIsTty(),
        },
      })
      return
    }

    const task = config.task === undefined || config.task === '-'
      ? await internals.readStdin()
      : config.task
    if (task.trim() === '') {
      throw new Error('a task is required, for example: dsh --profile headless "run the tests"')
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
