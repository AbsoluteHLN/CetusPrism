/**
 * Measuring which reasoning efforts one endpoint actually accepts.
 *
 * A profile's `reasoningEfforts` map is a promise about an endpoint: which
 * levels it offers and the spelling each one takes on the wire. Nothing in
 * the configuration can keep that promise honest, because a private gateway
 * decides for itself which efforts it takes, and the only account of that
 * decision is its own error body. This module asks the endpoint - once per
 * level, never retried - and turns the answers into the map a profile can
 * carry.
 *
 * The endpoint's own words are the best evidence available, so a refusal body
 * that enumerates the levels it takes is read as a declaration. A production
 * private gateway (Qwen over an OpenAI-compatible route) answers a refused
 * level with exactly such an enumeration - "Unsupported types are xhigh
 * (default), medium, and low" - and that sentence's polarity is loose: the
 * enumeration names the levels the endpoint takes, not the ones it refuses.
 * The enumeration is therefore read as the accepted set, and the measurement
 * settles any conflict between the two.
 *
 * The refusal classification here is deliberately its own. `stream.ts` decides
 * whether a *live* call failed because of the effort it carried, which is a
 * different question from *which* levels an endpoint takes; duplicating the
 * judgement keeps this module's contract independent of the streaming path.
 *
 * Only `openai-completions` is interrogable: it names the effort as one
 * top-level string (`reasoning_effort`), so one request per level decides one
 * level. The Responses protocols nest the same idea (`reasoning: { effort }`)
 * and are not probed here; every other protocol has no discrete effort levels
 * to ask about at all.
 *
 * @module dsh-llm-pi-ai/effort-probe
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { THINKING_LEVELS } from './catalog.ts'

/**
 * Every level this probe recognizes, in pi-ai's escalation order.
 *
 * Reused from `./catalog.ts` so that a level pi-ai adds or drops cannot leave
 * this probe asking about a spelling no profile may declare. `catalog.ts` owns
 * the word list; nothing here restates it.
 */
const LEVELS: readonly string[] = THINKING_LEVELS

/**
 * The level that means "send nothing".
 *
 * Not thinking is the absence of the `reasoning_effort` parameter, so it is
 * never a question to put to the endpoint: it is declared, and it is declared
 * `null` because there is no wire spelling for a parameter that is not sent.
 */
const OFF = 'off'

/** The one protocol whose effort spelling a single request per level can decide. */
const PROBEABLE_API = 'openai-completions'

/** The levels tried when the caller names none: pi-ai's word list minus `off`. */
const DEFAULT_CANDIDATES: readonly string[] = LEVELS.filter(level => level !== OFF)

/**
 * The smallest reply the probe asks for.
 *
 * The verdict is the status code, not the text, so the request asks for as
 * little generated output as an endpoint will produce.
 */
const PROBE_MAX_TOKENS = 8

/**
 * Largest reply body the probe reads.
 *
 * The body is only ever a diagnostic, so a reply that outgrows the ceiling is
 * cut off rather than refused: the status already decided the level.
 */
const MAX_RESPONSE_BYTES = 64 * 1024

/** Longest endpoint wording kept in a detail. */
const MAX_DETAIL_LENGTH = 400

/**
 * The phrasing that introduces the levels an endpoint takes.
 *
 * A gateway names its levels after the parameter, after a "supported types"
 * phrase, or after a "must be" phrase; the enumeration follows the last such
 * phrase in the clause, which is the one that owns the list.
 */
const ENUMERATION_ANCHOR = /\b(?:reasoning[ _-]?effort\b|(?:un)?supported\s+(?:types?|levels?|values?|efforts?)\b|(?:allowed|valid|accepted|available)\s+(?:types?|levels?|values?|efforts?)\b|must\s+be\b)/gi

/**
 * The phrasing that says the endpoint is talking about efforts at all.
 *
 * Narrower than {@link ENUMERATION_ANCHOR}: "must be" is too ordinary a phrase
 * to read a fault (a malformed request body says so too), so it is left out
 * of the test that decides whether a failure is about the level.
 */
