/**
 * pi-ai assistant event translation into the Harness streaming protocol.
 *
 * pi-ai tool-call arguments are parsed objects while the Harness keeps their
 * raw JSON representation. pi-ai also reports failures as terminal stream
 * events, which this module maps into Harness finish chunks.
 *
 * @module dsh-llm-pi-ai/stream
 */

import { brandString } from '@deepseek-ai/dsh-brand'
import { CONTEXT_WINDOW_EXCEEDED_CODE, DEVELOPER_ROLE_REJECTED_CODE, EMPTY_RESPONSE_CODE, isContextWindowExceededError, isDeveloperRoleRejectedError, isQuotaExceededError, LlmError, QUOTA_EXCEEDED_CODE, REASONING_EFFORT_REJECTED_CODE } from '@deepseek-ai/dsh-llm'
import type { FinishReason, StreamChunk, TokenUsage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { isContextOverflow } from '@earendil-works/pi-ai/utils/overflow'
import type { AssistantMessage, AssistantMessageEvent, Usage as PiUsage } from '@earendil-works/pi-ai'
import { toPiReplayState } from './replay.ts'

/**
 * Map pi-ai usage (reasoning folded into output by pi-ai).
 * @param usage - cumulative usage from the terminal pi-ai event.
 * @returns harness counts with pi-ai's exact total; cache fields appear only
 *   when non-zero (pi-ai reports zeros, not absence).
 */
export function mapUsage(usage: PiUsage): TokenUsage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    totalTokens: usage.totalTokens,
    ...usage.cacheRead > 0 ? { cacheReadTokens: usage.cacheRead } : {},
    ...usage.cacheWrite > 0 ? { cacheWriteTokens: usage.cacheWrite } : {},
    // pi-ai reports the reasoning share of the output separately. Without this
    // the harness vocabulary has no field for it, and every reasoning call
    // reports its reasoning tokens as plain output — which no later reader can
    // tell apart, because usage is published once and never replayed.
    ...usage.reasoning !== undefined && usage.reasoning > 0 ? { reasoningTokens: usage.reasoning } : {},
  }
}

// XXX(pi-ai upstream): pi-ai flattens the caught error to `error.message`
// (api/anthropic-messages.js: `errorMessage = error instanceof Error ?
// error.message : JSON.stringify(error)`), discarding the original Error and its
// `cause` chain before it reaches us. undici carries the actionable transport
// detail on `cause` (e.g. `SocketError: other side closed`) but hands the fetch
// wrapper a bare `terminated`, so we are left pattern-matching terse words here.
// If pi-ai ever forwards the original Error (or a fetch/dispatcher hook that lets
// us capture the cause ourselves), classify on `code`/`cause` instead of text.
/**
 * The phrase a gateway uses when the reasoning effort is what it refuses.
 */
const EFFORT_PHRASE = /\breasoning[ _-]effort\b/i

/**
 * Wording that refuses outright: the gateway states the effort is not one it
 * takes, in any order around the phrase.
 */
const EFFORT_REFUSAL = /\b(?:unexpected|unsupported|not\s+supported|unknown|unrecognized|not\s+allowed)\b/i

/**
 * The levels a route declares, as a gateway would name them.
 *
 * A gateway that enumerates the levels it takes has already refused the one
 * that was sent, whatever words it wraps the list in — "must be low, high,
 * xhigh, max" is the phrasing a private gateway used, and it carries no
 * refusal word at all.
 */
const EFFORT_LEVEL = /\b(?:minimal|low|medium|high|xhigh|max)\b/i

/** How far from the phrase the evidence may sit, in characters. */
const EFFORT_WINDOW = 48

/**
 * Whether the text refuses the reasoning effort that was sent.
 *
 * Two ways to read a refusal, and only two:
 *
 * - The gateway refuses it outright, naming the effort and saying it does
 *   not take it.
 * - The gateway enumerates the levels it takes, which refuses the level
 *   that was sent whatever introduces the list.
 *
 * The evidence has to sit next to the phrase. A rejected request's body
 * carries its own machine code — `invalid_request_error` on most gateways —
 * and a word from that code must not be read as a refusal of the effort.
 *
 * @param message - the provider's error text.
 * @returns true when the text refuses a reasoning effort.
 */
