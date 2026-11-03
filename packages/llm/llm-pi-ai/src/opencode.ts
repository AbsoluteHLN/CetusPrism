/**
 * Built-in OpenCode Zen / OpenCode Go interoperability.
 *
 * pi-ai ships both providers and their model catalogs, so routing, per-model
 * protocols, and the `x-opencode-session` header already come from that
 * dependency. Two deployment facts are not derivable from the route id and are
 * owned here: the provider-native credential variable (the Models page used to
 * guess `OPENCODE_GO_API_KEY`) and the session requirement the gateway
 * enforces.
 *
 * @module opencode
 */

/** Provider routes served by the OpenCode gateway. */
const OPENCODE_PROVIDERS: ReadonlySet<string> = new Set(['opencode', 'opencode-go'])

/** The credential variable pi-ai reads for both OpenCode routes. */
export const OPENCODE_API_KEY_ENV = 'OPENCODE_API_KEY'

/** Ecosystem alias for the Go route; accepted in addition to the native name. */
export const OPENCODE_GO_API_KEY_ENV = 'OPENCODE_GO_API_KEY'

/**
 * Whether a route is served by the OpenCode gateway.
 * @param provider - provider route id.
 * @returns true for OpenCode Zen and OpenCode Go.
 */
export function isOpenCodeProvider(provider: string): boolean {
  return OPENCODE_PROVIDERS.has(provider)
}

/**
 * Provider-native credential metadata for the configurable-provider directory.
 * @param provider - provider route id.
 * @returns the accepted environment variables and OAuth support, or undefined
 * for a route this module does not own.
 */
export function openCodeNativeAuth(
  provider: string,
): { env: readonly string[]; oauth: boolean } | undefined {
  return isOpenCodeProvider(provider)
    ? { env: [OPENCODE_API_KEY_ENV, OPENCODE_GO_API_KEY_ENV], oauth: false }
    : undefined
}

/**
 * Additional environment names a credential lookup should try after the name
 * the provider asked for. The OpenCode ecosystem commonly exports the Go
 * route's own `OPENCODE_GO_API_KEY` while pi-ai reads the shared name.
 * @param name - the environment name the provider resolved.
 * @returns alias names in precedence order, possibly empty.
 */
export function credentialEnvAliases(name: string): readonly string[] {
  return name === OPENCODE_API_KEY_ENV ? [OPENCODE_GO_API_KEY_ENV] : []
}

/**
 * Explain why an OpenCode generation cannot proceed, when it cannot.
 *
 * The gateway rejects a request without `x-opencode-session` with
 * `400 MissingSessionID`; pi-ai only emits that header when the caller supplies
 * a session id, so a missing id must fail here with a truthful diagnostic
 * instead of surfacing as an opaque provider error.
 * @param provider - provider route id.
 * @param sessionId - the session identity the request carries, when any.
 * @returns a repair-oriented message, or undefined when the request may proceed.
 */
export function openCodeSessionProblem(provider: string, sessionId: unknown): string | undefined {
  if (!isOpenCodeProvider(provider)) return undefined
  // pi-ai skips the header for an empty id too, so an empty string is as
  // unusable as an absent one and must fail here rather than at the gateway.
  if (sessionId !== undefined && String(sessionId).length > 0) return undefined
  return `pi-ai provider "${provider}" requires a session id: the OpenCode gateway rejects generation`
    + ' requests without the x-opencode-session header (400 MissingSessionID)'
}