const EFFORT_ANCHOR = /\b(?:reasoning[ _-]?effort\b|(?:un)?supported\s+(?:types?|levels?|values?|efforts?)\b|(?:allowed|valid|accepted|available)\s+(?:types?|levels?|values?|efforts?)\b)/gi

/** A level name as a gateway spells it, for an enumeration scan. */
const LEVEL_NAME_SCAN = /\b(?:minimal|low|medium|high|xhigh|max)\b/gi

/** A level name as a gateway spells it, for a membership test. */
const LEVEL_NAME = /\b(?:minimal|low|medium|high|xhigh|max)\b/i

/** The words that name the reasoning itself, for a membership test. */
const EFFORT_WORD = /\b(?:effort|efforts|thinking|reasoning)\b/i

/** One endpoint to interrogate. */
export interface ReasoningEffortProbeRequest {
  /** The endpoint's base URL; the chat-completions path is appended to it. */
  baseURL: string
  /** The wire protocol; only `openai-completions` has probeable levels. */
  api?: string
  /** The endpoint-facing model id: the profile's `id`, not its display name. */
  model: string
  /** A one-shot credential; it is never stored and never named in a message. */
  apiKey?: string
  /**
   * Deployment headers the route carries, such as a gateway that authenticates
   * through its own header rather than a bearer key. They ride along with
   * every probe request; a credential still wins over a deployment header of
   * the same name.
   */
  headers?: Readonly<Record<string, string>>
  /** Caller cancellation; an abort ends the probe with an `ABORTED` error. */
  signal?: AbortSignal
  /** The levels to try; the whole word list minus `off` when absent. */
  candidates?: readonly string[]
}

/** What one level's request decided. */
export interface ReasoningEffortProbeOutcome {
  /** The level this outcome describes. */
  level: string
  /** Whether the endpoint accepted it, which is a 2xx status and nothing else. */
  accepted: boolean
  /** The endpoint's own wording, or the note that the failure was not about the level. */
  detail?: string
}

/** A failure that is not about the levels themselves. */
export interface ReasoningEffortProbeFault {
  /** The stable machine code every such failure carries. */
  code: string
  /** The HTTP status observed, when the endpoint answered at all. */
  status?: number
  /** What went wrong, in the operator's terms. */
  reason: string
}

/** What the endpoint accepts, and the declaration a profile can carry. */
export interface ReasoningEffortProbeResult {
  /**
   * The accepted levels, in the word list's escalation order.
   *
   * `off` is never among them: not thinking is the absence of the parameter,
   * so it is declared rather than accepted. A level the endpoint enumerated but
   * that was never asked about is among them, on the endpoint's own word.
   */
  accepted: readonly string[]
  /** The refused levels, each with the endpoint's own wording. */
  refused: readonly { level: string; detail: string }[]
  /** The levels the endpoint enumerated for itself, when a refusal body carried one. */
  declared?: readonly string[]
  /** The map a profile's `reasoningEfforts` can carry; `off` is always `null`. */
  declaration: Readonly<Record<string, string | null>>
  /** One entry per level that was asked about. */
  outcomes: readonly ReasoningEffortProbeOutcome[]
  /** The failure that is not about the levels, when one happened. */
  fault?: ReasoningEffortProbeFault
}

/** One probed level, before the conflicts are noted. */
interface ProbeRecord {
  /** The level that was asked about. */
  level: string
  /** Whether the endpoint accepted it. */
  accepted: boolean
  /** The endpoint's own wording, or the note that the failure was not about the level. */
  detail?: string
  /** Whether the endpoint's answer was about the effort at all. */
  effort: boolean
  /** The status the endpoint answered with. */
  status: number
}

/**
 * Order levels by the word list, keeping any name the word list does not know.
 * @param levels - the levels to order; duplicates collapse.
 * @returns the levels in escalation order, unknown names last.
 */
