/**
 * Answering "which models can this provider serve?" for the configuration
 * surface's "fetch available models" action.
 *
 * A route with a baseURL is interrogated **over the wire first**: the endpoint
 * is what actually serves the route, and a live listing is the only answer that
 * reflects models added after this build shipped. The installed pi-ai catalog
 * is the fallback, not the answer: it fills in when the endpoint cannot be
 * reached or does not answer with a readable listing (the installed entries
 * carry the capacities a failed listing leaves unknown), and it is the whole
 * answer only for a route the configuration gives no endpoint for. An
 * authentication refusal never falls back — a wrong key must stay loud, not
 * silently serve the stale catalog.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `cordis.patch.yml` remains the only
 * thing that decides what a route serves.
 *
 * OpenAI-compatible and Anthropic Messages protocols are interrogated through
 * their native model-listing endpoints. The parser accepts the standard
 * `data` array and the enriched `models` map some compatible gateways expose;
 * when a reply carries both, the array defines the rows and the map donates
 * the capacities its entries nest. Every other protocol reports that it cannot
 * be interrogated so the surface falls back to hand-entry rather than guessing
 * its response fields.
 *
 * @module dsh-llm-pi-ai/discovery
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryOperation, ModelModality } from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { catalogModels } from './catalog.ts'

/**
 * Protocols whose model listing this module can read. OpenAI protocols use
 * bearer auth at `GET {baseURL}/models`; Anthropic Messages uses `x-api-key`
 * and `anthropic-version` at its native `GET /v1/models`. Azure is absent
 * despite its OpenAI lineage — it authenticates with an `api-key` header and
 * requires an `api-version` query — and Codex authenticates through OAuth;
 * guessing at either would report an authentication failure as a provider
 * with no models. pi-ai's remaining protocols are absent for the same reason.
 */
const LISTABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
])

/** Stable API version required by Anthropic's model-listing endpoint. */
const ANTHROPIC_VERSION = '2023-06-01'

/** Largest model-list page accepted by Anthropic's public endpoint; discovery reads one page and does not follow `has_more`. */
const ANTHROPIC_MODEL_LIMIT = 1000

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the user typed, so the ceiling holds on the bytes actually read rather than
 * on the length the server claims — the same two-stage shape `dsh-web-fetch`
 * uses for its own caller-supplied URLs, except that a truncated model listing
 * is not parseable, so overflow rejects instead of truncating.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** Capacity fields nested by enriched model-directory replies. */
interface ListingLimit {
  context?: unknown
  output?: unknown
}

/** Per-route capacities OpenRouter nests under each entry. */
interface ListingTopProvider {
  max_completion_tokens?: unknown
}

/** Modality vocabulary OpenRouter nests under each entry. */
interface ListingArchitecture {
  input_modalities?: unknown
}

/** One entry of a supported `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the official listings. */
  name?: unknown
  display_name?: unknown
  displayName?: unknown
  contextWindow?: unknown
  context_window?: unknown
  context_length?: unknown
  max_input_tokens?: unknown
  maxOutputTokens?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
  maxTokens?: unknown
  limit?: ListingLimit | null
  top_provider?: ListingTopProvider | null
  architecture?: ListingArchitecture | null
  input_modalities?: unknown
  inputModalities?: unknown
}

/** The modalities an entry declares, or `undefined` when it names none or names an unknown one. */
function declaredModalities(...candidates: readonly unknown[]): ModelModality[] | undefined {
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    const modalities = candidate.filter((value): value is ModelModality =>
      value === 'text' || value === 'image')
    // A list naming only unknown modalities states nothing this vocabulary can
    // carry; an empty list is the same. Either way the next source answers.
    if (modalities.length > 0) return modalities
  }
  return undefined
}

/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * Join the endpoint base with the protocol's listing path. The base is
 * treated as a prefix rather than a URL to resolve against, so a deployment
 * path such as `https://gateway.example/openai/v1` keeps its segments instead
 * of losing them to `URL` resolution. OpenAI protocols list at
 * `{baseURL}/models`. Anthropic lists at `{root}/v1/models`, where the root is
 * the base without trailing slashes and without one trailing `/v1` segment:
 * gateway documentation publishes both spellings of the same root. Only this
 * listing URL normalizes that segment; model requests receive the configured
 * `baseURL` unchanged.
 */
