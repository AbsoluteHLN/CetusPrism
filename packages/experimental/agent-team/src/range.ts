/** Team-scoped ranges: the ceilings a member's effort, backend, and preset must fall inside. */

import { TeamError } from './error.ts'

/**
 * The three independent ceilings one Team places on its members.
 *
 * Every list is a set, never an interval: an effort id, a backend id, and a
 * preset id are exact names, and an empty list means the Team places no
 * ceiling of that kind.
 */
export interface TeamRanges {
  readonly allowedEfforts: readonly string[]
  readonly allowedBackends: readonly string[]
  readonly allowedPresets: readonly string[]
}

/** One member request checked against the Team ranges. */
export interface RangeRequest {
  /** Exact model-advertised reasoning effort id. */
  readonly effort?: string
  /** Continuable subagent backend the member runs under. */
  readonly backend?: string
  /** Agent preset the member runs under. */
  readonly preset?: string
}

/**
 * Reject a member request whose values fall outside the Team ranges.
 *
 * The check runs after the narrower ceilings (the model's advertised efforts
 * and the Host-authorized model list), so a rejected value is always outside
 * every ceiling that applies, not just this one.
 * @param ranges - the Team's three ceilings.
 * @param request - the member's effort, backend, and preset.
 * @throws {TeamError} `TEAM_EFFORT_NOT_ALLOWED`, `TEAM_BACKEND_NOT_ALLOWED`, or
 * `TEAM_PRESET_NOT_ALLOWED` for the first value outside its range.
 */
export function checkRanges(ranges: TeamRanges, request: RangeRequest): void {
  if (request.effort !== undefined && ranges.allowedEfforts.length > 0
    && !ranges.allowedEfforts.includes(request.effort)) {
    throw new TeamError(
      `reasoning effort "${request.effort}" is outside the Team allowed-effort range`,
      'TEAM_EFFORT_NOT_ALLOWED',
    )
  }
  if (request.backend !== undefined && ranges.allowedBackends.length > 0
    && !ranges.allowedBackends.includes(request.backend)) {
    throw new TeamError(
      `execution backend "${request.backend}" is outside the Team allowed-backend range`,
      'TEAM_BACKEND_NOT_ALLOWED',
    )
  }
  if (request.preset !== undefined && ranges.allowedPresets.length > 0
    && !ranges.allowedPresets.includes(request.preset)) {
    throw new TeamError(
      `agent preset "${request.preset}" is outside the Team allowed-preset range`,
      'TEAM_PRESET_NOT_ALLOWED',
    )
  }
}
