/**
 * External-runtime agent driver: owns the Agent lifecycle and inbox semantics
 * while an external runtime (Pi, ZCode) owns the turn. The driver translates
 * the normalized adapter event stream into the same durable session-event
 * vocabulary the React loop writes (`turn/start`, `step/start`,
 * `user/message`, `assistant/message`, `tool/call` + `tool/result`,
 * `step/end`, `turn/end`), so the front-end session stream renders an
 * external-runtime turn exactly like a native one — the log stays the single
 * source of truth and `model-visible ⟺ logged` survives the boundary.
 *
 * Turn mapping: one claimed inbox message opens one step; runtimes that
 * report per-round boundaries (`message_started`, e.g. Pi) advance one DSH
 * step per model round, so a tool loop's rounds appear as separate steps
 * exactly like the React loop's. Runtimes without the signal (ZCode today)
 * keep one step for the whole run. Steering queued mid-run is claimed by
 * the next step, mirroring the React loop's inbox contract.
 *
 * @module @deepseek-ai/dsh-agent-preset-registry/external-agent-driver
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  Agent,
  AgentCancelCause,
  AgentEventDispatch,
  AgentOptions,
  AgentStatus,
  CancelOptions,
  InboxTarget,
} from '@deepseek-ai/dsh-agent'
import { AgentInbox, agentEvents } from '@deepseek-ai/dsh-agent'
import {
  AssistantStreamAccumulator,
  BlockAssembler,
  LlmError,
  ToolCallId,
  createAssistantMessage,
  createToolResultMessage,
  errorChain,
  type AssistantStreamRecord,
  type StreamChunk,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
import type { Scope } from '@deepseek-ai/dsh-scope'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Session, SessionId, SessionSeq, TurnEndReason } from '@deepseek-ai/dsh-session'
import type { ExternalRuntimeAdapter, ExternalRuntimeEvent } from './external-runtime.ts'

/** Construction options for {@link ExternalAgentDriver}. */
export interface ExternalAgentDriverOptions {
  /** The normalized adapter this driver drives; the runtime owns turn execution. */
  readonly adapter: ExternalRuntimeAdapter
  /** Optional sink for runtime notices (retries, compaction, declined interactions). */
  readonly onNotice?: (notice: Extract<ExternalRuntimeEvent, { type: 'notice' }>) => void
}

type Phase =
  | { kind: 'idle'; lastTurn: number }
  | {
    kind: 'maintenance'
    abort: AbortController
    lastTurn: number
    wakeRequested: boolean
  }
  | { kind: 'running'; abort: AbortController; turn: number; step: number; wakeRequested: boolean }

/**
 * Read the cause `cancel()` passed when aborting a driver-owned signal,
 * copying only the fields `turn/end` records (the live reason may carry
 * Node-assigned stacks `Session.append` rejects as data).
 */
function abortedCancelCause(signal: AbortSignal): AgentCancelCause | undefined {
  if (!signal.aborted) return undefined
  const cause = signal.reason as AgentCancelCause
  switch (cause.kind) {
    case 'user':
    case 'parent':
    case 'disposed':
      return { kind: cause.kind }
    case 'hook':
      return { kind: 'hook', reason: cause.reason }
    default:
      return { kind: 'user' }
  }
}

/** Extract the plain-text input of one user message; external runtimes take text. */
function extractText(message: UserMessage): string {
  const parts: string[] = []
  for (const block of message.content) {
    if (block.type === 'text') parts.push(block.text)
  }
  const text = parts.join('\n').trim()
  if (text === '') {
    throw new Error('external-runtime turns accept text input only in this build')
  }
  return text
}

