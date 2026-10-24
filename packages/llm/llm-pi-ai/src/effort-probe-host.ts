/**
 * Answering the Host's question: which reasoning-effort levels does one
 * endpoint accept for one model?
 *
 * The Host asks with a draft — the route being edited, or the endpoint facts
 * the draft carries — and keeps the rest of the picture to itself: the
 * settings namespace, the stored credential, the deployment headers. This
 * module is the seam between that draft and the plugin's own probe, and it is
 * deliberately thin:
 *
 * - A credential typed into the form wins, because it may replace the stored
 *   key that is failing. Only a draft that carries none resolves the stored
 *   one, and it resolves it lazily, so a typed key can never fail over a
 *   credential it supersedes.
 * - The Host's cancellation is the probe's cancellation: one signal, passed
 *   through untouched, so a cancelled probe stops mid-request.
 * - Every failure keeps the probe's own code — `EFFORT_PROBE_UNSUPPORTED` for
 *   a protocol with no probeable levels, `EFFORT_PROBE_FAILED` for an
 *   endpoint that cannot be reached or that answered every level with a
 *   failure that is not about the effort, `ABORTED` for a cancelled probe, and
 *   `INVALID_CREDENTIAL` for a key no HTTP header can carry — because this
 *   seam invents none. The Host's remote adapter turns those into the
 *   rejection it reports, so a surface reads one code the probe already owns.
 *
 * Two Host-owned inputs belong to the probe's request shape rather than to
 * this seam, and the seam now carries both: the deployment headers a stored
 * route carries (the probe builds its own headers from the credential alone
 * unless the request adds more) and the levels to try (the probe asks about
 * its own word list, so a request that names none gets that list).
 *
 * @module dsh-llm-pi-ai/effort-probe-host
 */

import type { LlmReasoningEffortProbeRequest, LlmReasoningEffortProbeResult } from '@deepseek-ai/dsh-llm'
import { probeReasoningEfforts } from './effort-probe.ts'

/**
 * Host-owned inputs a draft deliberately omits.
 *
 * The credential behind a stored route, resolved only when the draft carries
 * no credential of its own.
 */
export interface StoredReasoningEffortProbeProfile {
  /** Resolve the named route's credential; `undefined` when it has none. */
  readonly resolveApiKey: () => Promise<string | undefined>
  /** Deployment headers the named route carries, such as a gateway's own key. */
  readonly headers: Readonly<Record<string, string>> | undefined
}

/**
 * Interrogate one endpoint about the reasoning-effort levels one model
 * accepts, on the Host's behalf.
 *
 * The Host's request describes a draft, so the endpoint, the protocol, and the
 * model come from it and only the credential may come from the Host: a stored
 * route's credential is resolved here, lazily, and a draft's own key wins over
 * it. The cancellation the Host supplied is the probe's own.
 *
 * @param request - the Host's draft: endpoint, protocol, model, and one-shot credential.
 * @param storedProfile - the Host-owned credential resolver for the named route.
 * @param signal - caller cancellation, handed to the probe untouched.
 * @returns the accepted levels, the refusals, and the declaration to write.
 * @throws LlmError when the probe refuses or fails, carrying the probe's own code.
 */
export async function probeReasoningEffortsForHost(
  request: LlmReasoningEffortProbeRequest,
  storedProfile?: () => StoredReasoningEffortProbeProfile | undefined,
  signal?: AbortSignal,
): Promise<LlmReasoningEffortProbeResult> {
  const stored = storedProfile?.()
  // A key typed into the form is the one being tested — possibly the
  // replacement for the stored one — so it wins without resolving the stored
  // credential, which stays lazy for the same reason.
  const supplied = request.apiKey ?? await stored?.resolveApiKey()
  const probed = await probeReasoningEfforts({
    // A draft that names no endpoint cannot be interrogated, and the probe
    // says so in its own words rather than this seam inventing a second one.
    baseURL: request.baseURL ?? '',
    ...request.api === undefined ? {} : { api: request.api },
    model: request.model,
    ...supplied === undefined ? {} : { apiKey: supplied },
    // The deployment headers a stored route carries ride along with every
    // probe request, so a gateway that authenticates through its own header
    // can be interrogated the same way it is called.
    ...stored?.headers === undefined ? {} : { headers: stored.headers },
    ...signal === undefined ? {} : { signal },
  })
  // The Host's result shape carries no fault of its own, so the probe's fault
  // is left out here: the wording it carries already reaches the surface
  // through the refusal detail it wrote.
  return {
    accepted: probed.accepted,
    refused: probed.refused,
    ...probed.declared === undefined ? {} : { declared: probed.declared },
    declaration: probed.declaration,
    outcomes: probed.outcomes,
  }
}
