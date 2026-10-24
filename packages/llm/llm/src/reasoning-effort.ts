/**
 * Protocol-neutral reasoning-effort ladder and degradation policy.
 *
 * The levels an endpoint accepts are a property of one model behind it, not
 * of the endpoint: a gateway that fronts `Qwen` may take only `low`,
 * `medium`, and `xhigh` while the same gateway's other route takes the whole
 * ladder, and one provider's vocabulary (`high`, `xhigh`, `max`) is not
 * another's (`low`, `medium`, `xhigh`). Nothing in this module knows a
 * provider, a wire format, or an endpoint. It knows two things only: the
 * order of the canonical ladder, and which levels one model supports.
 *
 * Degradation is a policy, not a fact the harness can read off a model, so
 * this module offers the choice rather than making it.
 * {@link selectSupportedReasoningEffort} implements the industry "Auto"
 * behavior — the requested level when the model has it, the nearest supported
 * level at or above it otherwise, the highest supported level last — and
 * {@link isSupportedReasoningEffort} answers the exact-membership question a
 * strict caller needs. Which one a caller uses is the caller's decision: a
 * strict route refuses an unsupported level, a lenient one lowers it.
 *
 * @module @deepseek-ai/dsh-llm/reasoning-effort
 */

import type { ReasoningEffortId } from './brand.ts'

/**
 * The canonical reasoning-effort ladder, ascending.
 *
 * The order is the one every provider vocabulary is a subset of, running
 * from "no reasoning" through the usual intensities to the highest tier, so
 * two providers that mean the same thing by different words can still be
 * compared. `off` leads because it is the absence of reasoning rather than a
 * weak form of it, and `max` trails because no provider offers more thinking
 * than the top of the ladder.
 */
export const REASONING_EFFORT_LADDER: readonly string[] = Object.freeze([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

/**
 * Ladder position per level; a level that is not on the ladder has none.
 *
 * Positions, never array order, are what every comparison uses. A caller
 * may pass the levels its provider reported in any order, and two providers
 * that report the same levels in different orders must degrade to the same
 * answer.
 */
const LADDER_POSITIONS: ReadonlyMap<string, number> = new Map(
  REASONING_EFFORT_LADDER.map((level, index) => [level, index] as const),
)

/**
 * Select the level one model should actually use for a requested level.
 *
 * The rule mirrors the industry "Auto" behavior: use the requested level
 * when the model supports it, otherwise the nearest supported level at or
 * above it, otherwise the highest supported level. Ladder positions decide
 * every comparison, so the order of `supported` never changes the answer.
 *
 * A supported level that is not on the ladder — another adapter's own name —
 * never wins a comparison, because this module cannot say where it sits
 * relative to `low` or `high`. Only an exact request may select it, and an
 * exact request is answered before any comparison happens.
 *
 * @param supported - the levels the model accepts.
 * @param requested - the level the caller asked for.
 * @returns the level to use, or `undefined` when the model supports no level
 *   on the ladder and the request is not one of its own levels.
 */
export function selectSupportedReasoningEffort(
  supported: readonly ReasoningEffortId[],
  requested: ReasoningEffortId,
): ReasoningEffortId | undefined {
  // An exact hit is the caller's own choice and always wins, including for a
  // level this module has never heard of: the model takes it, so nothing has
  // to be compared to decide.
  if (supported.includes(requested)) return requested
  const requestedPosition = LADDER_POSITIONS.get(requested)
  // The nearest supported level at or above the request: the smallest ladder
  // position that is not below the requested one.
  if (requestedPosition !== undefined) {
    let nearest: ReasoningEffortId | undefined
    let nearestPosition = Number.POSITIVE_INFINITY
    for (const candidate of supported) {
      const position = LADDER_POSITIONS.get(candidate)
      if (position === undefined) continue
      if (position < requestedPosition || position >= nearestPosition) continue
      nearest = candidate
      nearestPosition = position
    }
    if (nearest !== undefined) return nearest
  }
  // Otherwise the highest level the model supports. A level that is not on
  // the ladder cannot be the highest one: nothing here knows where it sits.
  let highest: ReasoningEffortId | undefined
  let highestPosition = -1
  for (const candidate of supported) {
    const position = LADDER_POSITIONS.get(candidate)
    if (position === undefined || position <= highestPosition) continue
    highest = candidate
    highestPosition = position
  }
  return highest
}

/**
 * Test whether one model accepts a level exactly.
 *
 * This is the strict counterpart of {@link selectSupportedReasoningEffort}:
 * it never lowers a request, so a caller that promised its users the
 * requested level can refuse instead of quietly sending a weaker one.
 *
 * @param supported - the levels the model accepts.
 * @param requested - the level to test.
 * @returns true when the level is one of the model's own levels.
 */
export function isSupportedReasoningEffort(
  supported: readonly ReasoningEffortId[],
  requested: ReasoningEffortId,
): boolean {
  return supported.includes(requested)
}