function listingUrl(baseURL: string, api: string): string {
  const base = baseURL.replace(/\/+$/, '')
  if (api !== 'anthropic-messages') return `${base}/models`
  const root = base.endsWith('/v1') ? base.slice(0, -3) : base
  return `${root}/v1/models?limit=${String(ANTHROPIC_MODEL_LIMIT)}`
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from
      // an oversized one, is cleanup; the reply is already decided either way.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Read one supported model-listing reply. The standard `data` array takes
 * precedence when both supported formats are present, and a nested `models`
 * map then donates the capacities its entries carry: each data row fills its
 * blanks from the map entry under the same id, so a gateway that enriches only
 * the map still yields complete rows. A reply with no `data` array is read as
 * the `models` map itself, using each property key as the endpoint-facing id;
 * its nested `id` is only a fallback for an empty key because gateways may put
 * a canonical model identity there instead of the alias they accept on
 * requests. Only object-valued map entries are models; primitive properties
 * are ignored because they may be directory metadata rather than model records.
 *
 * Entries without a usable id are skipped rather than failing the whole
 * interrogation: a single malformed row should not deny the user the rest of
 * a working endpoint's catalog. Missing names fall back to the adopted id so
 * the Web form receives a complete human-readable row.
 */
function readListing(body: unknown): LlmDiscoveredModel[] {
  const listing = body as { data?: unknown; models?: unknown } | null
  const data = listing?.data
  const models = listing?.models
  if (!Array.isArray(data) && (models === null || typeof models !== 'object' || Array.isArray(models))) {
    throw new LlmError(
      'the endpoint\'s model listing has neither a "data" array nor a "models" object; '
      + 'enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  let listed: { readonly key?: string; readonly raw: unknown }[] = []
  if (Array.isArray(data)) {
    const rows = data as readonly unknown[]
    listed = rows.map(raw => ({ raw }))
  } else if (models !== null && typeof models === 'object' && !Array.isArray(models)) {
    listed = Object.entries(models as Record<string, unknown>)
      .filter(([, raw]) => raw !== null && typeof raw === 'object' && !Array.isArray(raw))
      .map(([key, raw]) => ({ key, raw }))
  }
  // The enriched map's nested capacities, indexed by its property key: a
  // `data` row under the same id inherits what the endpoint nested there.
  const enriched = new Map<string, ListingEntry>()
  if (models !== null && typeof models === 'object' && !Array.isArray(models)) {
    for (const [key, raw] of Object.entries(models as Record<string, unknown>)) {
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) enriched.set(key, raw)
    }
  }
  const rows: LlmDiscoveredModel[] = []
  for (const { key, raw } of listed) {
    const entry = raw as ListingEntry | null
    const id = label(key, entry?.id, key === undefined ? undefined : enriched.get(key)?.id)
    if (id === undefined) continue
    const extra = enriched.get(id)
    const name = label(entry?.name, entry?.display_name, entry?.displayName) ?? id
    const contextWindow = capacity(
      entry?.contextWindow,
      entry?.context_window,
      entry?.context_length,
      entry?.max_input_tokens,
      entry?.limit?.context,
      extra?.contextWindow,
      extra?.context_window,
      extra?.context_length,
      extra?.max_input_tokens,
      extra?.limit?.context,
    )
    const maxTokens = capacity(
      entry?.maxOutputTokens,
      entry?.max_output_tokens,
      entry?.maxTokens,
      entry?.max_tokens,
      entry?.limit?.output,
      entry?.top_provider?.max_completion_tokens,
      extra?.maxOutputTokens,
      extra?.max_output_tokens,
      extra?.maxTokens,
      extra?.max_tokens,
      extra?.limit?.output,
      extra?.top_provider?.max_completion_tokens,
    )
    const inputModalities = declaredModalities(
      entry?.architecture?.input_modalities,
      entry?.input_modalities,
      entry?.inputModalities,
      extra?.architecture?.input_modalities,
      extra?.input_modalities,
      extra?.inputModalities,
    )
    rows.push({
      id,
      name,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      ...inputModalities === undefined ? {} : { inputModalities },
    })
  }
  return rows
}

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key typed into the form or read from storage.
 * @returns the trimmed, usable key.
 */
function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/** Host-owned profile inputs that a configuration draft deliberately omits. */
export interface StoredModelDiscoveryProfile {
  /** Deployment headers configured on the named route. */
  readonly headers: Readonly<Record<string, string>> | undefined
  /** Resolve the named route's credential only when the draft carries none. */
  readonly resolveApiKey: () => Promise<string | undefined>
}

/**
 * Interrogate one draft provider endpoint for the models it advertises.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @param storedProfile - Host-owned headers and lazy credential resolution for
 *   the named route. It is read only on the path that reaches the network; the
 *   credential is resolved only when the draft carries none.
 * @returns the advertised models in endpoint order; the installed catalog's
 *   answer when the route has no endpoint to ask or the endpoint cannot be
 *   reached.
 * @throws LlmError when the protocol has no readable listing, the endpoint
 *   refuses the credential, or — for a route the installed catalog does not
 *   describe — the endpoint refuses or fails the request.
 */
export async function discoverModels(
  request: LlmModelDiscoveryOperation,
  storedProfile?: () => StoredModelDiscoveryProfile | undefined,
): Promise<readonly LlmDiscoveredModel[]> {
  const catalog = catalogAnswer(request.provider)
  if (request.baseURL === undefined || request.baseURL.length === 0) {
    if (catalog !== undefined) return catalog
    throw new LlmError(
      `pi-ai ships no catalog for provider "${request.provider ?? ''}", so its models can only come from its`
      + " endpoint; set a baseURL, or enter this provider's models by hand",
      'DISCOVERY_FAILED',
    )
  }
  // A draft that has not chosen a protocol yet is asked as OpenAI Chat
  // Completions: it is the shape a gateway is overwhelmingly likely to speak,
  // and the alternative — refusing until the field is filled — would withhold
  // the action from the case it exists for. The cost is a misdirected message
  // when the endpoint speaks something else (an Anthropic gateway answers 401,
  // which reads as a credential problem), and hand-entry remains the way out.
  const api = request.api ?? 'openai-completions'
  if (!LISTABLE_PROTOCOLS.has(api)) {
    throw new LlmError(
      `pi-ai protocol "${api}" has no model listing this build can read; enter this provider's models by hand`,
      'DISCOVERY_UNSUPPORTED',
    )
  }
  try {
    return await interrogateEndpoint(request, api, storedProfile, catalog)
  } catch (error: unknown) {
    // Transport and shape failures degrade to the installed catalog — the
    // route's configured answer — while credential refusals rethrow: a wrong
    // key must stay loud, not silently serve the stale catalog. Aborts are the
    // caller's, never a fallback.
    if (catalog !== undefined && error instanceof LlmError && error.code === 'DISCOVERY_FAILED') {
      return catalog
    }
    throw error
  }
}

/** The installed catalog's discovery answer for one provider, or `undefined`. */
function catalogAnswer(provider: string | undefined): readonly LlmDiscoveredModel[] | undefined {
  if (provider === undefined) return undefined
  const installed = catalogModels(provider)
  if (installed.size === 0) return undefined
  return [...installed.values()].map(model => ({
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    inputModalities: [...model.input],
  }))
}

/**
 * One live model-listing interrogation. Live rows define which models exist;
 * the installed catalog only donates capacities a listing endpoint does not
 * disclose, filling each row's blanks by id.
 */
async function interrogateEndpoint(
  request: LlmModelDiscoveryOperation,
  api: string,
  storedProfile: (() => StoredModelDiscoveryProfile | undefined) | undefined,
  catalog: readonly LlmDiscoveredModel[] | undefined,
): Promise<readonly LlmDiscoveredModel[]> {
  const url = listingUrl(request.baseURL ?? '', api)
  // A key typed into the form wins: it may replace the stored key that is
  // failing. The stored profile is asked past the catalog and protocol checks,
  // and its credential resolver remains lazy so a typed key cannot fail over a
  // stored credential it supersedes. A route may still authenticate through a
  // deployment-owned Authorization header when neither key exists.
  const stored = storedProfile?.()
  const supplied = request.apiKey ?? await stored?.resolveApiKey()
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  let response: Response
  try {
    const headers = new Headers(stored?.headers === undefined ? undefined : Object.entries(stored.headers))
    headers.set('accept', 'application/json')
    if (api === 'anthropic-messages') {
      headers.set('anthropic-version', ANTHROPIC_VERSION)
      if (apiKey !== undefined) headers.set('x-api-key', apiKey)
    } else if (apiKey !== undefined) {
      headers.set('authorization', `Bearer ${apiKey}`)
    }
    for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
    response = await fetch(url, {
      method: 'GET',
      headers,
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new LlmError(`${url} answered ${response.status}; check the API key`, 'INVALID_CREDENTIAL')
    }
    throw new LlmError(`${url} answered ${response.status}`, 'DISCOVERY_FAILED')
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out.
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  const live = readListing(body)
  if (catalog === undefined) return live
  const known = new Map(catalog.map(model => [model.id, model]))
  return live.map((model) => {
    const installed = known.get(model.id)
    if (installed === undefined) return model
    // The catalog donates only what the live row left blank; absent keys stay
    // absent rather than recorded as undefined.
    const contextWindow = model.contextWindow ?? installed.contextWindow
    const maxTokens = model.maxTokens ?? installed.maxTokens
    const inputModalities = model.inputModalities ?? installed.inputModalities
    return {
      ...model,
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
      ...inputModalities === undefined ? {} : { inputModalities },
    }
  })
}