/** Compact JSON text for a tool result payload crossing into the durable log. */
function stringifyResult(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

/**
 * Agent driver over one external runtime. Implements the full public Agent
 * runtime face so host, registry, and client code drive it exactly like a
 * React-loop agent; only the turn mechanics differ.
 */
export class ExternalAgentDriver implements Agent {
  readonly inbox: AgentInbox
  private phase: Phase
  private activityDone: Promise<void> = Promise.resolve()

  /** The agent-scoped registration boundary; the lifecycle owner unwinds it after the driver exits. */
  readonly scope: Scope
  readonly ctx: Context

  /** Fused dispatcher, built once in the constructor so hot-path dispatches never allocate. */
  private readonly dispatch: AgentEventDispatch
  private readonly driverOptions: ExternalAgentDriverOptions
  /** Whether the adapter process is up; started lazily on the first turn. */
  private adapterStarted = false

  constructor(
    private readonly loopCtx: Context,
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
    driverOptions: ExternalAgentDriverOptions,
  ) {
    this.driverOptions = driverOptions
    this.dispatch = agentEvents(loopCtx, this)
    this.scope = createScope(loopCtx, this)
    this.ctx = this.scope.ctx
    this.inbox = new AgentInbox(this.ctx.sessionProjections, session, this.dispatch)
    /* v8 ignore next -- the loop registers its own turnBoundary unit, so the key is always present */
    const lastTurn = this.loopCtx.sessionProjections.stateOf(session, 'turnBoundary')?.lastTurn ?? 0
    this.phase = { kind: 'idle', lastTurn }
    // The adapter process outlives individual turns; scope disposal owns it.
    this.ctx.effect(() => () => {
      this.adapterStarted = false
      void this.driverOptions.adapter.stop().catch(() => {})
    }, 'externalAgentDriver.adapter')
  }

  get status(): AgentStatus {
    return this.phase.kind === 'idle' || this.phase.kind === 'maintenance' ? 'idle' : 'running'
  }

  /** Commit a phase and publish its externally visible status transition. */
  private setPhase(next: Phase): void {
    const previousStatus = this.status
    this.phase = next
    const status = this.status
    if (status !== previousStatus) {
      this.dispatch.emit('agent/status', { status })
    }
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    // Waking input cannot join an aborted activity, so it starts the next turn.
    // Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it.
    const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
    const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
    this.inbox.splice(resolvedTarget, Infinity, 0, [message])
    if (wakeup) this.wakeDriver(wakingAfterAbort)
  }

  followup(input: UserMessage): void {
    this.send(input, 'next-turn', true)
  }

  steer(input: UserMessage): void {
    this.send(input, 'next-step', true)
  }

  inject(input: UserMessage): void {
    this.send(input, 'next-step', false)
  }

  cancel(cause: AgentCancelCause, options: CancelOptions = {}): void {
    if (!options.keepInbox) {
      this.inbox.clear()
      if (this.phase.kind !== 'idle') this.phase.wakeRequested = false
    }
    if (this.phase.kind !== 'idle') {
      // Ask the runtime to interrupt its live turn, then arm the signal the
      // run loop observes. A runtime that already settled ignores this.
      if (this.phase.abort.signal.aborted === false) {
        void this.driverOptions.adapter.abortTurn().catch(() => {})
      }
      this.phase.abort.abort(cause)
    }
  }

  runMaintenance<T>(job: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.phase.kind !== 'idle') throw new Error(`agent "${this.id}" already has active work`)
    const done = Promise.withResolvers<void>()
    const maintenance: Phase = {
      kind: 'maintenance',
      abort: new AbortController(),
      lastTurn: this.phase.lastTurn,
      wakeRequested: false,
    }
    this.setPhase(maintenance)
    this.activityDone = done.promise
    return (async () => {
      try {
        return await job(maintenance.abort.signal)
      } finally {
        this.setPhase({ kind: 'idle', lastTurn: maintenance.lastTurn })
        const cause = abortedCancelCause(maintenance.abort.signal)
        if (cause?.kind !== 'disposed' && maintenance.wakeRequested && this.inbox.hasPending) this.wakeDriver()
        done.resolve()
      }
    })()
  }

  /**
   * Start one driver, or latch its wake behind maintenance or an aborted
   * activity. A wake sent while idle always opens its turn boundary, even
   * when its message was cleared; only a latched replay is suppressed when
   * the queue no longer holds the wake.
   */
  private wakeDriver(wakeAfterAbort = false): void {
    if (this.phase.kind !== 'idle') {
      // Maintenance and aborted drivers cannot deliver the wake: latch it for
      // replay at convergence. Live drivers claim queued work themselves;
      // disposal never latches, so teardown waits on no external run.
      const reason = abortedCancelCause(this.phase.abort.signal)
      if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakeAfterAbort)) {
        this.phase.wakeRequested = true
      }
      return
    }
    const driver = Promise.withResolvers<void>()
    this.activityDone = driver.promise
    this.setPhase({
      kind: 'running',
      abort: new AbortController(),
      turn: this.phase.lastTurn,
      step: 0,
      wakeRequested: false,
    })
    this.loopCtx.agents.withInitiator(this, () => this.kick()).then(driver.resolve, driver.reject)
  }

  async whenIdle(): Promise<void> {
    let activity: Promise<void>
    do {
      await (activity = this.activityDone)
    } while (activity !== this.activityDone)
  }

  /** Report one failure at its live boundary, then preserve it for driver containment. */
  private throwError(error: unknown): never {
    const turn = this.phase.kind === 'running' ? this.phase.turn : this.phase.lastTurn
    const step = this.phase.kind === 'running' ? this.phase.step : 0
    this.dispatch.emit('agent/error', { turn, step, error })
    throw error
  }

  private async kick(): Promise<void> {
    try {
      while (await this.turn()) {}
    } catch (_error) {
      // Reported failures and cancellation are contained at the driver boundary.
    } finally {
      /* v8 ignore next -- kick owns a running phase until this driver boundary */
      if (this.phase.kind === 'running') {
        const { turn, wakeRequested } = this.phase
        this.setPhase({ kind: 'idle', lastTurn: turn })
        if (wakeRequested && this.inbox.hasPending) this.wakeDriver()
      }
    }
  }

  /** Open one turn and drain the queued input through external runtime runs. */
  private async turn(): Promise<boolean> {
    if (this.phase.kind !== 'running') {
      this.throwError(new Error(`agent "${this.id}": turn without driver reservation`))
    }
    const phase = this.phase
    const { signal } = phase.abort
    signal.throwIfAborted()
    const turn = phase.turn + 1
    this.session.append('turn/start', { turn })
    phase.turn = turn
    let turnEnds: TurnEndReason | null = null
    try {
      while (true) {
        signal.throwIfAborted()
        // Claim all steering plus one queued turn message, exactly like the
        // React loop's step claim; each claimed message opens a step below
        // (runtimes with round boundaries advance further steps per round).
        const claimed = this.inbox.claim('next-turn', turn)
        // A removed waking message still owns the initial turn boundary, but
        // it spends no runtime run.
        if (phase.step === 0 && claimed.length === 0) {
          turnEnds = { kind: 'completed' }
          return false
        }
        for (const message of claimed) {
          signal.throwIfAborted()
          const step = phase.step + 1
          this.session.append('step/start', { turn, step })
          phase.step = step
          try {
            this.session.append('user/message', message, { surfaceOp: 'append' })
            const stepEnd = await this.runStep(turn, step, message, signal, (nextStep) => {
              // A runtime that reports per-round boundaries (Pi's
              // message_start) gets one DSH step per model round: close the
              // round that just settled and open the next one. `phase.step`
              // is read here and in the finally — it advances per round.
              this.session.append('step/end', { turn, step: phase.step })
              phase.step = nextStep
              this.session.append('step/start', { turn, step: nextStep })
            })
            // A later completed step must not downgrade an aborted outcome.
            // (The cast re-widens: assignments narrow turnEnds to the last
            // step's exact reason across loop iterations.)
            if ((turnEnds as TurnEndReason | null)?.kind !== 'aborted') turnEnds = stepEnd
          } finally {
            this.session.append('step/end', { turn, step: phase.step })
          }
          signal.throwIfAborted()
        }
        // Steering or follow-ups queued while runs executed claim next.
        if (this.inbox.hasPending) continue
        break
      }
    } catch (error: unknown) {
      // A cause is present exactly while the signal is aborted.
      const cause = abortedCancelCause(signal)
      if (cause !== undefined) {
        turnEnds = { kind: 'aborted', reason: cause }
        throw error
      }
      // Every failure is structured: an `LlmError` keeps its facts, anything
      // else flattens to `errorChain` text under the `UNKNOWN` code.
      turnEnds = {
        kind: 'error',
        error: error instanceof LlmError
          ? error.failure
          : { message: errorChain(error), code: 'UNKNOWN' },
      }
      this.throwError(error)
    } finally {
      try {
        this.session.append('turn/end', { turn, reason: turnEnds! })
      } catch (error: unknown) {
        this.throwError(error)
      }
    }
    if (!this.inbox.hasPending) return false
    phase.abort = new AbortController()
    // A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.
    phase.wakeRequested = false
    phase.step = 0
    return true
  }

  /**
   * Run one claimed message through the adapter and bridge the normalized
   * event stream into durable session events. Runtimes that report per-round
   * boundaries (`message_started`, e.g. Pi) settle one DSH step per model
   * round through `advanceRound`; runtimes without the signal keep one step
   * for the whole run. Resolves `'completed'` when the runtime settled;
   * throws on abort (mapped by the turn) or failure (settling the attempt).
   */
  private async runStep(
    turn: number,
    firstStep: number,
    message: UserMessage,
    signal: AbortSignal,
    advanceRound: (nextStep: number) => void,
  ): Promise<Extract<TurnEndReason, { kind: 'completed' }>> {
    const text = extractText(message)
    if (!this.adapterStarted) {
      await this.driverOptions.adapter.start()
      this.adapterStarted = true
    }
    let accumulator = new AssistantStreamAccumulator()
    let assembler = new BlockAssembler()
    const callSeqs = new Map<string, SessionSeq>()
    const round = { step: firstStep }
    let deltaKind: 'text' | 'thinking' | undefined
    let deltaIndex = -1
    let roundHasContent = false
    const resetRound = (): void => {
      accumulator = new AssistantStreamAccumulator()
      assembler = new BlockAssembler()
      deltaKind = undefined
      deltaIndex = -1
      roundHasContent = false
    }
    const pushChunk = (chunk: StreamChunk): void => {
      roundHasContent = true
      accumulator.push({ time: Date.now(), chunk })
      assembler.push(chunk)
    }
    const unsubscribe = this.driverOptions.adapter.subscribe((event) => {
      switch (event.type) {
        case 'message_delta': {
          if (deltaKind !== event.kind) {
            deltaKind = event.kind
            deltaIndex += 1
          }
          pushChunk(event.kind === 'text'
            ? { type: 'text-delta', index: deltaIndex, text: event.delta }
            : { type: 'reasoning-delta', index: deltaIndex, text: event.delta })
          return
        }
        case 'message_started': {
          // A new model round begins. Settle the round that produced
          // content, then advance into a fresh step for the new round. An
          // empty round (boundary with no deltas) spends no extra step.
          if (!roundHasContent) return
          this.settleCompleted(turn, round.step, accumulator, assembler)
          resetRound()
          round.step += 1
          advanceRound(round.step)
          return
        }
        case 'tool_started': {
          const call = this.session.append('tool/call', {
            turn,
            step: round.step,
            callId: ToolCallId(event.toolCallId),
            name: event.toolName,
            arguments: JSON.stringify(event.args ?? {}),
          })
          callSeqs.set(event.toolCallId, call.seq)
          return
        }
        case 'tool_finished': {
          const callSeq = callSeqs.get(event.toolCallId)
          this.session.append('tool/result', {
            turn,
            step: round.step,
            message: createToolResultMessage({
              callId: ToolCallId(event.toolCallId),
              content: [{ type: 'text', text: stringifyResult(event.result) }],
              isError: event.isError,
            }),
          }, {
            surfaceOp: 'append',
            ...callSeq === undefined ? {} : { sourceEventSeqs: [callSeq] },
          })
          return
        }
        case 'state_changed': {
          if (event.model !== undefined) {
            this.session.append('request/context', {
              provider: event.model.provider,
              model: event.model.modelId,
            })
          }
          return
        }
        case 'notice': {
          this.driverOptions.onNotice?.(event)
          return
        }
        default:
          return
      }
    })
    try {
      await this.driverOptions.adapter.runTurn(text, signal)
    } catch (error: unknown) {
      // Settle the delivered prefix before the failure leaves the step, the
      // same contract the React loop keeps: an abort finalizes the visible
      // prefix as an interrupted message, any other failure preserves the
      // attempt without fabricating model-visible history.
      if (signal.aborted) {
        this.settleInterrupted(turn, round.step, accumulator, assembler)
      } else {
        this.session.append('assistant/attempt', {
          turn,
          step: round.step,
          stream: [...accumulator.snapshot()] as AssistantStreamRecord[],
        })
      }
      throw error
    } finally {
      unsubscribe()
    }
    this.settleCompleted(turn, round.step, accumulator, assembler)
    return { kind: 'completed' }
  }

  /** Finalize an interrupted run's visible text prefix, if any content streamed. */
  private settleInterrupted(
    turn: number,
    step: number,
    accumulator: AssistantStreamAccumulator,
    assembler: BlockAssembler,
  ): void {
    const stream = [...accumulator.snapshot()] as AssistantStreamRecord[]
    const content = assembler.interruptedBlocks()
    if (content.length === 0) {
      this.session.append('assistant/attempt', { turn, step, stream })
      return
    }
    this.session.append('assistant/message', {
      turn,
      step,
      message: createAssistantMessage({ content, source: this.messageSource() }),
      interrupted: true,
      ...assembler.usage === undefined ? {} : { usage: assembler.usage },
      stream,
    }, { surfaceOp: 'append' })
  }

  /** Settle a completed run's assembled assistant message when it produced content. */
  private settleCompleted(
    turn: number,
    step: number,
    accumulator: AssistantStreamAccumulator,
    assembler: BlockAssembler,
  ): void {
    const content = assembler.blocks()
    if (content.length === 0) return
    this.session.append('assistant/message', {
      turn,
      step,
      message: createAssistantMessage({ content, source: this.messageSource() }),
      ...assembler.usage === undefined ? {} : { usage: assembler.usage },
      stream: [...accumulator.snapshot()] as AssistantStreamRecord[],
    }, { surfaceOp: 'append' })
  }

  /** Model attribution for assembled messages from this external runtime. */
  private messageSource(): { provider: string; model: string } {
    return {
      provider: this.options.provider ?? `external:${this.driverOptions.adapter.runtimeId}`,
      model: this.options.model ?? this.driverOptions.adapter.runtimeVersion,
    }
  }
}