function orderedLevels(levels: Iterable<string>): string[] {
  const present = new Set(levels)
  const known = LEVELS.filter(level => present.has(level))
  const unknown = [...present].filter(level => !LEVELS.includes(level))
  return [...known, ...unknown]
}

/**
 * The levels to ask about: without duplicates, without `off`, in word order.
 * @param candidates - the levels the caller named.
 * @returns the levels to put to the endpoint.
 */
function candidateLevels(candidates: readonly string[]): string[] {
  return orderedLevels(candidates.filter(level => level !== OFF))
}

/**
 * Whether a name is one level of pi-ai's word list.
 *
 * `off` is excluded: it is the absence of the parameter, never a level an
 * endpoint enumerates.
 * @param name - the name to judge.
 * @returns true when the name is a probeable level.
 */
function isKnownLevel(name: string): boolean {
  const lowered = name.toLowerCase()
  return lowered !== OFF && LEVELS.includes(lowered)
}

/**
 * Whether the text between two level names reads as a list separator.
 *
 * A gateway separates its entries with punctuation, with "and", and sometimes
 * with an annotation in parentheses ("xhigh (default)"), so the annotation is
 * stripped before the remainder is judged: anything else - a sentence, a
 * second clause - means the two names are not one list.
 * @param gap - the text between the two names.
 * @returns true when the two names belong to the same list.
 */
function isListGap(gap: string): boolean {
  const stripped = gap.replace(/\([^()]*\)/g, ' ')
  return /^[\s,;/&|"'`.\-]*(?:(?:and|or)\b[\s,;/&|"'`.\-]*)?$/i.test(stripped)
}

/**
 * The longest run of level names joined by list separators.
 * @param text - the text that follows an enumeration phrase.
 * @returns the names of the longest run, in the order they appear.
 */
function longestNameRun(text: string): string[] {
  const matches = [...text.matchAll(LEVEL_NAME_SCAN)]
  let best: string[] = []
  let run: string[] = []
  let previousEnd = 0
  for (const match of matches) {
    const name = match[0].toLowerCase()
    const gap = text.slice(previousEnd, match.index)
    run = run.length > 0 && isListGap(gap) ? [...run, name] : [name]
    if (run.length > best.length) best = run
    previousEnd = match.index + match[0].length
  }
  return best
}

/**
 * The end of the last enumeration phrase in a clause.
 * @param clause - one clause of an endpoint message.
 * @returns the index just past that phrase, or `undefined` when it carries none.
 */
function lastAnchorEnd(clause: string): number | undefined {
  let end: number | undefined
  for (const match of clause.matchAll(ENUMERATION_ANCHOR)) end = match.index + match[0].length
  return end
}

/**
 * The levels an endpoint says it takes, read from its own wording.
 *
 * A single name is never a declaration: a refusal body routinely names the one
 * level it rejected, and reading that as an offer would invert the answer.
 * @param text - the endpoint's message.
 * @returns the enumerated levels, empty when it enumerates none.
 */
function declaredLevels(text: string): string[] {
  let best: string[] = []
  for (const clause of text.split(/[.;!?\n]+/u)) {
    const anchorEnd = lastAnchorEnd(clause)
    if (anchorEnd === undefined) continue
    const run = longestNameRun(clause.slice(anchorEnd))
    if (run.length >= 2 && run.length > best.length) best = run
  }
  return best
}

/**
 * Whether the endpoint is talking about efforts at all.
 *
 * A failure that says nothing about efforts is not about the level: it is a
 * credential problem, a wrong path, or a broken gateway, and the level it
 * answered for was never judged.
 * @param text - the endpoint's message.
 * @returns true when the message is about the effort.
 */
function mentionsEffort(text: string): boolean {
  if (text.matchAll(EFFORT_ANCHOR).next().done === false) return true
  if (declaredLevels(text).length >= 2) return true
  return LEVEL_NAME.test(text) && EFFORT_WORD.test(text)
}

/**
 * Every level array a JSON body carries.
 *
 * A gateway that reports its levels as data says so exactly; the scan is
 * bounded in depth so a deep document cannot turn the probe into a walk.
 * @param value - the parsed body.
 * @param depth - how deep the walk has already gone.
 * @returns the levels such an array names.
 */
function structuredLevels(value: unknown, depth = 0): string[] {
  if (depth > 8) return []
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === 'string')
    if (strings.length === value.length && strings.length >= 2 && strings.every(isKnownLevel)) {
      return strings.map(name => name.toLowerCase())
    }
    return value.flatMap(item => structuredLevels(item, depth + 1))
  }
  if (value === null || typeof value !== 'object') return []
  const fields = Object.values(value as Record<string, unknown>)
  return fields.flatMap(item => structuredLevels(item, depth + 1))
}