function refusesReasoningEffort(message: string): boolean {
  const match = EFFORT_PHRASE.exec(message)
  if (match === null) return false
  const start = Math.max(0, match.index - EFFORT_WINDOW)
  const window = message.slice(start, match.index + match[0].length + EFFORT_WINDOW)
  return EFFORT_REFUSAL.test(window) || EFFORT_LEVEL.test(window)
}

function classifyPiAiError(message: string): string {
  if (/\b(?:401|403)\b/.test(message)) return 'AUTH'
  // pi-ai's own wording when a route reaches its provider without a key. The
  // outcome is terminal either way; the code is what tells the operator that a
  // credential is missing rather than the request being bad.
  if (/no api key for provider/i.test(message)) return 'MISSING_CREDENTIAL'
  if (isQuotaExceededError(message)) return QUOTA_EXCEEDED_CODE
  if (/\b429\b|rate.?limit/i.test(message)) return 'RATE_LIMIT'
  // A gateway that refuses the `developer` role rejects the request as a
  // malformed one, so it arrives here as a plain `400`. Classifying it apart
  // from every other rejected request is what lets the operator see which
  // configuration line fixes it.
  if (isDeveloperRoleRejectedError(message)) return DEVELOPER_ROLE_REJECTED_CODE
  // A gateway that refuses the reasoning effort names the level it got and
  // the set it takes. The request is well formed and the model is willing —
  // the route's own effort declaration is what the endpoint rejected, so the
  // code is what tells the operator which field to change.
  if (refusesReasoningEffort(message)) return REASONING_EFFORT_REJECTED_CODE
  // A rejected request body (gateway or provider size cap): resending the
  // same request cannot succeed, so it is invalid, not transient.
  if (/\b413\b|failed to buffer the request body:\s*length limit exceeded|payload too large|request body too large/i.test(message)) return 'INVALID_REQUEST'
  if (/\b400\b|invalid.?request/i.test(message)) return 'INVALID_REQUEST'
  if (/\b5\d\d\b/.test(message)) return 'SERVER'
  // 408 is the endpoint stating it gave up waiting for the request: the
  // request may still be running there, so it is transient rather than
  // rejected, and the retry budget is what answers it.
  if (/\b408\b/.test(message)) return 'TIMEOUT'
  if (/\btime(?:d)?\s*out\b|timeout/i.test(message)) return 'TIMEOUT'
  // A stream truncated before the provider's terminal event: each pi-ai provider
  // throws its own wording when the wire closes mid-response without a terminal
  // event (`… stream ended before message_stop`, `… before a terminal response
  // event`, `… ended without a terminal event`, `Stream ended without
  // finish_reason`). The connection dropped mid-response, so this is a transport
  // truncation, not a model-level error.
  if (/stream ended (?:before|without)\b/i.test(message)) return 'TRANSPORT'
  if (/\b(?:network|connection|socket|fetch)\b|\bECONN[A-Z]+\b/i.test(message)
    || /\b(?:other side closed|HTTP2 request did not get a response|WebSocket closed unexpectedly)\b/i.test(message)
    // undici renders a mid-stream socket drop as a bare `terminated` (its
    // `cause` — the real SocketError — was flattened away upstream); Node's
    // stream layer says `Premature close`.
    || /\bterminated\b|premature close/i.test(message)) {
    return 'TRANSPORT'
  }
  return 'PI_AI_ERROR'
}

/**
 * Map a terminal pi-ai event to the harness finish reason.
 * @param message - the assistant message carried by the `done` or `error` event.
 * @param contextWindow - resolved catalog capacity for usage-based overflow detection.
 * @returns the mapped harness reason. Recognized error text, `stop` usage above
 *   `contextWindow`, and zero-output `length` usage that fills the window map
 *   to `CONTEXT_WINDOW_EXCEEDED`; a `stop` with no content blocks maps to an
 *   `EMPTY_RESPONSE` error, while terminal `pending` and `deferred` states map
 *   to non-retryable `PI_AI_ERROR` failures.
 */