/**
 * One string field of an object, or `undefined` when it is absent or not a string.
 * @param value - the object to read.
 * @param key - the field to read.
 * @returns the field's text.
 */
function stringField(value: unknown, key: string): string | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

/**
 * The human-readable part of an error body.
 * @param parsed - the parsed body, or `undefined` when it is not JSON.
 * @returns the endpoint's own wording, empty when it carries none.
 */
function errorMessage(parsed: unknown): string {
  if (parsed === undefined) return ''
  if (typeof parsed === 'string') return parsed
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const record = parsed as Record<string, unknown>
  const error = record['error']
  const nested = error !== null && typeof error === 'object' && !Array.isArray(error)
    ? stringField(error, 'message')
    : undefined
  if (nested !== undefined) return nested
  if (typeof error === 'string') return error
  return stringField(record, 'message') ?? stringField(record, 'detail') ?? stringField(record, 'msg') ?? ''
}

/**
 * The levels one refusal body declares.
 *
 * The structured form wins when the body carries one: a gateway that reports
 * its levels as data is exact about them, where the prose form has to be read.
 * @param parsed - the parsed body, or `undefined` when it is not JSON.
 * @param body - the raw body.
 * @returns the levels the body declares.
 */
function readDeclared(parsed: unknown, body: string): string[] {
  if (parsed !== undefined) {
    const structured = structuredLevels(parsed)
    if (structured.length >= 2) return structured
  }
  return declaredLevels(parsed === undefined ? body : errorMessage(parsed))
}

/**
 * Cut a diagnostic to a readable length.
 * @param text - the text to keep.
 * @returns the text, on one line, truncated with an ellipsis when it is long.
 */
function truncate(text: string): string {
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  if (collapsed.length <= MAX_DETAIL_LENGTH) return collapsed
  return `${collapsed.slice(0, MAX_DETAIL_LENGTH)}...`
}

/**
 * Read a reply body, bounded.
 *
 * The probe asks for a handful of tokens and reads at most a ceiling's worth
 * of an error body; a body that outgrows it is cut off rather than refused,
 * because the status already decided the level. A body that fails mid-read is
 * still a body: the diagnostic is what was read before the failure.
 * @param response - the reply to read.
 * @returns the text read so far.
 */
async function readBounded(response: Response): Promise<string> {
  const stream = response.body
  if (stream === null) return ''
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      text += decoder.decode(value, { stream: true })
      if (bytes > MAX_RESPONSE_BYTES) break
    }
    text += decoder.decode()
  } catch {
    // A body that fails mid-read is still a body: the status already decided
    // the level, so the diagnostic is what was read before the failure.
  } finally {
    await reader.cancel().catch(() => {
      // Cancelling a drained or an abandoned read is cleanup, not a failure.
    })
  }
  return text
}

/**
 * Join the endpoint base with the chat-completions path.
 *
 * The base is treated as a prefix rather than a URL to resolve against, so a
 * deployment path such as `https://gateway.example/openai/v1` keeps its
 * segments instead of losing them to `URL` resolution.
 * @param baseURL - the endpoint's base URL.
 * @returns the URL one probe request goes to.
 */
function completionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/u, '')}/chat/completions`
}

/**
 * Accept one supplied credential, or refuse it before the header is built.
 *
 * Without this the `fetch` below would throw a ByteString `TypeError` that
 * this function's catch reports as an unreachable endpoint, blaming the
 * network for a local, deterministic fault. The key itself never appears in
 * the message.
 * @param raw - the key the caller supplied.
 * @returns the trimmed, usable key.
 */
function usableKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'the reasoning-effort probe\'s API key is blank; supply it or probe unauthenticated'
      : 'the reasoning-effort probe\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/**
 * The smallest request that can decide one level.
 * @param model - the endpoint-facing model id.
 * @param level - the level to ask about.
 * @returns the request body.
 */
function probeBody(model: string, level: string): Record<string, unknown> {
  return {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    reasoning_effort: level,
    max_tokens: PROBE_MAX_TOKENS,
  }
}

/**
 * What a failure that is not about the levels means.
 * @param status - the status the endpoint answered with.
 * @param excerpt - the endpoint's own wording.
 * @returns the reason, in the operator's terms.
 */
function faultReason(status: number, excerpt: string): string {
  const credential = status === 401 || status === 403 ? '; check the API key' : ''
  const said = excerpt.length === 0 ? 'it sent no explanation' : excerpt
  return `the endpoint answered ${status}${credential} - not a reasoning-effort problem: ${said}`
}

/**
 * Measure which reasoning efforts one endpoint accepts.
 *
 * Each candidate level is asked about exactly once, with the smallest request
 * that can decide it, and never retried: the endpoint's answer is the
 * evidence, and a second request would only cost another turn of its budget.
 * `off` is never asked about, because not thinking is the absence of the
 * parameter rather than a value of it.
 *
 * A level is accepted when the endpoint answered 2xx, whatever the body says:
 * a gateway that answers 200 with an error document has still taken the
 * level. A level is refused when the endpoint answered otherwise, and the
 * refusal body is read twice: once for the levels the endpoint enumerates for
 * itself, which settle the levels that were not asked about, and once for the
 * wording kept as the refusal's detail.
 *
 * A failure that says nothing about efforts - a 401, a 404, a 5xx - is not a
 * verdict about the level, and it is reported as such: every such level is
 * refused with a detail that names the fault, the result carries the fault,
 * and when no level at all could be judged the probe fails with an
 * `EFFORT_PROBE_FAILED` error rather than an empty declaration.
 *
 * The credential is a one-shot input: it is sent as a bearer token, never
 * written down, and never named in a message.
 *
 * @param request - the endpoint, protocol, model, and one-shot credential.
 * @returns the accepted levels, the refusals, and the declaration to write.
 * @throws LlmError when the protocol has no probeable levels, the credential
 *   cannot be used, the endpoint cannot be reached, every level failed for a
 *   reason that is not about the effort, or the caller cancelled the probe.
 */
export async function probeReasoningEfforts(request: ReasoningEffortProbeRequest): Promise<ReasoningEffortProbeResult> {
  const api = request.api ?? PROBEABLE_API
  if (api !== PROBEABLE_API) {
    throw new LlmError(
      `the "${api}" protocol has no discrete reasoning-effort levels this probe can interrogate;`
      + ` only "${PROBEABLE_API}" names the effort as one value that a single request can decide`,
      'EFFORT_PROBE_UNSUPPORTED',
    )
  }
  if (request.baseURL.length === 0) {
    throw new LlmError('the reasoning-effort probe needs the endpoint\'s base URL', 'EFFORT_PROBE_FAILED')
  }
  const apiKey = request.apiKey === undefined ? undefined : usableKey(request.apiKey)
  const url = completionsUrl(request.baseURL)
  const levels = candidateLevels(request.candidates ?? DEFAULT_CANDIDATES)
  const headers = new Headers(request.headers === undefined ? undefined : Object.entries(request.headers))
  headers.set('content-type', 'application/json')
  headers.set('accept', 'application/json')
  if (apiKey !== undefined) headers.set('authorization', `Bearer ${apiKey}`)
  for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)

  const probed: ProbeRecord[] = []
  const declared = new Set<string>()
  for (const level of levels) {
    if (request.signal?.aborted) throw new LlmError('reasoning-effort probe aborted by caller', 'ABORTED')
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(probeBody(request.model, level)),
        ...request.signal === undefined ? {} : { signal: request.signal },
      })
    } catch (error: unknown) {
      if (request.signal?.aborted) {
        throw new LlmError('reasoning-effort probe aborted by caller', 'ABORTED', { cause: error })
      }
      throw new LlmError(`could not reach ${url}`, 'EFFORT_PROBE_FAILED', { cause: error })
    }
    const body = await readBounded(response)
    if (request.signal?.aborted) throw new LlmError('reasoning-effort probe aborted by caller', 'ABORTED')
    if (response.ok) {
      // The status is the verdict. A gateway that answers 200 with an error
      // document has still taken the level, so the body is left unread here.
      probed.push({ level, accepted: true, effort: true, status: response.status })
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      parsed = undefined
    }
    const message = parsed === undefined ? body : errorMessage(parsed)
    const effort = mentionsEffort(message)
    const excerpt = truncate(message)
    probed.push({
      level,
      accepted: false,
      effort,
      status: response.status,
      ...effort
        ? { detail: `${response.status} ${excerpt.length === 0 ? 'refused the level' : excerpt}` }
        : { detail: faultReason(response.status, excerpt) },
    })
    if (!effort) continue
    for (const name of readDeclared(parsed, body)) declared.add(name)
  }

  const faulted = probed.filter(record => !record.effort)
  const firstFault = faulted[0]
  if (probed.length > 0 && faulted.length === probed.length) {
    // Nothing was decided about any level: the endpoint is unreachable or the
    // credential is wrong, and an empty declaration would be a lie.
    throw new LlmError(
      firstFault?.detail ?? 'the endpoint answered every level with a failure that is not about the effort',
      'EFFORT_PROBE_FAILED',
    )
  }

  const declaredLevelsInOrder = orderedLevels(declared)
  const outcomes: ReasoningEffortProbeOutcome[] = probed.map(record => {
    const listed = declaredLevelsInOrder.includes(record.level)
    if (!record.effort || listed === record.accepted) {
      return {
        level: record.level,
        accepted: record.accepted,
        ...record.detail === undefined ? {} : { detail: record.detail },
      }
    }
    const conflict = listed
      ? `the endpoint's own enumeration lists "${record.level}", yet it refused it`
      : `the endpoint accepted "${record.level}", which its own enumeration omits`
    const detail = record.detail === undefined ? conflict : `${record.detail} (${conflict})`
    return { level: record.level, accepted: record.accepted, detail }
  })

  const probedLevels = new Set(outcomes.map(outcome => outcome.level))
  const accepted = orderedLevels([
    ...outcomes.filter(outcome => outcome.accepted).map(outcome => outcome.level),
    ...declaredLevelsInOrder.filter(level => !probedLevels.has(level)),
  ])
  const refused = outcomes
    .filter(outcome => !outcome.accepted)
    .map(outcome => ({ level: outcome.level, detail: outcome.detail ?? 'the endpoint refused the level' }))
  const declaration: Record<string, string | null> = { [OFF]: null }
  for (const level of accepted) declaration[level] = level

  return {
    accepted,
    refused,
    ...declaredLevelsInOrder.length === 0 ? {} : { declared: declaredLevelsInOrder },
    declaration,
    outcomes,
    ...firstFault === undefined
      ? {}
      : {
        fault: {
          code: 'EFFORT_PROBE_FAILED',
          status: firstFault.status,
          reason: firstFault.detail ?? 'the endpoint answered with a failure that is not about the effort',
        },
      },
  }
}