export function mapStopReason(message: AssistantMessage, contextWindow?: number): FinishReason {
  const piAiOverflow = isContextOverflow(message, contextWindow)
  const harnessOverflow = message.stopReason === 'error'
    && message.errorMessage !== undefined
    && isContextWindowExceededError(message.errorMessage)
  if (piAiOverflow || harnessOverflow) {
    return {
      kind: 'error',
      failure: {
        message: message.errorMessage ?? `pi-ai detected context overflow for model "${message.model}"`,
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    }
  }

  switch (message.stopReason) {
    case 'stop':
      // A terminal stop that produced no content blocks is a degenerate
      // provider completion, not a successful (empty) assistant message.
      if (message.content.length === 0) {
        return {
          kind: 'error',
          failure: {
            message: `model "${message.model}" returned a completed response with no content`,
            code: EMPTY_RESPONSE_CODE,
          },
        }
      }
      return { kind: 'stop' }
    case 'length': return { kind: 'max-tokens' }
    case 'toolUse': return { kind: 'tool-calls' }
    case 'pending': return {
      kind: 'error',
      failure: { message: `pi-ai stream for model "${message.model}" ended pending`, code: 'PI_AI_ERROR' },
    }
    case 'deferred': return {
      kind: 'error',
      failure: { message: `pi-ai deferred response for model "${message.model}" is not supported`, code: 'PI_AI_ERROR' },
    }
    case 'aborted': return {
      kind: 'aborted',
      failure: { message: message.errorMessage ?? 'pi-ai stream aborted', code: 'ABORTED' },
    }
    case 'error': {
      const text = message.errorMessage ?? 'pi-ai stream error'
      const code = classifyPiAiError(text)
      return {
        kind: 'error',
        failure: {
          message: code === DEVELOPER_ROLE_REJECTED_CODE
            ? developerRoleGuidance(text)
            : code === REASONING_EFFORT_REJECTED_CODE ? reasoningEffortGuidance(text) : text,
          code,
        },
      }
    }
  }
}

/**
 * Restate a rejected message role as the configuration change that fixes it.
 *
 * The provider's own wording names the role but not the switch, so an
 * operator reading only the error sees a rejected request and no way to
 * repair it. The repair is one line on the route, and the endpoint's own
 * detection is what made it necessary, so the guidance names both.
 *
 * A gateway that refuses a role without naming it is the harder case: the
 * harness sends the system prompt as `developer` wherever the endpoint
 * detection resolves the route as OpenAI, so that is the likely role — but
 * the wording does not say so, and the guidance must not claim it does.
 *
 * @param detail - the provider's rejection text.
 * @returns the message with the corrective configuration appended.
 */
function developerRoleGuidance(detail: string): string {
  // The provider named the role: the repair follows from the wording alone.
  if (/\bdeveloper\b/i.test(detail)) {
    return `${detail} — this endpoint rejects the \`developer\` role, which the reasoning model sends for its`
      + ' system prompt. Set `compat.supportsDeveloperRole: false` on this provider route (or on the model entry)'
      + ' so the system prompt travels as `system`.'
  }
  return `${detail} — the endpoint refused a message role. When the system prompt travels as the \`developer\` role,`
    + ' set `compat.supportsDeveloperRole: false` on this provider route (or on the model entry) so it travels as `system`.'
}

/**
 * Restate a refused reasoning effort as the configuration change that fixes it.
 *
 * The endpoint names the level it got and the levels it takes, so the
 * operator already knows the fact; what the wording does not say is which
 * configuration line decides that level. The route's `reasoningEfforts`
 * declaration does, and it is where the fix belongs — an effort the endpoint
 * rejects is a level the route should not be sending.
 *
 * @param detail - the provider's rejection text.
 * @returns the message with the corrective configuration appended.
 */
function reasoningEffortGuidance(detail: string): string {
  return `${detail} — the endpoint refused this reasoning effort. The route's \`reasoningEfforts\` declaration lists`
    + ' the levels pi-ai sends; set it to the levels this endpoint accepts.'
}

/**
 * Translate the pi-ai event stream into StreamChunks. pi-ai never throws
 * mid-stream — failures arrive as `error` events, which become error/aborted
 * `finish` chunks (the harness protocol's other error-delivery style).
 * @param events - one assistant turn's pi-ai event stream.
 * @param contextWindow - resolved catalog capacity for usage-based overflow detection.
 * @param callerSignal - caller cancellation state; an aborted caller makes any
 *   in-band terminal error an aborted finish.
 * @param requestedModel - request model identity recorded for durable replay.
 * @returns the harness chunks, ending with `usage` then `finish`; throws
 *   `LlmError` (`STREAM_CLOSED`) if the source ends without a terminal event.
 */
export async function* toStreamChunks(
  events: AsyncIterable<AssistantMessageEvent>,
  contextWindow?: number,
  callerSignal?: AbortSignal,
  requestedModel?: string,
): AsyncGenerator<StreamChunk> {
  // pi-ai contentIndex ↔ our block index map 1:1 (both count blocks from 0
  // in stream order), but we track ids per index for tool calls.
  const toolIds = new Map<number, { id: string; name: string }>()

  for await (const event of events) {
    switch (event.type) {
      case 'start':
        break
      case 'text_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'text' }
        break
      case 'text_delta':
        yield { type: 'text-delta', index: event.contentIndex, text: event.delta }
        break
      case 'text_end':
        yield { type: 'block-end', index: event.contentIndex, block: { type: 'text', text: event.content } }
        break
      case 'thinking_start':
        yield { type: 'block-start', index: event.contentIndex, blockType: 'reasoning' }
        break
      case 'thinking_delta':
        yield { type: 'reasoning-delta', index: event.contentIndex, text: event.delta }
        break
      case 'thinking_end':
        yield { type: 'block-end', index: event.contentIndex, block: { type: 'reasoning', text: event.content } }
        break
      case 'toolcall_start': {
        // The id/name live on the partial's content at this index.
        const partial = event.partial.content[event.contentIndex]
        const id = partial?.type === 'toolCall' ? partial.id : ''
        const name = partial?.type === 'toolCall' ? partial.name : ''
        toolIds.set(event.contentIndex, { id, name })
        yield { type: 'block-start', index: event.contentIndex, blockType: 'tool-call' }
        break
      }
      case 'toolcall_delta': {
        const known = toolIds.get(event.contentIndex)
        yield {
          type: 'tool-call-delta',
          index: event.contentIndex,
          id: brandString<ToolCallId>(known?.id ?? ''),
          ...known?.name !== undefined && known.name.length > 0 ? { name: known.name } : {},
          argumentsDelta: event.delta,
        }
        break
      }
      case 'toolcall_end':
        yield {
          type: 'block-end',
          index: event.contentIndex,
          block: {
            type: 'tool-call',
            id: brandString<ToolCallId>(event.toolCall.id),
            name: event.toolCall.name,
            // pi-ai hands back the PARSED arguments; the harness vocabulary
            // keeps the raw string.
            arguments: JSON.stringify(event.toolCall.arguments),
          },
        }
        break
      case 'done':
        yield { type: 'usage', usage: mapUsage(event.message.usage) }
        yield {
          type: 'finish',
          reason: mapStopReason(event.message, contextWindow),
          replayState: toPiReplayState(event.message, requestedModel),
        }
        return
      case 'error':
        // In-stream error delivery (pi-ai's style) → error finish chunk
        // (the harness's other sanctioned error path besides throwing).
        yield { type: 'usage', usage: mapUsage(event.error.usage) }
        yield {
          type: 'finish',
          reason: mapStopReason(
            callerSignal?.aborted ? { ...event.error, stopReason: 'aborted' } : event.error,
            contextWindow,
          ),
        }
        return
      // no default: AssistantMessageEvent is pi-ai's closed union; a new
      // event type should fail compilation here via tsc's exhaustiveness
      // when one is added (switch covers all current variants).
    }
  }
  throw new LlmError('pi-ai event stream ended without done/error', 'STREAM_CLOSED')
}
